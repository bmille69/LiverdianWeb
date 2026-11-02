import { createHash } from "node:crypto";
import { parseJson, type Db } from "../db/database.ts";

/** Le `fetch` standard (remplacé par un faux dans les tests). */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = "LiverdianAudit/0.1 (prospection locale ; une visite légère par site, robots.txt respecté)";

export class ReseauError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ReseauError";
    this.status = status;
  }
}

const sommeil = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("Annulé"));
      },
      { once: true },
    );
  });

/**
 * Accès réseau poli : une file par hôte avec un intervalle minimum entre deux requêtes, reprise sur 429 et 5xx
 * (en-tête Retry-After respecté, sinon attente doublée), délai maximum par requête. `pause: false` (tests) coupe
 * les attentes.
 */
export class Reseau {
  readonly #fetch: HttpFetch;
  readonly #intervalles: Record<string, number>;
  readonly #pause: boolean;
  readonly #prochain = new Map<string, number>();
  readonly #files = new Map<string, Promise<unknown>>();

  constructor(opts: { fetch?: HttpFetch; intervalles?: Record<string, number>; pause?: boolean } = {}) {
    this.#fetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.#intervalles = opts.intervalles ?? {};
    this.#pause = opts.pause ?? true;
  }

  get pause(): boolean {
    return this.#pause;
  }

  attendre(ms: number, signal?: AbortSignal): Promise<void> {
    return this.#pause ? sommeil(ms, signal) : Promise.resolve();
  }

  #intervalle(host: string): number {
    return this.#intervalles[host] ?? this.#intervalles["*"] ?? 1000;
  }

  /** Une requête, sérialisée avec les autres requêtes vers le même hôte. */
  async requete(url: string, init: RequestInit & { timeoutMs?: number; essais?: number; signal?: AbortSignal } = {}): Promise<Response> {
    const host = new URL(url).host;
    const precedente = this.#files.get(host) ?? Promise.resolve();
    const suite = precedente.catch(() => {}).then(() => this.#executer(host, url, init));
    this.#files.set(host, suite);
    return suite;
  }

  async #executer(host: string, url: string, init: RequestInit & { timeoutMs?: number; essais?: number; signal?: AbortSignal }): Promise<Response> {
    const essais = Math.max(1, init.essais ?? 4);
    let attente = 2000;
    for (let i = 1; ; i++) {
      if (this.#pause) {
        const delai = (this.#prochain.get(host) ?? 0) - Date.now();
        if (delai > 0) await sommeil(delai, init.signal ?? undefined);
      }
      this.#prochain.set(host, Date.now() + this.#intervalle(host));
      const timeout = AbortSignal.timeout(init.timeoutMs ?? 20_000);
      let res: Response;
      try {
        res = await this.#fetch(url, {
          ...init,
          headers: { "user-agent": USER_AGENT, ...(init.headers as Record<string, string> | undefined) },
          signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        });
      } catch (err) {
        if (init.signal?.aborted) throw err;
        if (i >= essais) throw new ReseauError(`${host} injoignable : ${messageReseau(err)}`);
        await this.attendre(attente, init.signal ?? undefined);
        attente *= 2;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && i < essais) {
        const retry = Number(res.headers.get("retry-after"));
        await res.body?.cancel().catch(() => {});
        await this.attendre(Number.isFinite(retry) && retry > 0 ? Math.min(retry, 120) * 1000 : attente, init.signal ?? undefined);
        attente *= 2;
        continue;
      }
      return res;
    }
  }
}

/** Message lisible d'une erreur de fetch (Node range la vraie cause dans `cause`). */
export function messageReseau(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const code = e.cause?.code;
  if (code) return code;
  return e.cause?.message ?? e.message ?? String(err);
}

/** Cache des réponses des API (table api_cache) : la clé ne contient jamais de clé d'API. */
export class ApiCache {
  readonly #db: Db;
  readonly #now: () => Date;
  constructor(db: Db, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
  }

  static cle(source: string, ...parts: unknown[]): string {
    return `${source}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40)}`;
  }

  get<T>(cle: string): T | null {
    const row = this.#db.prepare("SELECT reponse_json, expire_le FROM api_cache WHERE cle = ?").get(cle) as { reponse_json: string; expire_le: string } | undefined;
    if (!row || row.expire_le < this.#now().toISOString()) return null;
    return parseJson<T | null>(row.reponse_json, null);
  }

  set(cle: string, source: string, valeur: unknown, dureeMs: number): void {
    const at = this.#now();
    this.#db
      .prepare("INSERT INTO api_cache (cle, source, reponse_json, created_at, expire_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT(cle) DO UPDATE SET reponse_json = excluded.reponse_json, created_at = excluded.created_at, expire_le = excluded.expire_le")
      .run(cle, source, JSON.stringify(valeur), at.toISOString(), new Date(at.getTime() + dureeMs).toISOString());
  }

  /** Supprime les réponses expirées (appelé avec la purge). */
  nettoyer(): number {
    return Number(this.#db.prepare("DELETE FROM api_cache WHERE expire_le < ?").run(this.#now().toISOString()).changes);
  }
}

/** Compteur des appels réellement envoyés aux API (hors cache). */
export class Compteur {
  readonly #db: Db;
  readonly #now: () => Date;
  constructor(db: Db, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
  }

  noter(source: string, opts: { campagneId?: string | null; coutUsd?: number; statut?: number | null } = {}): void {
    this.#db.prepare("INSERT INTO api_appels (at, source, campagne_id, cout_usd, statut) VALUES (?, ?, ?, ?, ?)").run(this.#now().toISOString(), source, opts.campagneId ?? null, opts.coutUsd ?? 0, opts.statut ?? null);
  }

  /** Appels du mois civil en cours (heure de Paris approchée par UTC : le plafond garde une marge). */
  duMois(source: string): { appels: number; coutUsd: number } {
    const d = this.#now();
    const debut = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const r = this.#db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cout_usd), 0) AS c FROM api_appels WHERE source = ? AND at >= ?").get(source, debut) as { n: number; c: number };
    return { appels: Number(r.n), coutUsd: Number(r.c) };
  }

  parCampagne(campagneId: string): Record<string, { appels: number; coutUsd: number }> {
    const rows = this.#db.prepare("SELECT source, COUNT(*) AS n, COALESCE(SUM(cout_usd), 0) AS c FROM api_appels WHERE campagne_id = ? GROUP BY source").all(campagneId) as { source: string; n: number; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.source, { appels: Number(r.n), coutUsd: Number(r.c) }]));
  }
}

