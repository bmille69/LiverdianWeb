/**
 * Lancement de wrangler pour déployer le Worker « liverdian-demos » (ADR-15).
 * wrangler est une dépendance du hub (jamais une installation globale) : son script `bin/wrangler.js`
 * est exécuté avec le node du hub. Les secrets Cloudflare ne sont passés que dans l'environnement
 * de l'enfant (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID), jamais dans la configuration.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Spawner } from "../agents/claude-cli.ts";
import { HubError } from "../domain/errors.ts";
import { killTree } from "../agents/claude-cli.ts";

export type RunResult = { code: number | null; stdout: string; stderr: string; dureeMs: number };

/** Exécute un programme, capture sa sortie, le tue s'il dépasse le délai ou si le travail est annulé. */
export function runProcess(args: { binary: string; cmd: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number; signal?: AbortSignal; spawner?: Spawner; onLine?: (l: string) => void }): Promise<RunResult> {
  const spawner = args.spawner ?? spawn;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawner(args.binary, args.cmd, { cwd: args.cwd, env: args.env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let partial = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      killTree(child.pid);
      finish(() => reject(new HubError("Déploiement annulé", 409)));
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(() => reject(new HubError("Le déploiement a dépassé 10 minutes", 504)));
    }, args.timeoutMs ?? 10 * 60_000);
    args.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      stdout += c;
      if (args.onLine) {
        partial += c;
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) args.onLine(l.trim());
      }
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-20000)));
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr, dureeMs: Date.now() - t0 })));
    child.stdin.end(args.stdin ?? "");
  });
}

export type WranglerOptions = {
  /** Dossier de l'hébergement (.data/hebergement) : la configuration y est écrite. */
  configDir: string;
  /** Chemin absolu du worker.ts à déployer. */
  workerFile: string;
  /** Chemin du script wrangler.js (réglage « hebergement.wranglerBin » résolu), sinon celui du dépôt. */
  binary: string | null;
  /** Variables d'environnement de l'enfant (secrets Cloudflare ajoutés par l'appelant). */
  env: NodeJS.ProcessEnv;
  spawner?: Spawner;
  signal?: AbortSignal;
}

/** Résout le script wrangler : réglage, sinon la dépendance du dépôt. */
export function wranglerDuDepot(): string {
  const candidats = [
    join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js"),
    join(process.cwd(), "apps", "hub", "node_modules", "wrangler", "bin", "wrangler.js"),
  ];
  const trouve = candidats.find((c) => existsSync(c));
  if (!trouve) throw new HubError("wrangler est introuvable : lancez « npm install » à la racine du dépôt.", 500);
  return trouve;
}

/** Écrit la configuration wrangler de l'assemblage (les chemins sont relatifs au dossier de config). */
export function ecrireConfig(configDir: string, workerFile: string, namespaceId: string, domaine: string): string {
  mkdirSync(configDir, { recursive: true });
  const rel = relative(configDir, workerFile).split("\\").join("/");
  const conf = {
    name: "liverdian-demos",
    main: rel,
    compatibility_date: "2026-11-01",
    // Servi uniquement par la route *.<domaine> : pas d'adresse workers.dev (sur un compte neuf, wrangler
    // voudrait d'abord en réserver une, de façon interactive) ni d'URL d'aperçu publique.
    workers_dev: false,
    preview_urls: false,
    // `binding` : le Worker lit les fichiers via env.ASSETS (sans lui, plantage en production).
    // `run_worker_first: true` : toute requête passe par le Worker (choix de la démo selon le Host,
    // en-têtes noindex/sécurité, compteur) — sinon /<slug>/… serait servi tel quel depuis n'importe quel sous-domaine.
    assets: { directory: "./demos", binding: "ASSETS", run_worker_first: true },
    kv_namespaces: [{ binding: "DEMOS", id: namespaceId }],
    // Le Worker découpe `<slug>` devant le domaine (`<slug>.<domaine>`).
    vars: { DEMO_DOMAINE: domaine },
  };
  const file = join(configDir, "wrangler.jsonc");
  writeFileSync(file, JSON.stringify(conf, null, 2) + "\n", "utf8");
  return file;
}

export class Wrangler {
  readonly workerFile: string;
  readonly #opts: WranglerOptions;
  constructor(opts: WranglerOptions) {
    this.#opts = opts;
    this.workerFile = opts.workerFile;
  }

  #binary(): string {
    if (!this.#opts.binary) return wranglerDuDepot();
    if (existsSync(this.#opts.binary)) return this.#opts.binary;
    throw new HubError(`Le programme wrangler indiqué dans Réglages n'existe pas : ${this.#opts.binary}`, 400);
  }

  #run(cmd: string[], opts: { stdin?: string; onLine?: (l: string) => void } = {}): Promise<RunResult> {
    const bin = this.#binary();
    // Un script .js/.mjs (celui du dépôt ou un faux pour les tests) tourne sous le node du hub.
    const [binary, args] = /\.(m?js)$/i.test(bin) ? [process.execPath, [bin, ...cmd]] : [bin, cmd];
    return runProcess({ binary, cmd: args, cwd: this.#opts.configDir, env: this.#opts.env, stdin: opts.stdin, signal: this.#opts.signal, spawner: this.#opts.spawner, onLine: opts.onLine });
  }

  /** Déploie le Worker et ses assets. wrangler n'envoie que les fichiers modifiés (vérifié, voir ADR-15). */
  async deployer(onLine?: (l: string) => void): Promise<RunResult> {
    const r = await this.#run(["deploy", "--config", join(this.#opts.configDir, "wrangler.jsonc")], { onLine });
    if (r.code !== 0) throw new HubError(`Le déploiement a échoué : ${r.stderr.trim().slice(-600) || r.stdout.trim().slice(-600) || `code ${r.code}`}`, 500);
    return r;
  }

  /** Pose le secret d'aperçu sur le Worker (objet JSON sur l'entrée standard, sans interaction). */
  async secrets(secret: Record<string, string>): Promise<RunResult> {
    const r = await this.#run(["secret", "bulk", "--config", join(this.#opts.configDir, "wrangler.jsonc")], { stdin: JSON.stringify(secret) });
    if (r.code !== 0) throw new HubError(`Le secret n'a pas pu être posé : ${r.stderr.trim().slice(-400)}`, 500);
    return r;
  }
}
