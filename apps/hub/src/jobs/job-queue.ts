import { randomUUID } from "node:crypto";
import { now, parseJson, type Db } from "../db/database.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { Bus, EventLog, JobLogLine } from "../domain/events.ts";

export const JOB_STATES = ["queued", "running", "done", "failed", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];

export type JobProgress = { label: string | null; pct: number | null; lines: JobLogLine[] };

export type Job = {
  id: string;
  type: string;
  subject: string | null;
  label: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  input: unknown;
  output: unknown;
  progress: JobProgress;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type JobContext = {
  job: Job;
  signal: AbortSignal;
  /** Étape en cours (« Construit le site… ») et pourcentage estimé, montrés en direct. */
  progress(p: { label?: string; pct?: number | null }): void;
  /** Une ligne du journal du travail (outil utilisé, texte de l'agent, erreur). */
  log(kind: JobLogLine["kind"], text: string): void;
};

export type JobHandler = { run(ctx: JobContext): Promise<unknown> };

/** Lignes de journal gardées par travail (le flux brut complet reste sur disque quand il existe). */
const KEPT_LINES = 60;

function fromRow(r: Record<string, unknown>): Job {
  return {
    id: String(r.id),
    type: String(r.type),
    subject: (r.subject as string | null) ?? null,
    label: String(r.label),
    state: r.state as JobState,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    input: parseJson(r.input_json, {}),
    output: parseJson(r.output_json, null),
    progress: parseJson(r.progress_json, { label: null, pct: null, lines: [] }),
    error: (r.error as string | null) ?? null,
    createdAt: String(r.created_at),
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    updatedAt: String(r.updated_at),
  };
}

/**
 * File de travaux persistante (ADR-04). Chaque travail est une ligne en base : il survit à un redémarrage
 * (un « running » orphelin repasse « queued »). Le plafond de parallélisme est relu à chaque passage.
 */
export class JobQueue {
  readonly #db: Db;
  readonly #bus: Bus;
  readonly #events: EventLog;
  readonly #parallel: () => number;
  readonly #handlers = new Map<string, JobHandler>();
  readonly #running = new Map<string, { controller: AbortController; done: Promise<void> }>();
  #started = false;
  #stopping = false;
  #idleWaiters: (() => void)[] = [];

  constructor(db: Db, bus: Bus, events: EventLog, parallel: () => number) {
    this.#db = db;
    this.#bus = bus;
    this.#events = events;
    this.#parallel = parallel;
  }

  register(type: string, handler: JobHandler): void {
    this.#handlers.set(type, handler);
  }

  types(): string[] {
    return [...this.#handlers.keys()];
  }

  /** Reprise après redémarrage, puis démarrage de la file. */
  start(): { recovered: number } {
    const res = this.#db.prepare("UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'running'").run(now());
    const recovered = Number(res.changes);
    if (recovered) this.#events.append({ type: "jobs.recovered", message: `${recovered} travail(aux) interrompu(s) remis en file après redémarrage` });
    this.#started = true;
    this.#stopping = false;
    this.#pump();
    return { recovered };
  }

  /** Arrêt du hub : les travaux en cours sont interrompus et restent « running » en base, pour être repris. */
  async stop(): Promise<void> {
    this.#stopping = true;
    this.#started = false;
    const pending = [...this.#running.values()];
    for (const r of pending) r.controller.abort();
    await Promise.allSettled(pending.map((r) => r.done));
  }

  enqueue(req: { type: string; label: string; subject?: string | null; input?: unknown; maxAttempts?: number }): Job {
    if (!this.#handlers.has(req.type)) throw new HubError(`Type de travail inconnu : ${req.type}`);
    const id = randomUUID().slice(0, 12);
    const at = now();
    this.#db
      .prepare("INSERT INTO jobs (id, type, subject, label, state, max_attempts, input_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
      .run(id, req.type, req.subject ?? null, req.label, Math.max(1, req.maxAttempts ?? 1), JSON.stringify(req.input ?? {}), at, at);
    const job = this.get(id);
    this.#publish(job);
    this.#events.append({ type: "job.queued", subject: job.subject, message: `En file : ${job.label}`, data: { jobId: id } });
    this.#pump();
    return job;
  }

  get(id: string): Job {
    const row = this.#db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Travail");
    return fromRow(row);
  }

  list(filter: { state?: JobState; subject?: string; limit?: number } = {}): Job[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.state) {
      where.push("state = ?");
      params.push(filter.state);
    }
    if (filter.subject) {
      where.push("subject = ?");
      params.push(filter.subject);
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
    return (
      this.#db
        .prepare(`SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...params, limit) as Record<string, unknown>[]
    ).map(fromRow);
  }

  cancel(id: string): Job {
    const job = this.get(id);
    if (job.state !== "queued" && job.state !== "running") throw new HubError("Ce travail est déjà terminé", 409);
    this.#finish(id, "cancelled", { error: null });
    this.#running.get(id)?.controller.abort();
    this.#events.append({ type: "job.cancelled", subject: job.subject, message: `Annulé : ${job.label}`, data: { jobId: id } });
    return this.get(id);
  }

  /** Relance un travail échoué ou annulé : il repart en file, avec ses tentatives remises à zéro. */
  retry(id: string): Job {
    const job = this.get(id);
    if (job.state !== "failed" && job.state !== "cancelled") throw new HubError("Seul un travail échoué ou annulé peut être relancé", 409);
    this.#db
      .prepare("UPDATE jobs SET state = 'queued', attempts = 0, error = NULL, output_json = NULL, progress_json = NULL, started_at = NULL, finished_at = NULL, updated_at = ? WHERE id = ?")
      .run(now(), id);
    const after = this.get(id);
    this.#publish(after);
    this.#events.append({ type: "job.retried", subject: job.subject, message: `Relancé : ${job.label}`, data: { jobId: id } });
    this.#pump();
    return after;
  }

  runningCount(): number {
    return this.#running.size;
  }

  /** Résout quand plus rien ne tourne ni n'attend (pour les tests). */
  idle(): Promise<void> {
    if (this.#isIdle()) return Promise.resolve();
    return new Promise((r) => this.#idleWaiters.push(r));
  }

  #isIdle(): boolean {
    if (this.#running.size) return false;
    const types = this.types();
    if (!types.length) return true;
    const row = this.#db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE state = 'queued' AND type IN (${types.map(() => "?").join(",")})`).get(...types) as { n: number };
    return row.n === 0 || !this.#started;
  }

  #pump(): void {
    if (!this.#started || this.#stopping) return;
    const cap = Math.max(1, Math.floor(this.#parallel()) || 1);
    while (this.#running.size < cap) {
      const row = this.#db
        .prepare(`SELECT * FROM jobs WHERE state = 'queued' ${this.#running.size ? `AND id NOT IN (${[...this.#running.keys()].map(() => "?").join(",")})` : ""} ORDER BY created_at, rowid LIMIT 1`)
        .get(...this.#running.keys()) as Record<string, unknown> | undefined;
      if (!row) break;
      const job = fromRow(row);
      const handler = this.#handlers.get(job.type);
      if (!handler) {
        this.#finish(job.id, "failed", { error: `Aucun exécutant pour le type « ${job.type} »` });
        continue;
      }
      this.#launch(job, handler);
    }
    if (this.#isIdle()) for (const w of this.#idleWaiters.splice(0)) w();
  }

  #launch(queued: Job, handler: JobHandler): void {
    const at = now();
    this.#db.prepare("UPDATE jobs SET state = 'running', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?").run(at, at, queued.id);
    const job = this.get(queued.id);
    this.#publish(job);
    const controller = new AbortController();
    const progress: JobProgress = { label: null, pct: null, lines: [] };
    const save = () => {
      if (this.get(job.id).state !== "running") return;
      this.#db.prepare("UPDATE jobs SET progress_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(progress), now(), job.id);
      this.#publish(this.get(job.id));
    };
    const ctx: JobContext = {
      job,
      signal: controller.signal,
      progress: (p) => {
        if (p.label !== undefined) progress.label = p.label;
        if (p.pct !== undefined) progress.pct = p.pct === null ? null : Math.max(0, Math.min(100, p.pct));
        save();
      },
      log: (kind, text) => {
        const line: JobLogLine = { at: now(), kind, text: text.slice(0, 2000) };
        progress.lines = [...progress.lines, line].slice(-KEPT_LINES);
        this.#bus.publish({ kind: "job-log", jobId: job.id, line });
        save();
      },
    };

    const done = (async () => {
      try {
        const output = await handler.run(ctx);
        if (this.#stopping || this.get(job.id).state !== "running") return;
        this.#finish(job.id, "done", { output });
        this.#events.append({ type: "job.done", subject: job.subject, message: `Terminé : ${job.label}`, data: { jobId: job.id } });
      } catch (err) {
        if (this.#stopping || this.get(job.id).state !== "running") return;
        const message = err instanceof Error ? err.message : String(err);
        if (job.attempts < job.maxAttempts) {
          this.#db.prepare("UPDATE jobs SET state = 'queued', error = ?, updated_at = ? WHERE id = ?").run(message, now(), job.id);
          this.#publish(this.get(job.id));
          this.#events.append({ type: "job.retry", subject: job.subject, message: `Nouvel essai (${job.attempts}/${job.maxAttempts}) : ${job.label}`, data: { jobId: job.id, error: message } });
        } else {
          this.#finish(job.id, "failed", { error: message });
          this.#events.append({ type: "job.failed", subject: job.subject, message: `Échec : ${job.label} — ${message}`, data: { jobId: job.id } });
        }
      } finally {
        this.#running.delete(job.id);
        this.#pump();
      }
    })();
    this.#running.set(job.id, { controller, done });
  }

  #finish(id: string, state: JobState, r: { output?: unknown; error?: string | null }): void {
    const at = now();
    this.#db
      .prepare("UPDATE jobs SET state = ?, output_json = COALESCE(?, output_json), error = ?, finished_at = ?, updated_at = ? WHERE id = ?")
      .run(state, r.output === undefined ? null : JSON.stringify(r.output ?? null), r.error ?? null, at, at, id);
    this.#publish(this.get(id));
  }

  #publish(job: Job): void {
    this.#bus.publish({ kind: "job", job });
  }
}
