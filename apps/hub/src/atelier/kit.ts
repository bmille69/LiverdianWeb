import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { killTree } from "../agents/claude-cli.ts";
import { Semaphore } from "../agents/semaphore.ts";

/**
 * Accès au kit de sites (`packages/site-kit`) : génération d'un projet, contrôle automatique, découpe des
 * captures. Le hub lance les scripts du kit comme des programmes (pas d'import du kit dans le hub : il garde
 * ses propres dépendances). Abstrait pour les tests de la machine à états.
 */
export type CheckReport = {
  ok: boolean;
  demo: boolean | null;
  build: { ok: boolean; dureeMs: number; erreur?: string; avertissements?: string[] };
  lighthouse: {
    performance: number;
    accessibilite: number;
    bonnesPratiques: number;
    seo: number;
    metriques?: Record<string, number>;
    auditsRates?: Record<string, { id: string; titre: string; score: number | null }[]>;
  } | null;
  axe: { graves: number; violations: { id: string; impact: string; aide: string; noeuds: number; exemples: string[] }[] } | null;
  controles: { id: string; ok: boolean; bloquant: boolean; detail: string }[];
  captures: Record<string, string>;
  echecs: string[];
};

export type NewSiteResult = { ok: true } | { ok: false; message: string; erreurs: string[] };

export interface KitRunner {
  /** Génère (ou régénère) le projet Astro du site à partir d'un site.json. */
  newSite(siteDir: string, siteJsonPath: string, signal?: AbortSignal): Promise<NewSiteResult>;
  /** Build + Lighthouse + axe + captures → `<site>/.check/check-report.json`. */
  checkSite(siteDir: string, signal?: AbortSignal, onLine?: (l: string) => void): Promise<CheckReport>;
  /** Découpe les captures de `.check/` en tranches lisibles par vision, et fait la vignette. */
  decouperCaptures(siteDir: string, outDir: string, signal?: AbortSignal): Promise<string[]>;
  /** Palettes et réglages par défaut des préréglages de thème du kit. */
  presets(): Promise<Record<string, { description: string; couleurs: Record<string, string>; polices: { titres: string; corps: string }; rayon: number; signature: string }>>;
  /** Vérifie les contrastes d'un thème (surcharges comprises) : liste d'erreurs, vide si conforme. */
  contrastes(theme: unknown): Promise<string[]>;
  /** Noms d'icônes Lucide disponibles pour le kit (une icône inconnue casse le build). */
  icones(): Set<string>;
  /** Catalogue de la banque d'images (stock/CREDITS.json). */
  credits(): { fichier: string; metier: string; description: string; orientation: string; hero: boolean; largeur: number; hauteur: number }[];
  readonly root: string;
}

type RunResult = { code: number | null; stdout: string; stderr: string };

function runNode(args: string[], opts: { cwd: string; signal?: AbortSignal; timeoutMs: number; onLine?: (l: string) => void }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      killTree(child.pid);
      finish(() => reject(new Error("Contrôle annulé")));
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      finish(() => reject(new Error(`Le script du kit n'a pas terminé en ${Math.round(opts.timeoutMs / 60000)} min`)));
    }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let partial = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      stdout += c;
      if (opts.onLine) {
        partial += c;
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) opts.onLine(l.trim());
      }
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr = (stderr + c).slice(-20000)));
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));
  });
}

function lastJson(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const l of lines) {
    try {
      return JSON.parse(l) as Record<string, unknown>;
    } catch {
      /* ligne de texte */
    }
  }
  return null;
}

export class SiteKit implements KitRunner {
  readonly root: string;
  /** Lighthouse mesure mieux seul : un contrôle à la fois sur la machine. */
  readonly #checks = new Semaphore(1);
  readonly #runs: number;

  constructor(root: string, opts: { lighthouseRuns?: number } = {}) {
    this.root = root;
    this.#runs = opts.lighthouseRuns ?? 3;
  }

  async newSite(siteDir: string, siteJsonPath: string, signal?: AbortSignal): Promise<NewSiteResult> {
    const r = await runNode([join(this.root, "scripts", "new-site.mjs"), siteDir, siteJsonPath, "--force"], { cwd: this.root, signal, timeoutMs: 120_000 });
    const out = lastJson(r.stdout);
    if (out?.ok === true && r.code === 0) return { ok: true };
    const erreurs = Array.isArray(out?.erreurs) ? (out.erreurs as string[]) : [];
    return { ok: false, message: String(out?.message ?? (r.stderr.trim().slice(-500) || `code ${r.code}`)), erreurs };
  }

  checkSite(siteDir: string, signal?: AbortSignal, onLine?: (l: string) => void): Promise<CheckReport> {
    return this.#checks.run(async () => {
      const r = await runNode([join(this.root, "scripts", "check-site.mjs"), siteDir, "--runs", String(this.#runs)], { cwd: this.root, signal, timeoutMs: 15 * 60_000, onLine });
      const file = join(siteDir, ".check", "check-report.json");
      if (!existsSync(file)) throw new Error(`Le contrôle n'a pas produit de rapport (code ${r.code}) : ${r.stderr.trim().slice(-400)}`);
      const report = JSON.parse(readFileSync(file, "utf8")) as CheckReport;
      if (r.code === 2) throw new Error(`Erreur technique du contrôle : ${report.echecs.join(" ; ").slice(0, 400)}`);
      return report;
    }, signal);
  }

  async decouperCaptures(siteDir: string, outDir: string, signal?: AbortSignal): Promise<string[]> {
    const r = await runNode([join(this.root, "scripts", "decouper-captures.mjs"), join(siteDir, ".check"), outDir], { cwd: this.root, signal, timeoutMs: 120_000 });
    const out = lastJson(r.stdout);
    if (r.code !== 0 || !out?.ok) throw new Error(`Découpe des captures impossible : ${r.stderr.trim().slice(-300)}`);
    return out.fichiers as string[];
  }

  async #theme(): Promise<{ PRESETS_DEF: Awaited<ReturnType<KitRunner["presets"]>>; verifierContrastes: (c: Record<string, string>) => string[]; resoudreTheme: (t: unknown) => { couleurs: Record<string, string> } }> {
    // Import dynamique : theme.ts n'a que des imports de types, Node l'exécute tel quel.
    return (await import(pathToFileURL(join(this.root, "src", "lib", "theme.ts")).href)) as never;
  }

  async presets() {
    return (await this.#theme()).PRESETS_DEF;
  }

  async contrastes(theme: unknown): Promise<string[]> {
    const t = await this.#theme();
    return t.verifierContrastes(t.resoudreTheme(theme).couleurs);
  }

  icones(): Set<string> {
    const dir = join(this.root, "node_modules", "lucide-static", "icons");
    return new Set(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)) : []);
  }

  credits() {
    return JSON.parse(readFileSync(join(this.root, "stock", "CREDITS.json"), "utf8")) as ReturnType<KitRunner["credits"]>;
  }
}

/** Écrit un JSON lisible (fichiers d'étape : brief.json, design.json…). */
export function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
