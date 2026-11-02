import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { now, type Db } from "../db/database.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import type { ClaudeCli, ClaudeEvent } from "./claude-cli.ts";
import type { DeepSeekClient } from "./deepseek.ts";
import { AGENTS, getAgent, type AgentDef } from "./registry.ts";
import type { SkillLibrary } from "./skills.ts";

export type AgentCall = {
  id: number;
  at: string;
  agent: string;
  model: string;
  provider: string;
  mode: string;
  durationMs: number;
  costUsd: number | null;
  ok: boolean;
  jobId: string | null;
  summary: string | null;
  error: string | null;
};

export type AgentView = AgentDef & {
  modeleDefaut: string;
  skills: { path: string; name: string; description: string }[];
  skillsManquants: string[];
  cout7j: number;
  appels7j: number;
};

export type AskRequest<T extends z.ZodType> = {
  agent: string;
  prompt: string;
  /** Schéma de sortie : demandé au CLI (--json-schema) puis revérifié ici. Absent = réponse texte. */
  schema?: T;
  /** Vision : dossier d'images que l'agent peut lire (Read seulement). */
  imagesDir?: string;
  jobId?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Modèle imposé pour cet appel (ex. haiku pour un essai de câblage). */
  model?: string;
  /** Résumé lisible gardé dans le journal des appels. */
  summary?: string;
};

export type AskResult<T> = { text: string; data: T; costUsd: number | null; model: string; durationMs: number };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/**
 * Vision : l'agent n'a que Read, il ne peut pas lister le dossier. Le hub lui donne donc les chemins exacts
 * des images (triés), à la suite de la demande.
 */
export function withImageList(prompt: string, dir: string): string {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).sort();
  } catch {
    throw new HubError(`Dossier d'images introuvable : ${dir}`);
  }
  if (!files.length) throw new HubError(`Aucune image dans ${dir}`);
  return `${prompt}\n\nImages à lire avec l'outil Read (chemins exacts) :\n${files.map((f) => `- ${join(dir, f)}`).join("\n")}`;
}

/**
 * Point d'entrée unique des appels aux agents (ADR-05) : compose le prompt système (rôle + skills hérités),
 * choisit le fournisseur et le modèle, journalise chaque appel (durée, coût indicatif) dans agent_calls.
 */
export class AgentService {
  readonly #db: Db;
  readonly #cli: ClaudeCli;
  readonly #deepseek: DeepSeekClient;
  readonly #skills: SkillLibrary;
  readonly #settings: Settings;
  readonly #events: EventLog;
  readonly #runsDir: string;

  constructor(deps: { db: Db; cli: ClaudeCli; deepseek: DeepSeekClient; skills: SkillLibrary; settings: Settings; events: EventLog; runsDir: string }) {
    this.#db = deps.db;
    this.#cli = deps.cli;
    this.#deepseek = deps.deepseek;
    this.#skills = deps.skills;
    this.#settings = deps.settings;
    this.#events = deps.events;
    this.#runsDir = deps.runsDir;
  }

  get skills(): SkillLibrary {
    return this.#skills;
  }

