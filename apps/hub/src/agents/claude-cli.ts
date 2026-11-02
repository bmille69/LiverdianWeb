import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Semaphore } from "./semaphore.ts";

export class ClaudeCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

/**
 * Les trois manières d'appeler Claude Code (ADR-05) :
 * - `chat` : aucun outil, réponse texte ou JSON (avec `jsonSchema`) ;
 * - `vision` : idem, plus la lecture (Read seulement) d'un dossier d'images ;
 * - `atelier` : travail agentique dans le dossier d'un site, outils de fichiers et commandes en liste fermée.
 */
export type ClaudeMode = "chat" | "vision" | "atelier";

/** Outils de l'atelier. Bash n'y est utilisable que pour les commandes de ATELIER_COMMANDS. */
export const ATELIER_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill"] as const;

/** Commandes permises à l'atelier : liste fermée, sans joker qui ouvrirait le terminal. */
export const ATELIER_COMMANDS = ["npm run build", "npx astro build", "npx astro check", "node scripts/*"] as const;

/** Options interdites en toutes circonstances : jamais de contournement des permissions. */
const FORBIDDEN_ARGS = [
  /^--dangerously-skip-permissions$/,
  /^--allow-dangerously-skip-permissions$/,
  /^bypassPermissions$/,
  /^acceptEdits$/,
  /^auto$/,
];

export function assertSafeArgs(args: string[]): void {
  for (const a of args) {
    if (FORBIDDEN_ARGS.some((re) => re.test(a))) throw new ClaudeCliError(`Option interdite : ${a}`);
  }
}

/**
 * Environnement de l'enfant : l'abonnement Max de Claude Code, jamais une clé d'API (CLAUDE.md).
 * Une ANTHROPIC_API_KEY présente ferait facturer l'appel à l'API : elle est retirée.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "ANTHROPIC_API_KEY") delete env[key];
  return env;
}

/**
 * Appel isolé sans outils (chat, structured) ou avec la seule lecture d'un dossier d'images (vision) :
 * aucun réglage utilisateur ou projet, aucun CLAUDE.md, aucun serveur MCP, aucune session gardée.
 * Le hub fournit tout le contexte (rôle + skills) dans le prompt système.
 */
