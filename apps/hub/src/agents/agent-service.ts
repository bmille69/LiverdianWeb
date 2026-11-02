import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { now, type Db } from "../db/database.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import { ClaudeCliError, deepseekEnv, QuotaClaudeError, type ClaudeCli, type ClaudeEvent, type ClaudeRequest, type ClaudeResult } from "./claude-cli.ts";
import type { DeepSeekClient } from "./deepseek.ts";
import { AGENTS, getAgent, type AgentDef } from "./registry.ts";
import type { SkillLibrary } from "./skills.ts";

/** Moteur d'un appel (ADR-16) : l'abonnement Claude Code ou DeepSeek via le même CLI. */
export type Moteur = "abonnement" | "deepseek";

/** Tarifs DeepSeek ($ par million de jetons) : le coût annoncé par le CLI ne vaut que pour l'abonnement. */
export const TARIF_DEEPSEEK = { entree: 0.27, sortie: 1.1 } as const;

/** Coût d'un appel DeepSeek d'après ses jetons (le flux stream-json donne l'usage exact). */
export function coutDeepseek(usage: { input: number; output: number }): number {
  return (usage.input * TARIF_DEEPSEEK.entree + usage.output * TARIF_DEEPSEEK.sortie) / 1_000_000;
}

export type AgentCall = {
  id: number;
  at: string;
  agent: string;
  model: string;
  provider: string;
  /** Moteur réellement utilisé : « abonnement » ou « deepseek » (ADR-16). */
  engine: Moteur;
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
  /** Fournisseur imposé pour cet appel (l'Éclaireur passe par DeepSeek quand il est configuré). */
  provider?: "claude" | "deepseek";
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
      engine: (r.engine as Moteur | undefined) ?? "abonnement",
      mode: String(r.mode),
      durationMs: Number(r.duration_ms),
      costUsd: (r.cost_usd as number | null) ?? null,
      ok: Number(r.ok) === 1,
      jobId: (r.job_id as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
  }

  /**
   * Moteur choisi pour un appel sans fournisseur imposé (ADR-16) : « abonnement » directement,
   * « deepseek » via le CLI branché sur DeepSeek, « automatique » commence par l'abonnement.
   * La vision reste toujours sur l'abonnement : DeepSeek ne lit pas les images (vérifié le
   * 02/11/2026 avec le vrai CLI : Read répond « format non pris en charge »). Jamais de revue à l'aveugle.
   */
  #choisirMoteur(opts: { vision: boolean }): { engine: Moteur; env?: NodeJS.ProcessEnv } {
    const moteur = this.#settings.get("agents.moteur");
    if (moteur === "deepseek") {
      if (opts.vision) return { engine: "abonnement" };
      const cle = this.#settings.secret("DEEPSEEK_API_KEY");
      if (!cle) throw new HubError("Moteur DeepSeek choisi mais la clé DEEPSEEK_API_KEY est absente : enregistrez-la dans Réglages › Secrets, ou repassez sur l'abonnement.", 400);
      return { engine: "deepseek", env: deepseekEnv(cle) };
    }
    return { engine: "abonnement" };
  }

  /**
   * Appel via le CLI `claude`, quel que soit le moteur. En « automatique », quand l'abonnement répond
   * « limite atteinte », l'appel repart aussitôt sur DeepSeek (sauf vision, qui reste sur l'abonnement
   * et attend le rétablissement). L'échec quota est journalisé avant le repli : tout est visible.
   */
  async #runCli(
    req: Omit<ClaudeRequest, "env">,
    opts: { agent: string; vision: boolean; started: number; jobId?: string | null; summary: string; mode: string },
  ): Promise<{ r: ClaudeResult; engine: Moteur }> {
    const choix = this.#choisirMoteur({ vision: opts.vision });
    try {
      const r = await this.#cli.run({ ...req, env: choix.env });
      return { r, engine: choix.engine };
    } catch (err) {
      const automatique = this.#settings.get("agents.moteur") === "automatique";
      if (!(err instanceof QuotaClaudeError) || !automatique || opts.vision || choix.engine !== "abonnement") throw err;
      const cle = this.#settings.secret("DEEPSEEK_API_KEY");
      if (!cle) throw new HubError("L'abonnement Claude est à sa limite et aucune clé DeepSeek n'est enregistrée : ajoutez-en une, ou attendez le rétablissement du quota.", 503);
      this.#record({ agent: opts.agent, model: req.model, provider: "claude", engine: "abonnement", mode: opts.mode, started: opts.started, costUsd: null, ok: false, jobId: opts.jobId, summary: opts.summary, error: (err as Error).message });
      const r = await this.#cli.run({ ...req, env: deepseekEnv(cle) });
      return { r, engine: "deepseek" };
    }
  }

  /** Appel sans outils (chat / structured) ou avec lecture d'images (vision). */
  async ask<T extends z.ZodType = z.ZodType<string>>(req: AskRequest<T>): Promise<AskResult<T extends z.ZodType<infer O> ? O : string>> {
    const base = this.#agent(req.agent);
    const agent = req.provider && req.provider !== base.provider ? { ...base, provider: req.provider } : base;
    const model = req.model ?? (agent.provider !== base.provider ? (agent.provider === "deepseek" ? "deepseek-chat" : "haiku") : this.modelFor(agent.id));
    const mode = req.imagesDir ? "vision" : req.schema ? "structured" : "chat";
    const jsonSchema = req.schema ? (z.toJSONSchema(req.schema, { target: "draft-7" }) as object) : undefined;
    const started = Date.now();
    let engine: Moteur = "abonnement";
    try {
      let text: string;
      let structured: unknown;
      let costUsd: number | null;
      if (agent.provider === "deepseek") {
        if (req.imagesDir) throw new HubError("DeepSeek ne lit pas d'images");
        const r = await this.#deepseek.structured({ model, systemPrompt: this.systemPrompt(agent.id), prompt: req.prompt, jsonSchema, timeoutMs: req.timeoutMs, signal: req.signal });
        ({ text, structured, costUsd } = r);
      } else {
        const { r, engine: e } = await this.#runCli(
          {
            mode: req.imagesDir ? "vision" : "chat",
            model,
            systemPrompt: this.systemPrompt(agent.id),
            prompt: req.imagesDir ? withImageList(req.prompt, resolve(req.imagesDir)) : req.prompt,
            jsonSchema,
            imagesDir: req.imagesDir ? resolve(req.imagesDir) : undefined,
            timeoutMs: req.timeoutMs,
            signal: req.signal,
          },
          { agent: agent.id, vision: !!req.imagesDir, started, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), mode },
        );
        engine = e;
        ({ text, structured } = r);
        costUsd = engine === "deepseek" && r.usage ? coutDeepseek(r.usage) : r.costUsd;
      }
      let data: unknown = text;
      if (req.schema) {
        const parsed = req.schema.safeParse(structured);
        if (!parsed.success) throw new HubError(`Réponse de ${agent.nom} non conforme au schéma : ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ").slice(0, 300)}`, 502);
        data = parsed.data;
      }
      this.#record({ agent: agent.id, model, provider: agent.provider, engine, mode, started, costUsd, ok: true, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160) });
      return { text, data: data as AskResult<T extends z.ZodType<infer O> ? O : string>["data"], costUsd, model, durationMs: Date.now() - started };
    } catch (err) {
      this.#record({ agent: agent.id, model, provider: agent.provider, engine, mode, started, costUsd: null, ok: false, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), error: (err as Error).message });
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
    let engine: Moteur = "abonnement";
    try {
      const { r, engine: e } = await this.#runCli(
        {
          mode: "atelier",
          model,
          systemPrompt: `${agent.role}\n\nTes skills sont disponibles via l'outil Skill : ${installed.join(", ") || "aucun"}. Consulte ceux qui concernent la tâche avant de commencer.`,
          prompt: req.prompt,
          cwd: dir,
          timeoutMs: this.#settings.get("atelier.timeoutMinutes") * 60_000,
          signal: req.signal,
          onEvent: req.onEvent,
          streamLog: join(runDir, "stream.jsonl"),
        },
        { agent: agent.id, vision: false, started, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), mode: "atelier" },
      );
      engine = e;
      const costUsd = engine === "deepseek" && r.usage ? coutDeepseek(r.usage) : r.costUsd;
      this.#record({ agent: agent.id, model, provider: "claude", engine, mode: "atelier", started, costUsd, ok: true, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160) });
      if (r.denials.length) {
        this.#events.append({ type: "agent.denials", message: `${agent.nom} : ${r.denials.length} action(s) refusée(s) par les permissions`, data: { jobId: req.jobId ?? null, denials: r.denials.slice(0, 20) } });
      }
      return { text: r.text, costUsd, model, denials: r.denials };
    } catch (err) {
      this.#record({ agent: agent.id, model, provider: "claude", engine, mode: "atelier", started, costUsd: null, ok: false, jobId: req.jobId, summary: req.summary ?? req.prompt.slice(0, 160), error: (err as Error).message });
      throw err;
    }
  }

  #record(c: { agent: string; model: string; provider: string; engine: Moteur; mode: string; started: number; costUsd: number | null; ok: boolean; jobId?: string | null; summary: string; error?: string }): void {
    this.#db
      .prepare("INSERT INTO agent_calls (at, agent, model, provider, engine, mode, duration_ms, cost_usd, ok, job_id, summary, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(now(), c.agent, c.model, c.provider, c.engine, c.mode, Date.now() - c.started, c.costUsd, c.ok ? 1 : 0, c.jobId ?? null, c.summary.slice(0, 300), c.error?.slice(0, 500) ?? null);
  }
}