  #agent(id: string): AgentDef {
    const a = getAgent(id);
    if (!a) throw notFound(`Agent « ${id} »`);
    return a;
  }

  modelFor(id: string): string {
    const a = this.#agent(id);
    const chosen = this.#settings.get("agents.models")[id];
    return typeof chosen === "string" && chosen ? chosen : a.modele;
  }

  systemPrompt(id: string): string {
    const a = this.#agent(id);
    const skills = this.#skills.promptFor(id);
    return skills ? `${a.role}\n\n${skills}` : a.role;
  }

  list(): AgentView[] {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const stats = new Map(
      (this.#db.prepare("SELECT agent, COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS cost FROM agent_calls WHERE at >= ? GROUP BY agent").all(since) as {
        agent: string;
        n: number;
        cost: number;
      }[]).map((r) => [r.agent, r]),
    );
    return AGENTS.map((a) => {
      const { skills, missing } = this.#skills.forAgent(a.id);
      const s = stats.get(a.id);
      return {
        ...a,
        modele: this.modelFor(a.id),
        modeleDefaut: a.modele,
        skills: skills.map((k) => ({ path: k.path, name: k.name, description: k.description })),
        skillsManquants: missing,
        cout7j: s?.cost ?? 0,
        appels7j: s?.n ?? 0,
      };
    });
  }

  calls(opts: { limit?: number; agent?: string } = {}): AgentCall[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const rows = (
      opts.agent
        ? this.#db.prepare("SELECT * FROM agent_calls WHERE agent = ? ORDER BY id DESC LIMIT ?").all(opts.agent, limit)
        : this.#db.prepare("SELECT * FROM agent_calls ORDER BY id DESC LIMIT ?").all(limit)
    ) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      agent: String(r.agent),
      model: String(r.model),
      provider: String(r.provider),
      mode: String(r.mode),
      durationMs: Number(r.duration_ms),
      costUsd: (r.cost_usd as number | null) ?? null,
      ok: Number(r.ok) === 1,
      jobId: (r.job_id as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
  }

  /** Appel sans outils (chat / structured) ou avec lecture d'images (vision). */
  async ask<T extends z.ZodType = z.ZodType<string>>(req: AskRequest<T>): Promise<AskResult<T extends z.ZodType<infer O> ? O : string>> {
    const agent = this.#agent(req.agent);
    const model = req.model ?? this.modelFor(agent.id);
    const mode = req.imagesDir ? "vision" : req.schema ? "structured" : "chat";
    const jsonSchema = req.schema ? (z.toJSONSchema(req.schema, { target: "draft-7" }) as object) : undefined;
    const started = Date.now();
    try {
      let text: string;
      let structured: unknown;
      let costUsd: number | null;
      if (agent.provider === "deepseek") {
        if (req.imagesDir) throw new HubError("DeepSeek ne lit pas d'images");
        const r = await this.#deepseek.structured({ model, systemPrompt: this.systemPrompt(agent.id), prompt: req.prompt, jsonSchema, timeoutMs: req.timeoutMs, signal: req.signal });
        ({ text, structured, costUsd } = r);
      } else {
        const r = await this.#cli.run({
          mode: req.imagesDir ? "vision" : "chat",
          model,
          systemPrompt: this.systemPrompt(agent.id),
          prompt: req.imagesDir ? withImageList(req.prompt, resolve(req.imagesDir)) : req.prompt,
          jsonSchema,
          imagesDir: req.imagesDir ? resolve(req.imagesDir) : undefined,
          timeoutMs: req.timeoutMs,
          signal: req.signal,
        });
        ({ text, structured, costUsd } = r);
      }
      let data: unknown = text;
      if (req.schema) {
        const parsed = req.schema.safeParse(structured);
        if (!parsed.success) throw new HubError(`Réponse de ${agent.nom} non conforme au schéma : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ").slice(0, 300)}`, 502);
        data = parsed.data;
      }
      this.#record({ agent: agent.id, model, provider: agent.provider, mode, started, costUsd, ok: true, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160) });
      return { text, data: data as AskResult<T extends z.ZodType<infer O> ? O : string>["data"], costUsd, model, durationMs: Date.now() - started };
    } catch (err) {
      this.#record({ agent: agent.id, model, provider: agent.provider, mode, started, costUsd: null, ok: false, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), error: (err as Error).message });
      throw err;
    }
  }

  /**
   * Travail agentique dans le dossier d'un site (mode atelier) : les skills de l'agent sont copiés dans
   * `<dossier>/.claude/skills`, d'éventuels réglages Claude Code laissés dans le dossier sont retirés,
   * le flux est suivi en direct, l'annulation ferme tout l'arbre de processus.
   */
  async atelier(req: { agent: string; dir: string; prompt: string; jobId?: string | null; signal?: AbortSignal; onEvent?: (e: ClaudeEvent) => void; model?: string; summary?: string }): Promise<{ text: string; costUsd: number | null; model: string; denials: { tool: string; input: unknown }[] }> {
    const agent = this.#agent(req.agent);
    if (agent.provider !== "claude") throw new HubError(`${agent.nom} ne travaille pas en atelier`);
    const dir = resolve(req.dir);
    mkdirSync(dir, { recursive: true });
    // Les permissions viennent de la ligne de commande seulement : aucun réglage local ne doit les élargir.
    for (const f of ["settings.json", "settings.local.json"]) rmSync(join(dir, ".claude", f), { force: true });
    const installed = this.#skills.installInto(agent.id, dir);
    const model = req.model ?? this.modelFor(agent.id);
    const runDir = join(this.#runsDir, req.jobId ?? `atelier-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    const started = Date.now();
    try {
      const r = await this.#cli.run({
        mode: "atelier",
        model,
        systemPrompt: `${agent.role}\n\nTes skills sont disponibles via l'outil Skill : ${installed.join(", ") || "aucun"}. Consulte ceux qui concernent la tâche avant de commencer.`,
        prompt: req.prompt,
        cwd: dir,
        timeoutMs: this.#settings.get("atelier.timeoutMinutes") * 60_000,
        signal: req.signal,
        onEvent: req.onEvent,
        streamLog: join(runDir, "stream.jsonl"),
      });
      this.#record({ agent: agent.id, model, provider: "claude", mode: "atelier", started, costUsd: r.costUsd, ok: true, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160) });
      if (r.denials.length) {
        this.#events.append({ type: "agent.denials", message: `${agent.nom} : ${r.denials.length} action(s) refusée(s) par les permissions`, data: { jobId: req.jobId ?? null, denials: r.denials.slice(0, 20) } });
      }
      return { text: r.text, costUsd: r.costUsd, model, denials: r.denials };
    } catch (err) {
      this.#record({ agent: agent.id, model, provider: "claude", mode: "atelier", started, costUsd: null, ok: false, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), error: (err as Error).message });
      throw err;
    }
  }

  #record(c: { agent: string; model: string; provider: string; mode: string; started: number; costUsd: number | null; ok: boolean; jobId?: string | null; summary: string; error?: string }): void {
    this.#db
      .prepare("INSERT INTO agent_calls (at, agent, model, provider, mode, duration_ms, cost_usd, ok, job_id, summary, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(now(), c.agent, c.model, c.provider, c.mode, Date.now() - c.started, c.costUsd, c.ok ? 1 : 0, c.jobId ?? null, c.summary.slice(0, 300), c.error?.slice(0, 500) ?? null);
  }
}