export function buildChatArgs(opts: { model: string; systemPromptFile: string; jsonSchema?: object; imagesDir?: string }): string[] {
  const args = [
    "-p",
    "--restricted",
    "--safe-mode",
    "--strict-mcp-config",
    "--tools",
    opts.imagesDir ? "Read" : "",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    opts.model,
    "--system-prompt-file",
    opts.systemPromptFile,
  ];
  if (opts.imagesDir) {
    // --restricted confine Read aux dossiers de travail : le dossier d'images y est ajouté, rien d'autre.
    args.push("--add-dir", opts.imagesDir, "--allowedTools", "Read", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--max-turns", "30");
  }
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  assertSafeArgs(args);
  return args;
}

/**
 * Appel agentique de l'atelier : Claude Code travaille dans le dossier du site (dossier de travail),
 * charge les skills copiés dans `.claude/skills`, et n'a le droit que :
 * - de lire, chercher, modifier et écrire **dans ce dossier** (règles `./**`) ;
 * - de lancer les commandes de ATELIER_COMMANDS ;
 * - jamais d'écrire dans `.claude/` (ses propres permissions et skills).
 * `dontAsk` refuse tout le reste sans poser de question ; aucune option de contournement.
 */
export function buildAtelierArgs(opts: { model: string; appendSystemPromptFile: string; maxTurns: number; jsonSchema?: object }): string[] {
  const allowed = ["Skill", "Read(./**)", "Glob", "Grep", "Edit(./**)", "Write(./**)", ...ATELIER_COMMANDS.map((c) => `Bash(${c})`)];
  const denied = ["Edit(./.claude/**)", "Write(./.claude/**)", "Read(./.env*)"];
  const args = [
    "-p",
    // Seuls les réglages du projet (le dossier du site) : ni ceux de l'utilisateur, ni les serveurs MCP installés.
    // --restricted n'est pas utilisable ici : il empêche aussi le chargement des skills du projet (vérifié le 02/11/2026).
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--tools",
    ATELIER_TOOLS.join(","),
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    denied.join(","),
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(opts.maxTurns),
    "--model",
    opts.model,
    "--append-system-prompt-file",
    opts.appendSystemPromptFile,
  ];
  if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
  assertSafeArgs(args);
  if (allowed.some((t) => t === "Bash" || t === "Bash(*)" || t === "Edit" || t === "Write")) throw new ClaudeCliError("Permission trop large");
  return args;
}

export type ClaudeEvent = { kind: "text" | "tool" | "error"; text: string };

export type ClaudeRequest = {
  mode: ClaudeMode;
  model: string;
  /** Prompt système complet (chat, vision) ou ajouté à celui de Claude Code (atelier). */
  systemPrompt: string;
  prompt: string;
  jsonSchema?: object;
  /** Vision : dossier d'images lisible. */
  imagesDir?: string;
  /** Atelier : dossier de travail (le site). */
  cwd?: string;
  maxTurns?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent?: (e: ClaudeEvent) => void;
  /** Fichier où recopier le flux brut (atelier). */
  streamLog?: string;
};

export type ClaudeResult = {
  text: string;
  structured: unknown;
  costUsd: number | null;
  durationMs: number;
  model: string;
  /** Outils refusés par les permissions pendant l'appel. */
  denials: { tool: string; input: unknown }[];
};

/** Lance un processus : abstrait pour les tests. */
export type Spawner = typeof spawn;

/** Lance le binaire Claude Code officiel avec la connexion de l'abonnement (ADR-05). */
export class ClaudeCli {
  readonly #binary: string;
  readonly #workDir: string;
  readonly #limit: Semaphore;
  readonly #spawn: Spawner;

  /** workDir : dossier vide dédié, pour qu'aucun CLAUDE.md de projet ne soit chargé par les appels sans outils. */
  constructor(opts: { workDir: string; concurrency: number | (() => number); binary?: string; spawner?: Spawner }) {
    this.#workDir = opts.workDir;
    this.#binary = opts.binary ?? "claude";
    this.#limit = new Semaphore(opts.concurrency);
    this.#spawn = opts.spawner ?? spawn;
    mkdirSync(this.#workDir, { recursive: true });
  }

  get queue(): { active: number; waiting: number } {
    return { active: this.#limit.active, waiting: this.#limit.waiting };
  }

  run(req: ClaudeRequest): Promise<ClaudeResult> {
    return this.#limit.run(() => this.#run(req), req.signal);
  }

  async #run(req: ClaudeRequest): Promise<ClaudeResult> {
    const sysFile = join(this.#workDir, `system-${randomUUID()}.md`);
    writeFileSync(sysFile, req.systemPrompt, "utf8");
    const started = Date.now();
    try {
      let args: string[];
      let cwd = this.#workDir;
      if (req.mode === "atelier") {
        if (!req.cwd) throw new ClaudeCliError("Le mode atelier exige un dossier de travail");
        cwd = req.cwd;
        args = buildAtelierArgs({ model: req.model, appendSystemPromptFile: sysFile, maxTurns: req.maxTurns ?? 120, jsonSchema: req.jsonSchema });
      } else {
        if (req.mode === "vision" && !req.imagesDir) throw new ClaudeCliError("Le mode vision exige un dossier d'images");
        args = buildChatArgs({ model: req.model, systemPromptFile: sysFile, jsonSchema: req.jsonSchema, imagesDir: req.mode === "vision" ? req.imagesDir : undefined });
      }
      const final = await this.#exec(args, cwd, req);
      if (final.is_error || final.subtype !== "success") {
        throw new ClaudeCliError(`Claude Code a échoué (${String(final.subtype)}) : ${String(final.result ?? "").slice(0, 300)}`);
      }
      const denials = Array.isArray(final.permission_denials)
        ? (final.permission_denials as { tool_name?: string; tool_input?: unknown }[]).map((d) => ({ tool: String(d.tool_name ?? "?"), input: d.tool_input ?? null }))
        : [];
      return {
        text: String(final.result ?? ""),
        structured: final.structured_output ?? null,
        costUsd: typeof final.total_cost_usd === "number" ? final.total_cost_usd : null,
        durationMs: Date.now() - started,
        model: req.model,
        denials,
      };
    } finally {
      rmSync(sysFile, { force: true });
    }
  }

  #exec(args: string[], cwd: string, req: ClaudeRequest): Promise<Record<string, unknown>> {
    const timeoutMs = req.timeoutMs ?? (req.mode === "atelier" ? 30 * 60_000 : 180_000);
    return new Promise((resolve, reject) => {
      const child = this.#spawn(this.#binary, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
      let buffer = "";
      let stderr = "";
      let final: Record<string, unknown> | null = null;
      let settled = false;
      let linger: NodeJS.Timeout | null = null;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        killTree(child.pid);
        try {
          child.kill();
        } catch {
          /* déjà terminé */
        }
        reject(new ClaudeCliError(message));
      };
      const timer = setTimeout(() => fail(`Claude Code n'a pas répondu en ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
      const onAbort = () => fail("Appel annulé");
      req.signal?.addEventListener("abort", onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        if (linger) clearTimeout(linger);
        req.signal?.removeEventListener("abort", onAbort);
      };

      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          if (req.streamLog) {
            try {
              appendFileSync(req.streamLog, line + "\n");
            } catch {
              /* journal brut facultatif */
            }
          }
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (msg.type === "result") {
            final = msg;
            // Le résultat est rendu mais un processus fils (serveur lancé par l'agent) peut retenir Claude Code :
            // après un délai de grâce, l'arbre est fermé et le résultat gardé.
            linger ??= setTimeout(() => killTree(child.pid), 15_000);
          } else if (req.onEvent) relay(msg, req.onEvent);
        }
      });
      child.stderr?.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));
      child.on("error", (e) => fail(`Impossible de lancer Claude Code (« ${this.#binary} » est-il installé et sur le PATH ?) : ${e.message}`));
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (final) resolve(final);
        else reject(new ClaudeCliError(`Claude Code s'est arrêté sans résultat (code ${code}) : ${stderr.slice(-300) || "aucun message"}`));
      });
      child.stdin?.end(req.prompt, "utf8");
    });
  }
}

/** Traduit le flux stream-json en lignes lisibles pour la progression d'un travail. */
export function relay(msg: Record<string, unknown>, onEvent: (e: ClaudeEvent) => void): void {
  const content = ((msg.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[];
  if (!Array.isArray(content)) return;
  if (msg.type === "assistant") {
    for (const c of content) {
      if (c.type === "text" && String(c.text ?? "").trim()) onEvent({ kind: "text", text: String(c.text).trim().slice(0, 2000) });
      if (c.type === "tool_use") onEvent({ kind: "tool", text: describeTool(String(c.name), (c.input ?? {}) as Record<string, unknown>) });
    }
  } else if (msg.type === "user") {
    for (const c of content) {
      if (c.type === "tool_result" && c.is_error) {
        const text = Array.isArray(c.content) ? (c.content as { text?: string }[]).map((x) => x.text ?? "").join(" ") : String(c.content ?? "");
        onEvent({ kind: "error", text: text.slice(0, 500) });
      }
    }
  }
}

export function describeTool(name: string, input: Record<string, unknown>): string {
  const path = String(input.file_path ?? input.path ?? "");
  switch (name) {
    case "Read":
      return `Lit ${path}`;
    case "Edit":
      return `Modifie ${path}`;
    case "Write":
      return `Écrit ${path}`;
    case "Grep":
      return `Cherche « ${String(input.pattern ?? "")} »`;
    case "Glob":
      return `Liste ${String(input.pattern ?? "")}`;
    case "Bash":
      return `Commande : ${String(input.command ?? "")}`;
    case "Skill":
      return `Consulte le skill ${String(input.skill ?? input.name ?? "")}`;
    default:
      return name;
  }
}

/** Ferme un processus et tous ses descendants (sous Windows, `taskkill /T`). */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    else process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* déjà terminé */
    }
  }
}
