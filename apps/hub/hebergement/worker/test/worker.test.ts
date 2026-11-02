/**
 * Tests du Worker « liverdian-demos » : `Request` simulées, assets et KV en mémoire.
 * Aucun compte Cloudflare, aucun réseau — le comportement exact (Host, réécriture, comptage, aperçu).
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handle, slugDuHost, type AssetsFetcher, type Env, type KVNamespace, type MetaDemo, type WorkerContext } from "../src/worker.ts";

const DOMAINE = "demo.mondomaine.fr";
const SECRET = "secret-de-test";
const UA_NAVIGATEUR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const UA_ROBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

/** KV en mémoire : même interface minimale que Workers KV (get json / put). */
class KvMemo implements KVNamespace {
  map = new Map<string, string>();
  async get(key: string, type?: "json"): Promise<unknown> {
    const v = this.map.get(key);
    if (v === undefined) return null;
    return type === "json" ? JSON.parse(v) : v;
  }
  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
}

/** Contenu type d'un assemblage de démos. */
type Fichier = { type?: string; corps?: string };

/** Assets en mémoire : sert `<slug>/<chemin>`, avec index.html pour les dossiers, comme Static Assets. */
function assetsDepuis(fichiers: Record<string, Fichier>): AssetsFetcher {
  const typePour = (chemin: string, f: Fichier) => f.type ?? (chemin.endsWith(".css") ? "text/css" : chemin.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
  return {
    async fetch(request: Request): Promise<Response> {
      const chemin = new URL(request.url).pathname.replace(/^\/+/, "");
      const clefs = chemin.endsWith("/") || chemin === "" ? [`${chemin}index.html`, `${chemin}index.htm`] : [chemin];
      for (const cle of clefs) {
        const f = fichiers[cle];
        if (f) return new Response(f.corps ?? "", { headers: { "content-type": typePour(cle, f) } });
      }
      return new Response("Not Found", { status: 404 });
    },
  };
}

function env(fichiers: Record<string, Fichier>, meta: Record<string, MetaDemo> = {}, kv = new KvMemo()): Env {
  for (const [slug, m] of Object.entries(meta)) kv.map.set(`d:${slug}`, JSON.stringify(m));
  return { ASSETS: assetsDepuis(fichiers), DEMOS: kv, APERCU_SECRET: SECRET, DEMO_DOMAINE: DOMAINE };
}

function requete(slug: string, chemin = "/", init: RequestInit = {}, hote = DOMAINE): Request {
  return new Request(`https://${slug}.${hote}${chemin}`, init);
}

/** Jeton d'aperçu côté hub (node:crypto) : doit coïncider avec le WebCrypto du worker. */
function jetonHub(slug: string): string {
  return createHmac("sha256", SECRET).update(slug).digest("hex");
}

const ctx: WorkerContext = { waitUntil: () => undefined };

// ── Slug depuis le Host ──────────────────────────────────────────────────

describe("slugDuHost", () => {
  it("extrait le slug d'un hôte de démo", () => {
    expect(slugDuHost("lumen-elec.demo.mondomaine.fr", DOMAINE)).toBe("lumen-elec");
    expect(slugDuHost("LUMEN-ELEC.demo.Mondomaine.FR", DOMAINE)).toBe("lumen-elec");
    expect(slugDuHost("lumen-elec.demo.mondomaine.fr:8080", DOMAINE)).toBe("lumen-elec");
    expect(slugDuHost("a.demo.mondomaine.fr", DOMAINE)).toBe("a");
  });
  it("refuse ce qui n'est pas une démo", () => {
    expect(slugDuHost("demo.mondomaine.fr", DOMAINE)).toBeNull(); // apex
    expect(slugDuHost("www.liverdian.fr", DOMAINE)).toBeNull(); // mauvais domaine
    expect(slugDuHost("lumen-elec.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("lumen-elec.autre.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("", DOMAINE)).toBeNull();
  });
  it("refuse les slugs invalides", () => {
    expect(slugDuHost("www.demo.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("-abc.demo.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("abc-.demo.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("ab_c.demo.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("a".repeat(64) + ".demo.mondomaine.fr", DOMAINE)).toBeNull();
    expect(slugDuHost("élan.demo.mondomaine.fr", DOMAINE)).toBeNull();
  });
});

// ── Service des pages ────────────────────────────────────────────────────

describe("service des démos", () => {
  it("sert la page d'accueil depuis le dossier du slug", async () => {
    const requetes: string[] = [];
    const fichiers: Record<string, Fichier> = { "lumen-elec/index.html": { corps: "<h1>Lumen Élec</h1>" } };
    const e = env(fichiers);
    e.ASSETS = { fetch: async (r) => { requetes.push(new URL(r.url).pathname); return assetsDepuis(fichiers).fetch(r); } };
    const r = await handle(requete("lumen-elec"), e, ctx);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Lumen Élec");
    expect(requetes).toEqual(["/lumen-elec/"]);
  });

  it("sert une sous-page et index.html pour un dossier", async () => {
    const fichiers: Record<string, Fichier> = {
      "lumen-elec/contact/index.html": { corps: "Contact" },
      "lumen-elec/produits/index.html": { corps: "Produits" },
      "lumen-elec/a-propos.html": { corps: "À propos" },
    };
    const e = env(fichiers);
    expect(await (await handle(requete("lumen-elec", "/contact"), e, ctx)).text()).toContain("Contact");
    expect(await (await handle(requete("lumen-elec", "/produits/"), e, ctx)).text()).toContain("Produits");
    expect(await (await handle(requete("lumen-elec", "/a-propos.html"), e, ctx)).text()).toContain("À propos");
  });

  it("répond 404 en français pour un fichier inconnu d'un slug vivant", async () => {
    const e = env({ "lumen-elec/index.html": {} });
    const r = await handle(requete("lumen-elec", "/nulle-part"), e, ctx);
    expect(r.status).toBe(404);
    const corps = await r.text();
    expect(corps).toContain("Page introuvable");
    expect(corps).toContain("lumen-elec");
  });

  it("affiche « Cette maquette a expiré » quand le slug a une fiche KV et plus d'assets", async () => {
    const e = env({}, { "vieux-site": { etat: "expiree", expireLe: "2026-11-02T10:00:00Z" } });
    const r = await handle(requete("vieux-site"), e, ctx);
    expect(r.status).toBe(410);
    const corps = await r.text();
    expect(corps).toContain("Cette maquette a expiré");
    expect(corps).toContain("arrivée à échéance");
  });

  it("distingue une maquette retirée", async () => {
    const e = env({}, { "ex-site": { etat: "retiree", retireeLe: "2026-10-01T10:00:00Z" } });
    const r = await handle(requete("ex-site"), e, ctx);
    expect(r.status).toBe(410);
    expect(await r.text()).toContain("retirée");
  });

  it("répond 404 pour une adresse hors du domaine des démos", async () => {
    const e = env({});
    const r = await handle(requete("x", "/", {}, "www.liverdian.fr"), e, ctx);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("Adresse inconnue");
  });

  it("refuse les méthodes autres que GET et HEAD", async () => {
    const e = env({});
    const r = await handle(requete("lumen-elec", "/", { method: "POST" }), e, ctx);
    expect(r.status).toBe(405);
  });
});

// ── En-têtes ─────────────────────────────────────────────────────────────

describe("en-têtes", () => {
  it("pose noindex, nosniff, referrer-policy et un cache court sur le HTML", async () => {
    const e = env({ "lumen-elec/index.html": { corps: "<h1>x</h1>" } });
    const r = await handle(requete("lumen-elec"), e, ctx);
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("cache longtemps les assets au contenu haché (_astro, noms à empreinte)", async () => {
    const e = env({ "lumen-elec/_astro/main.abc123def.js": { type: "text/javascript", corps: "x" }, "lumen-elec/fonts/police.1a2b3c4d.woff2": { type: "font/woff2", corps: "x" } });
    expect((await handle(requete("lumen-elec", "/_astro/main.abc123def.js"), e, ctx)).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await handle(requete("lumen-elec", "/fonts/police.1a2b3c4d.woff2"), e, ctx)).headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("applique les en-têtes aussi sur les pages 404 et expirées", async () => {
    const e = env({}, { "ex": { etat: "retiree" } });
    const r = await handle(requete("ex"), e, ctx);
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

// ── Comptage des visites ─────────────────────────────────────────────────

describe("comptage des visites", () => {
  it("compte une visite de page par un navigateur", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": { corps: "<h1>x</h1>" } }, {}, kv);
    const r = await handle(requete("lumen-elec", "/", { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 5)); // laisse passer le waitUntil simulé
    const v = (await kv.get("v:lumen-elec", "json")) as { t: number; f: string; l: string };
    expect(v.t).toBe(1);
    expect(typeof v.f).toBe("string");
    expect(typeof v.l).toBe("string");
  });

  it("cumule les visites sans écraser la première", async () => {
    const kv = new KvMemo();
    kv.map.set("v:lumen-elec", JSON.stringify({ t: 3, f: "2026-10-30T10:00:00Z", l: "2026-10-31T10:00:00Z" }));
    const e = env({ "lumen-elec/index.html": {} }, {}, kv);
    await handle(requete("lumen-elec", "/", { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    await new Promise((res) => setTimeout(res, 5));
    const v = (await kv.get("v:lumen-elec", "json")) as { t: number; f: string };
    expect(v.t).toBe(4);
    expect(v.f).toBe("2026-10-30T10:00:00Z");
  });

  it("ignore les robots connus", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": {} }, {}, kv);
    await handle(requete("lumen-elec", "/", { headers: { "user-agent": UA_ROBOT } }), e, ctx);
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });

  it("ne compte pas les fichiers (css, js)", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/style.css": { type: "text/css", corps: "body{}" } }, {}, kv);
    await handle(requete("lumen-elec", "/style.css", { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });

  it("ne compte pas un HEAD", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": {} }, {}, kv);
    const r = await handle(requete("lumen-elec", "/", { method: "HEAD", headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });

  it("ne compte pas non plus une page en erreur", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": { type: "text/html", corps: "" } }, {}, kv);
    e.ASSETS = { fetch: async () => new Response("Interdit", { status: 403, headers: { "content-type": "text/html" } }) };
    const r = await handle(requete("lumen-elec", "/", { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.status).toBe(403);
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });
});

// ── Aperçu du propriétaire ───────────────────────────────────────────────

describe("aperçu du propriétaire", () => {
  it("reconnaît le jeton HMAC (même calcul que le hub, node:crypto) et ne compte pas", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": { corps: "<h1>x</h1>" } }, {}, kv);
    const r = await handle(requete("lumen-elec", `/?apercu=${jetonHub("lumen-elec")}`, { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toContain("ld-apercu=1");
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });

  it("retire le paramètre apercu avant de servir les assets", async () => {
    const requetes: string[] = [];
    const fichiers: Record<string, Fichier> = { "lumen-elec/index.html": { corps: "<h1>x</h1>" } };
    const e = env(fichiers);
    e.ASSETS = { fetch: async (r) => { requetes.push(new URL(r.url).search); return assetsDepuis(fichiers).fetch(r); } };
    await handle(requete("lumen-elec", `/?apercu=${jetonHub("lumen-elec")}`), e, ctx);
    expect(requetes[0]).toBe("");
  });

  it("un jeton invalide est ignoré : la visite compte et aucun cookie n'est posé", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": { corps: "<h1>x</h1>" } }, {}, kv);
    const r = await handle(requete("lumen-elec", "/?apercu=mauvais-jeton", { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.headers.get("set-cookie")).toBeNull();
    await new Promise((res) => setTimeout(res, 5));
    const v = (await kv.get("v:lumen-elec", "json")) as { t: number };
    expect(v.t).toBe(1);
  });

  it("le marqueur local (cookie) suffit pour les visites suivantes", async () => {
    const kv = new KvMemo();
    const e = env({ "lumen-elec/index.html": { corps: "<h1>x</h1>" } }, {}, kv);
    await handle(requete("lumen-elec", "/", { headers: { "user-agent": UA_NAVIGATEUR, cookie: "ld-apercu=1" } }), e, ctx);
    await new Promise((res) => setTimeout(res, 5));
    expect(await kv.get("v:lumen-elec", "json")).toBeNull();
  });

  it("le jeton d'un slug ne vaut pas pour un autre", async () => {
    const kv = new KvMemo();
    const e = env({ "autre/index.html": { corps: "<h1>x</h1>" } }, {}, kv);
    const r = await handle(requete("autre", `/?apercu=${jetonHub("lumen-elec")}`, { headers: { "user-agent": UA_NAVIGATEUR } }), e, ctx);
    expect(r.headers.get("set-cookie")).toBeNull();
    await new Promise((res) => setTimeout(res, 5));
    const v = (await kv.get("v:autre", "json")) as { t: number };
    expect(v.t).toBe(1);
  });
});
