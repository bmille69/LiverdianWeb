/**
 * Worker « liverdian-demos » (ADR-15) : sert toutes les démos publiées du hub.
 *
 * Un seul Worker avec Static Assets : chaque démo est un dossier `<slug>/` de l'assemblage
 * (`.data/hebergement/demos/`). L'en-tête `Host` donne le slug (`<slug>.<domaine>`),
 * le Worker réécrit le chemin en `/<slug>/<chemin>` et laisse les assets répondre.
 *
 * - Visites : comptées par slug dans Workers KV (`v:<slug>`), sans IP ni donnée personnelle.
 *   Robots connus ignorés ; le propriétaire ouvre avec `?apercu=<jeton>` (jeton = HMAC du slug,
 *   secret partagé avec le hub) : un marqueur local (cookie) est posé, ses visites ne comptent pas.
 * - Slug inconnu : page « Cette maquette a expiré » (s'il a existé, KV `d:<slug>`) ou 404 en français.
 * - En-têtes : noindex partout, sécurité, cache raisonnable (assets à contenu haché : 1 an).
 *
 * Aucune dépendance : Node 26 (fetch, crypto) suffit pour les tests ; wrangler le charge tel quel.
 */

export type KVNamespace = {
  get(key: string, type?: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

export type AssetsFetcher = { fetch(request: Request): Promise<Response> };

export interface Env {
  /** Static Assets (dossier d'assemblage), lié par la configuration wrangler. */
  ASSETS: AssetsFetcher;
  /** Workers KV « liverdian-demos » : compteurs `v:<slug>` et métadonnées `d:<slug>`. */
  DEMOS: KVNamespace;
  /** Secret du jeton d'aperçu (HMAC du slug), posé par le hub via `wrangler secret bulk`. */
  APERCU_SECRET: string;
  /** Suffixe des démos : « demo.mondomaine.fr » (variable posée par le hub au déploiement). */
  DEMO_DOMAINE: string;
}

export type WorkerContext = { waitUntil(promise: Promise<unknown>): void };

/** Robots et outils connus : leurs visites ne comptent pas. */
const BOTS =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|twitterbot|whatsapp|linkedinbot|pinterest|preview|scanner|curl|wget|python-requests|go-http-client|okhttp|java\/|headless|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|httpclient|axios|node-fetch|undici/i;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Jeton d'aperçu attendu pour un slug : HMAC-SHA256(secret, slug) en hexadécimal. */
async function jetonAttendu(slug: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(slug));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Lit l'en-tête Host et en tire le slug (`<slug>.<domaine>`), ou null. */
export function slugDuHost(host: string, domaine: string): string | null {
  const suffix = `.${domaine.toLowerCase()}`;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  if (!h.endsWith(suffix)) return null;
  const slug = h.slice(0, -suffix.length);
  if (!SLUG_RE.test(slug) || slug.includes(".") || slug === "www") return null;
  return slug;
}

export type MetaDemo = { etat: "en_ligne" | "expiree" | "retiree"; retireeLe?: string | null; expireLe?: string | null };

/** Page montrée quand une maquette a été retirée ou est arrivée à échéance. */
function pageExpiree(slug: string, meta: MetaDemo): Response {
  const quand =
    meta.etat === "expiree" && meta.expireLe
      ? `Elle est arrivée à échéance le ${new Date(meta.expireLe).toLocaleDateString("fr-FR")}.`
      : meta.etat === "retiree" && meta.retireeLe
        ? `Elle a été retirée le ${new Date(meta.retireeLe).toLocaleDateString("fr-FR")}.`
        : "Elle a été retirée.";
  return html(
    `Cette maquette a expiré`,
    `<main><h1>Cette maquette a expiré</h1><p>La démonstration « ${slug} » n'est plus en ligne. ${quand}</p><p>Merci de votre visite.</p></main>`,
    410,
  );
}

function page404(slug: string): Response {
  return html(
    `Page introuvable`,
    `<main><h1>Page introuvable</h1><p>Cette page n'existe pas dans la maquette « ${slug} ».</p><p><a href="/">Revenir à l'accueil de la maquette</a></p></main>`,
    404,
  );
}

function html(titre: string, corps: string, statut: number): Response {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${titre}</title>` +
      `<style>body{font-family:system-ui,sans-serif;background:#101214;color:#e8eaed;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:34rem;padding:2rem}h1{font-size:1.4rem}p{color:#b8bcc2;line-height:1.6}a{color:#7fd1c7}</style></head><body>${corps}</body></html>`,
    { status: statut, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Cache des réponses servies : les assets d'Astro sont hachés par contenu, le HTML est revu régulièrement. */
function cachePour(chemin: string, type: string): string {
  if (chemin.includes("/_astro/")) return "public, max-age=31536000, immutable";
  if (/\.[a-z0-9]{8,}\./i.test(chemin)) return "public, max-age=31536000, immutable";
  if (type.includes("text/html")) return "public, max-age=300";
  return "public, max-age=86400";
}

/** En-têtes communs : jamais d'indexation, jamais de fuite d'infos de navigation. */
function entetesCommunes(reponse: Response, chemin: string): Response {
  const h = new Headers(reponse.headers);
  h.set("x-robots-tag", "noindex, nofollow");
  h.set("x-content-type-options", "nosniff");
  h.set("referrer-policy", "same-origin");
  if (!h.has("cache-control")) h.set("cache-control", cachePour(chemin, h.get("content-type") ?? ""));
  return new Response(reponse.body, { status: reponse.status, statusText: reponse.statusText, headers: h });
}

/** Compte une visite du slug (page HTML servie, pas un robot, pas le propriétaire). */
async function compterVisite(slug: string, env: Env): Promise<void> {
  try {
    const key = `v:${slug}`;
    const prev = (await env.DEMOS.get(key, "json")) as { t?: number; f?: string; l?: string } | null;
    const maintenant = new Date().toISOString();
    const next = JSON.stringify({ t: (prev?.t ?? 0) + 1, f: prev?.f ?? maintenant, l: maintenant });
    await env.DEMOS.put(key, next);
  } catch {
    /* Comptage perdu (quota ou panne KV) : la visite est servie quand même. */
  }
}

export async function handle(request: Request, env: Env, ctx: WorkerContext | null = null): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Méthode non autorisée : les démos sont en lecture seule.", { status: 405, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const url = new URL(request.url);
  // L'en-tête Host fait foi (en local, curl et le hub pointent vers 127.0.0.1 avec l'hôte dans l'en-tête) ;
  // l'URL sert de repli (en production, elle porte déjà le nom d'origine).
  const hote = request.headers.get("host") ?? url.hostname;
  const slug = slugDuHost(hote, env.DEMO_DOMAINE);
  if (!slug) {
    return html("Adresse inconnue", `<main><h1>Adresse inconnue</h1><p>Cette adresse ne correspond à aucune maquette Liverdian.</p></main>`, 404);
  }

  // Visite du propriétaire : `?apercu=<jeton>` pose un marqueur local (cookie), sans comptage.
  const marque = (request.headers.get("cookie") ?? "").includes("ld-apercu=1");
  let reponseMarquee = false;
  if (!marque && url.searchParams.has("apercu")) {
    const jeton = url.searchParams.get("apercu") ?? "";
    const attendu = env.APERCU_SECRET ? await jetonAttendu(slug, env.APERCU_SECRET) : "";
    if (attendu && constantTimeEqual(jeton, attendu)) {
      reponseMarquee = true;
      url.searchParams.delete("apercu");
    }
  }

  // Les assets servent `/<slug>/<chemin>` ; index.html pour les dossiers (le slash final est conservé).
  const chemin = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const cheminSlug = `/${slug}/${chemin}`.replace(/\/+$/, "/");
  const cible = new URL(url.toString());
  cible.pathname = cheminSlug;
  cible.search = url.search;
  const servie = await env.ASSETS.fetch(new Request(cible, { method: request.method, headers: request.headers }));

  // Astro génère des dossiers (contact/index.html) dont les liens pointent vers /contact :
  // si le fichier exact manque, on retente sur l'index du dossier.
  let reponseServie = servie;
  if (servie.status === 404 && !cible.pathname.endsWith("/") && !/\.[^/]+$/.test(cible.pathname)) {
    const cibleIndex = new URL(cible.toString());
    cibleIndex.pathname = `${cible.pathname.replace(/\/+$/, "")}/index.html`;
    reponseServie = await env.ASSETS.fetch(new Request(cibleIndex, { method: request.method, headers: request.headers }));
    if (reponseServie.status === 404) reponseServie = servie; // page 404 du worker, pas celle des assets
  }

  if (reponseServie.status === 404) {
    // Slug disparu : la maquette a expiré ou a été retirée (le hub garde sa fiche dans KV), sinon 404 en français.
    const meta = (await env.DEMOS.get(`d:${slug}`, "json").catch(() => null)) as MetaDemo | null;
    const reponse = meta && meta.etat !== "en_ligne" ? pageExpiree(slug, meta) : page404(slug);
    return entetesCommunes(reponse, "/");
  }
  if (reponseServie.status !== 200) return entetesCommunes(reponseServie, cheminSlug);

  const type = reponseServie.headers.get("content-type") ?? "";
  const estPage = type.includes("text/html");
  const robot = BOTS.test(request.headers.get("user-agent") ?? "");
  // Une visite = un chargement de page (GET seulement) par un navigateur, ni robot ni propriétaire.
  if (request.method === "GET" && estPage && !robot && !marque && !reponseMarquee) {
    // Enregistré auprès du runtime dès maintenant : un travail de fond non déclaré peut être
    // abandonné une fois la réponse envoyée (vu en local : la lecture passait, l'écriture jamais).
    const comptage = compterVisite(slug, env);
    if (ctx) ctx.waitUntil(comptage);
    else void comptage;
  }

  let reponse = entetesCommunes(reponseServie, cheminSlug);
  if (reponseMarquee) {
    const h = new Headers(reponse.headers);
    // Marqueur local uniquement (ni tiers, ni suivi) : les prochaines visites de ce navigateur ne comptent pas.
    h.set("set-cookie", "ld-apercu=1; Path=/; Max-Age=86400; SameSite=Lax");
    reponse = new Response(reponse.body, { status: reponse.status, headers: h });
  }
  return reponse;
}

export default {
  fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    return handle(request, env, ctx);
  },
};
