/**
 * Client minimal de l'API Cloudflare v4 pour l'hébergement des démos (ADR-15) :
 * vérification du jeton, zone et enregistrements DNS, routes Workers, namespace KV et compteurs de visites.
 * Pas de SDK : quelques appels documentés, des messages d'erreur en français.
 */

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class CloudflareError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CloudflareError";
    this.status = status;
    this.code = code;
  }
}

export type ZoneInfo = { id: string; name: string; status: string };

export class Cloudflare {
  readonly #accountId: string;
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #base: string;

  constructor(opts: { accountId: string; token: string; fetch?: FetchLike; base?: string }) {
    this.#accountId = opts.accountId;
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#base = opts.base ?? "https://api.cloudflare.com/client/v4";
  }

  async #api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T } | null;
    if (!res.ok) {
      const message = body?.errors?.[0]?.message ?? `réponse ${res.status}`;
      throw new CloudflareError(message, res.status, body?.errors?.[0]?.code ? String(body.errors[0].code) : undefined);
    }
    if (body && body.success === false) {
      const message = body.errors?.[0]?.message ?? "erreur inconnue";
      throw new CloudflareError(message, res.status, body.errors?.[0]?.code ? String(body.errors[0].code) : undefined);
    }
    return (body as { result: T }).result;
  }

  /** Le jeton est-il reconnu par Cloudflare ? */
  async verifierJeton(): Promise<{ id: string; statut: string }> {
    return this.#api<{ id: string; status: string }>("/user/tokens/verify").then((r) => ({ id: r.id, statut: r.status }));
  }

  /** Le compte indiqué existe et est visible avec ce jeton. */
  async compte(): Promise<{ id: string; name: string }> {
    return this.#api<{ id: string; name: string }>(`/accounts/${this.#accountId}`);
  }

  /** La zone du domaine (null si le domaine n'est pas sur ce compte Cloudflare). */
  async zone(domaine: string): Promise<ZoneInfo | null> {
    const r = await this.#api<ZoneInfo[]>(`/zones?name=${encodeURIComponent(domaine)}&status=active&per_page=5`);
    return r[0] ?? null;
  }

  async enregistrementWildcard(zoneId: string, nom: string): Promise<{ present: boolean }> {
    const r = await this.#api<{ id: string }[]>(`/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(nom)}&per_page=5`);
    return { present: r.length > 0 };
  }

  /** CNAME `*.demo` pointé sur la zone, proxifié : les DNS publics n'exposent jamais l'origine. */
  async creerWildcard(zoneId: string, nom: string, contenu: string): Promise<void> {
    await this.#api(`/zones/${zoneId}/dns_records`, { method: "POST", body: JSON.stringify({ type: "CNAME", name: nom, content: contenu, proxied: true, ttl: 1 }) });
  }

  async routeWorker(zoneId: string, pattern: string): Promise<{ present: boolean }> {
    const r = await this.#api<{ pattern: string }[]>(`/zones/${zoneId}/workers/routes?per_page=100`);
    return { present: r.some((x) => x.pattern === pattern) };
  }

  /** Route du Worker sur `*.<domaine>/*`. */
  async creerRoute(zoneId: string, pattern: string, script: string): Promise<void> {
    await this.#api(`/zones/${zoneId}/workers/routes`, { method: "POST", body: JSON.stringify({ pattern, script }) });
  }

  /** Le script Worker est-il déjà déployé ? */
  async scriptDeploye(): Promise<boolean> {
    try {
      await this.#api(`/accounts/${this.#accountId}/workers/scripts/liverdian-demos`);
      return true;
    } catch (err) {
      if (err instanceof CloudflareError && err.status === 404) return false;
      throw err;
    }
  }

  /** Liste des espaces KV (lecture seule, pour le test de connexion). */
  async kvNamespaceList(): Promise<{ id: string; title: string }[]> {
    return this.#api<{ id: string; title: string }[]>(`/accounts/${this.#accountId}/storage/kv/namespaces?per_page=100`);
  }

  /** Namespace KV des démos : existant ou créé (idempotent). */
  async kvNamespace(): Promise<string> {
    const liste = await this.kvNamespaceList();
    const trouve = liste.find((n) => n.title === "liverdian-demos");
    if (trouve) return trouve.id;
    const cree = await this.#api<{ id: string }>(`/accounts/${this.#accountId}/storage/kv/namespaces`, { method: "POST", body: JSON.stringify({ title: "liverdian-demos" }) });
    return cree.id;
  }

  async kvExiste(nsId: string): Promise<boolean> {
    try {
      await this.#api(`/accounts/${this.#accountId}/storage/kv/namespaces/${nsId}`);
      return true;
    } catch (err) {
      if (err instanceof CloudflareError && (err.status === 404 || err.status === 400)) return false;
      throw err;
    }
  }

  /** Compteur de visites `v:<slug>` (KV lu en direct, cohérence éventuelle acceptée : signal commercial). */
  async lireVisites(nsId: string, slug: string): Promise<{ t: number; f: string; l: string } | null> {
    const res = await this.#fetch(`${this.#base}/accounts/${this.#accountId}/storage/kv/namespaces/${nsId}/values/v%3A${encodeURIComponent(slug)}`, {
      headers: { authorization: `Bearer ${this.#token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new CloudflareError(`Lecture du compteur impossible (réponse ${res.status})`, res.status);
    const texte = await res.text();
    try {
      const v = JSON.parse(texte) as { t: number; f: string; l: string };
      if (typeof v.t === "number") return v;
    } catch {
      /* clé corrompue : comme absente */
    }
    return null;
  }

  /** Fiche `d:<slug>` : qui était cette démo (pour la page « expirée » du Worker). */
  async ecrireMeta(nsId: string, slug: string, meta: Record<string, unknown>): Promise<void> {
    await this.#fetch(`${this.#base}/accounts/${this.#accountId}/storage/kv/namespaces/${nsId}/values/d%3A${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${this.#token}`, "content-type": "text/plain" },
      body: JSON.stringify(meta),
    }).then((res) => {
      if (!res.ok) throw new CloudflareError(`Écriture de la fiche impossible (réponse ${res.status})`, res.status);
    });
  }
}
