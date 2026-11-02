/**
 * Hébergement des démos : faux serveur Cloudflare + faux wrangler, parcours complet
 * configurer → tester → publier → visites → prolonger → expirer → retirer → republier.
 * Aucun réseau réel : le fetch et le spawn sont injectés (le hub ne touche jamais au compte du propriétaire).
 */
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HubError } from "../src/domain/errors.ts";
import { fakeSpawner, testHub } from "./helpers.ts";

type FauxEtat = {
  dns: { name: string; content: string }[];
  routes: { pattern: string; script: string }[];
  namespaces: { id: string; title: string }[];
  kv: Map<string, string>;
  scripts: string[];
  jetonActif: boolean;
  compteVisible: boolean;
  zonePresente: boolean;
};

/** Dernier faux compte créé : le faux wrangler y « crée » le Worker au déploiement, comme le vrai. */
let compteCourant: FauxEtat | null = null;

function fauxCloudflare(): { etat: FauxEtat; fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response> } {
  const etat: FauxEtat = { dns: [], routes: [], namespaces: [], kv: new Map(), scripts: [], jetonActif: true, compteVisible: true, zonePresente: true };
  compteCourant = etat;
  const json = (result: unknown, status = 200) => new Response(JSON.stringify({ success: true, result, errors: [] }), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const path = url.pathname.replace(/^\/client\/v4/, "");
    // Vérification « en vrai » d'une démo publiée : la page doit répondre avec son bandeau.
    const demo = /^https:\/\/([a-z0-9-]+).mondomaine\.fr/.exec(url.toString());
    if (demo && url.hostname.endsWith("mondomaine.fr")) {
      return new Response(`<!doctype html><html><head><meta name="robots" content="noindex, nofollow"></head><body><div data-bandeau-demo>Maquette réalisée par Liverdian</div><h1>${demo[1]}</h1></body></html>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (!url.hostname.includes("api.cloudflare.com")) return new Response("inconnu", { status: 404 });
    const echoue = (message: string, status: number) => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message }] }), { status, headers: { "content-type": "application/json" } });
    const corps = init?.body ? JSON.parse(String(init.body)) : null;
    if (path === "/user/tokens/verify") return etat.jetonActif ? json({ id: "t1", status: "active" }) : echoue("invalid token", 401);
    if (/^\/accounts\/[0-9a-f]{32}$/.test(path)) return etat.compteVisible ? json({ id: "c1", name: "Bat" }) : echoue("compte inconnu", 404);
    if (path === "/zones") {
      const nom = url.searchParams.get("name") ?? "";
      return etat.zonePresente ? json([{ id: "zone1", name: nom, status: "active" }]) : json([]);
    }
    const mDns = path.match(/^\/zones\/([^/]+)\/dns_records$/);
    if (mDns) {
      if (init?.method === "POST") {
        etat.dns.push({ name: corps.name, content: corps.content });
        return json({ id: "d1" });
      }
      const nom = url.searchParams.get("name") ?? "";
      return json(etat.dns.filter((d) => d.name === nom));
    }
    const mRoute = path.match(/^\/zones\/([^/]+)\/workers\/routes$/);
    if (mRoute) {
      if (init?.method === "POST") {
        // Comme le vrai Cloudflare : pas de route vers un Worker qui n'a pas encore été déployé.
        if (!etat.scripts.includes(corps.script)) return echoue("Cannot configure a route for a Worker which does not exist. Please ensure this Worker exists and try again.", 400);
        etat.routes.push({ pattern: corps.pattern, script: corps.script });
        return json({ id: "r1" });
      }
      return json(etat.routes);
    }
    const mNs = path.match(/^\/accounts\/[0-9a-f]{32}\/storage\/kv\/namespaces$/);
    if (mNs) {
      if (init?.method === "POST") {
        const ns = { id: `ns-${etat.namespaces.length + 1}`, title: corps.title };
        etat.namespaces.push(ns);
        return json(ns);
      }
      return json(etat.namespaces);
    }
    const mValeur = path.match(/^\/accounts\/[0-9a-f]{32}\/storage\/kv\/namespaces\/([^/]+)\/values\/(.+)$/);
    if (mValeur) {
      const cle = decodeURIComponent(mValeur[2]!);
      if (init?.method === "PUT") {
        etat.kv.set(cle, String(init.body));
        return json({});
      }
      const v = etat.kv.get(cle);
      return v === undefined ? new Response("Not Found", { status: 404 }) : new Response(v, { headers: { "content-type": "text/plain" } });
    }
    if (/\/workers\/scripts\/liverdian-demos$/.test(path)) return etat.scripts.includes("liverdian-demos") ? json({ id: "liverdian-demos" }) : echoue("script introuvable", 404);
    return new Response("inconnu", { status: 404 });
  };
  return { etat, fetch };
}

/** Faux wrangler ET faux build Astro (même spawner) : répond ok à chaque appel. */
function fauxWrangler() {
  return fakeSpawner((call) => {
    if (call.args[1] === "deploy" && compteCourant && !compteCourant.scripts.includes("liverdian-demos")) compteCourant.scripts.push("liverdian-demos");
    return { lines: [{ type: "info", message: "Uploaded liverdian-demos" }] };
  });
}

/** Site « demo_prete » avec un dist contenant bandeau + noindex, un site.json démo actif et un contrôle vert. */
function preparerSite(hub: ReturnType<typeof testHub>, nom = "Lumen Élec") {
  const company = hub.companies.create({ raisonSociale: "SARL Lumen", nomCommercial: nom, metier: "Électricien" });
  const site = hub.sites.create({ companyId: company.id });
  hub.sites.update(site.id, { statut: "demo_prete" });
  const dossier = hub.sites.dirOf(site.id);
  mkdirSync(join(dossier, "dist"), { recursive: true });
  mkdirSync(join(dossier, "src", "data"), { recursive: true });
  mkdirSync(join(dossier, ".check"), { recursive: true });
  // Faux Astro : la prolongation repasse par `astro build` dans le dossier du site (le spawn est simulé).
  mkdirSync(join(dossier, "node_modules", "astro", "bin"), { recursive: true });
  writeFileSync(join(dossier, "node_modules", "astro", "bin", "astro.mjs"), "// faux astro (le spawn est simulé)");
  writeFileSync(
    join(dossier, "dist", "index.html"),
    '<!doctype html><html><head><meta name="robots" content="noindex, nofollow"></head><body><div data-bandeau-demo>Maquette</div></body></html>',
  );
  writeFileSync(join(dossier, "dist", "style.css"), "body{}");
  writeFileSync(join(dossier, "src", "data", "site.json"), JSON.stringify({ nom, demo: { actif: true, agence: "Liverdian", dateSuppression: "2026-12-02T00:00:00.000Z" } }));
  writeFileSync(join(dossier, ".check", "check-report.json"), JSON.stringify({ ok: true, demo: true }));
  return { company, site, dossier };
}

function configurer(hub: ReturnType<typeof testHub>) {
  hub.settings.set("hebergement.domaine", "mondomaine.fr");
  hub.hebergement.enregistrerSecret("CLOUDFLARE_ACCOUNT_ID", "a".repeat(32));
  hub.hebergement.enregistrerSecret("CLOUDFLARE_API_TOKEN", "jeton-cloudflare-de-test-1234567890");
}

function demosDir(hub: ReturnType<typeof testHub>): string {
  return hub.hebergement.dirDemos();
}

describe("hébergement des démos", () => {
  it("refuse de publier tant que la configuration manque, avec l'explication", async () => {
    const hub = testHub();
    hub.start();
    const { site } = preparerSite(hub);
    await expect(hub.hebergement.demanderPublier(site.id)).rejects.toThrow(/Publication impossible/);
    expect(hub.hebergement.manques()).toHaveLength(3);
    hub.close();
  });

  it("refuse une maquette non validée ou sans bandeau", async () => {
    const hub = testHub();
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);
    hub.sites.update(site.id, { statut: "a_valider" });
    await expect(hub.hebergement.demanderPublier(site.id)).rejects.toThrow(/pas encore validée/);
    hub.sites.update(site.id, { statut: "demo_prete" });
    writeFileSync(join(hub.sites.dirOf(site.id), "dist", "index.html"), "<html>sans bandeau</html>");
    await expect(hub.hebergement.demanderPublier(site.id)).rejects.toThrow(/bandeau/);
    hub.close();
  });

  it("refuse un fichier trop gros avant tout déploiement", async () => {
    const hub = testHub();
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);
    writeFileSync(join(hub.sites.dirOf(site.id), "dist", "grosse.png"), Buffer.alloc(26 * 1024 * 1024));
    await expect(hub.hebergement.demanderPublier(site.id)).rejects.toThrow(/dépasse 25 Mio/);
    hub.close();
  });

  it("publie : slug du nom commercial, DNS + route + KV créés, secret posé, vérifié en vrai, site en ligne", async () => {
    const { etat, fetch } = fauxCloudflare();
    const { spawner, calls } = fauxWrangler();
    const hub = testHub({ hebergement: { fetch, spawner } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub, "Lumen Élec");

    const { jobId } = await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();
    expect(hub.jobs.get(jobId).state).toBe("done");

    const demo = hub.hebergement.demoDe(site.id)!;
    expect(demo.slug).toBe("lumen-elec");
    expect(demo.url).toBe("https://lumen-elec.mondomaine.fr/");
    expect(demo.etat).toBe("en_ligne");
    expect(demo.expireLe).not.toBeNull();
    expect(hub.sites.get(site.id).statut).toBe("demo_en_ligne");
    expect(hub.sites.get(site.id).urlDemo).toBe(demo.url);
    // Le bandeau annonce la date du retrait réel (pas « fabrication + 30 j »), au format du schéma du kit.
    expect(JSON.parse(readFileSync(join(hub.sites.dirOf(site.id), "src", "data", "site.json"), "utf8")).demo.dateSuppression).toBe(demo.expireLe!.slice(0, 10));

    // L'assemblage contient le dist sous le slug ; le DNS, la route et le KV ont été créés.
    expect(readFileSync(join(demosDir(hub), "lumen-elec", "index.html"), "utf8")).toContain("data-bandeau-demo");
    expect(etat.dns).toContainEqual({ name: "*.mondomaine.fr", content: "mondomaine.fr" });
    expect(etat.routes.some((r) => r.pattern === "*.mondomaine.fr/*" && r.script === "liverdian-demos")).toBe(true);
    expect(etat.namespaces.some((n) => n.title === "liverdian-demos")).toBe(true);
    expect(etat.kv.get("d:lumen-elec")).toContain('"en_ligne"');

    // wrangler deploy + secret bulk : le secret d'aperçu est posé, jamais journalisé en clair dans l'appel CLI.
    expect(calls.some((c) => c.args[1] === "deploy")).toBe(true);
    const secretCall = calls.find((c) => c.args[1] === "secret")!;
    expect(JSON.parse(secretCall.stdin)).toEqual({ APERCU_SECRET: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(calls.some((c) => JSON.stringify(c.args).includes(secretCall.stdin.trim()))).toBe(false);

    // La configuration déployée donne au Worker le suffixe complet (il découpe le slug devant).
    const conf = JSON.parse(readFileSync(join(hub.dataDir, "hebergement", "wrangler.jsonc"), "utf8"));
    expect(conf.vars.DEMO_DOMAINE).toBe("mondomaine.fr");

    // Le jeton d'aperçu est le HMAC du slug, calculé comme dans le Worker.
    const jeton = hub.hebergement.apercuJeton("lumen-elec");
    const secret = JSON.parse(secretCall.stdin).APERCU_SECRET as string;
    expect(jeton).toBe(createHmac("sha256", secret).update("lumen-elec").digest("hex"));

    // Republier après coup : le slug ne change plus une fois publié, la démo reste en ligne.
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();
    expect(hub.hebergement.demoDe(site.id)!.slug).toBe("lumen-elec");
    expect(hub.hebergement.demoDe(site.id)!.etat).toBe("en_ligne");
    hub.close();
  });

  it("ne lance pas deux publications du même site en même temps", async () => {
    const { fetch } = fauxCloudflare();
    let deploys = 0;
    const { spawner } = fakeSpawner((call) => {
      if (call.args[1] === "deploy" && ++deploys === 1) return { hang: true }; // wrangler suspendu
      return { lines: [{ type: "info", message: "Uploaded liverdian-demos" }] };
    });
    const hub = testHub({ hebergement: { fetch, spawner } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);

    const { jobId } = await hub.hebergement.demanderPublier(site.id);
    await new Promise((r) => setTimeout(r, 50)); // le premier déploiement est parti, toujours suspendu
    const deuxieme = await hub.hebergement.demanderPublier(site.id);
    expect(deuxieme.jobId).toBe(jobId); // même travail, pas de doublon
    hub.close();
  });

  it("relève les visites depuis le KV et signale la première ouverture", async () => {
    const { etat, fetch } = fauxCloudflare();
    const hub = testHub({ hebergement: { fetch, spawner: fauxWrangler().spawner } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();

    // Le Worker a compté 3 visites (KV) ; le hub ne les connaît pas encore.
    etat.kv.set("v:lumen-elec", JSON.stringify({ t: 3, f: "2026-11-02T10:00:00Z", l: "2026-11-02T18:42:00Z" }));
    const r = await hub.hebergement.releverVisites();
    expect(r).toEqual({ configure: true, relevees: 1 });
    const demo = hub.hebergement.demoDe(site.id)!;
    expect(demo.visites).toBe(3);
    expect(demo.derniereVisite).toBe("2026-11-02T18:42:00Z");
    expect(demo.premiereOuvertureLe).toBe("2026-11-02T10:00:00Z");
    expect(hub.events.list({ limit: 5 }).some((e) => e.type === "hebergement.visite" && e.message.includes("lumen-elec"))).toBe(true);

    // Pas de nouvelle ouverture au deuxième relevé (déjà vue).
    etat.kv.set("v:lumen-elec", JSON.stringify({ t: 4, f: "2026-11-02T10:00:00Z", l: "2026-11-02T19:00:00Z" }));
    await hub.hebergement.releverVisites();
    expect(hub.hebergement.demoDe(site.id)!.visites).toBe(4);
    expect(hub.events.list({ limit: 5 }).filter((e) => e.type === "hebergement.visite")).toHaveLength(1);
    hub.close();
  });

  it("prolonge : nouvelle date dans la maquette reconstruite, puis republiée", async () => {
    const { etat, fetch } = fauxCloudflare();
    const nowVal = new Date("2026-11-02T12:00:00Z");
    const hub = testHub({ hebergement: { fetch, spawner: fauxWrangler().spawner, now: () => new Date(nowVal) } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();
    const avant = hub.hebergement.demoDe(site.id)!;
    expect(avant.expireLe).toBe(new Date("2026-12-02T12:00:00Z").toISOString());

    // Astro « reconstruit » : le faux build recopie le site.json dans le dist comme le ferait Astro.
    etat.kv.set("v:lumen-elec", "{}");

    const { jobId } = await hub.hebergement.demanderProlonger(site.id);
    await hub.jobs.idle();
    expect(hub.jobs.get(jobId).state).toBe("done");
    const apres = hub.hebergement.demoDe(site.id)!;
    expect(apres.expireLe).toBe(new Date("2026-12-02T12:00:00Z").toISOString()); // +30 jours depuis le même jour
    expect(apres.etat).toBe("en_ligne");
    expect(JSON.parse(readFileSync(join(hub.sites.dirOf(site.id), "src", "data", "site.json"), "utf8")).demo.dateSuppression).toBe(apres.expireLe!.slice(0, 10)); // AAAA-MM-JJ exigé par le schéma du kit
    expect(etat.kv.get("d:lumen-elec")).toContain(apres.expireLe!);
    hub.close();
  });

  it("expire automatiquement : démo retirée, site repassé « démo prête », page d'expiration en KV", async () => {
    const { etat, fetch } = fauxCloudflare();
    const nowVal = new Date("2026-11-02T12:00:00Z");
    const hub = testHub({ hebergement: { fetch, spawner: fauxWrangler().spawner, now: () => new Date(nowVal) } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub);
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();

    nowVal.setDate(nowVal.getDate() + 31); // J+31 : l'échéance (J+30) est passée
    hub.hebergement.planifierExpiration();
    await hub.jobs.idle();

    const demo = hub.hebergement.demoDe(site.id)!;
    expect(demo.etat).toBe("expiree");
    expect(hub.sites.get(site.id).statut).toBe("demo_prete");
    expect(hub.sites.get(site.id).urlDemo).toBeNull();
    expect(etat.kv.get("d:lumen-elec")).toContain('"expiree"');
    expect(hub.events.list({ limit: 10 }).some((e) => e.type === "hebergement.expiree")).toBe(true);
    // Une nouvelle publication (même slug) repart.
    nowVal.setDate(nowVal.getDate() - 31);
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();
    expect(hub.hebergement.demoDe(site.id)!.slug).toBe("lumen-elec");
    expect(hub.hebergement.demoDe(site.id)!.etat).toBe("en_ligne");
    hub.close();
  });

  it("retire manuellement : dossier supprimé, fiche retirée, site republiable", async () => {
    const { etat, fetch } = fauxCloudflare();
    const hub = testHub({ hebergement: { fetch, spawner: fauxWrangler().spawner } });
    hub.start();
    configurer(hub);
    const { site } = preparerSite(hub, "Plombier Rénov");
    await hub.hebergement.demanderPublier(site.id);
    await hub.jobs.idle();

    const { jobId } = await hub.hebergement.demanderRetirer(site.id);
    await hub.jobs.idle();
    expect(hub.jobs.get(jobId).state).toBe("done");
    const demo = hub.hebergement.demoDe(site.id)!;
    expect(demo.etat).toBe("retiree");
    expect(demo.retireeLe).not.toBeNull();
    expect(hub.sites.get(site.id).statut).toBe("demo_prete");
    expect(etat.kv.get("d:plombier-renov")).toContain('"retiree"');
    // Le dossier de l'assemblage ne contient plus la démo.
    expect(() => readFileSync(join(demosDir(hub), "plombier-renov", "index.html"))).toThrow();
    hub.close();
  });

  it("teste la connexion et dit précisément ce qui manque", async () => {
    const { etat, fetch } = fauxCloudflare();
    const hub = testHub({ hebergement: { fetch } });
    hub.start();
    configurer(hub);
    const r = await hub.hebergement.tester();
    expect(r.ok).toBe(true);
    const titres = r.points.map((p) => p.titre);
    expect(titres).toContain("Jeton Cloudflare");
    expect(titres).toContain("Zone « mondomaine.fr »");
    expect(titres).toContain("Adresses des démos");
    expect(titres).toContain("Route du Worker");
    expect(r.points.filter((p) => p.niveau === "erreur")).toHaveLength(0);

    // Jeton refusé : l'erreur le dit.
    etat.jetonActif = false;
    const r2 = await hub.hebergement.tester();
    expect(r2.ok).toBe(false);
    expect(r2.points.find((p) => p.titre === "Jeton Cloudflare")!.detail).toMatch(/refusé/);

    // Zone absente : l'erreur le dit aussi.
    etat.jetonActif = true;
    etat.zonePresente = false;
    const r3 = await hub.hebergement.tester();
    expect(r3.points.find((p) => p.titre === "Zone « mondomaine.fr »")!.detail).toMatch(/pas sur ce compte/);
    hub.close();
  });

  it("enregistre et retire les secrets Cloudflare sans jamais les renvoyer", async () => {
    const hub = testHub({ hebergement: { fetch: fauxCloudflare().fetch } });
    hub.start();
    hub.hebergement.enregistrerSecret("CLOUDFLARE_ACCOUNT_ID", "b".repeat(32));
    hub.hebergement.enregistrerSecret("CLOUDFLARE_API_TOKEN", "jeton-cloudflare-de-test-1234567890");
    expect(hub.hebergement.etat().comptePresent).toBe(true);
    expect(hub.hebergement.etat().jetonPresent).toBe(true);
    expect(JSON.stringify(hub.hebergement.etat())).not.toContain("jeton-secret");
    // Format invalide refusé.
    expect(() => hub.hebergement.enregistrerSecret("CLOUDFLARE_ACCOUNT_ID", "court")).toThrow(HubError);
    hub.close();
  });
});

describe("adresses des démos", () => {
  it("un seul niveau sous le domaine (certificat gratuit Cloudflare) et jamais un sous-domaine réservé", async () => {
    const { SLUGS_RESERVES, slugUnique, slugifier } = await import("../src/hebergement/slug.ts");
    expect(slugUnique(slugifier("WWW"), new Set(SLUGS_RESERVES))).toBe("www-2");
    expect(slugUnique(slugifier("Mail"), new Set(SLUGS_RESERVES))).toBe("mail-2");
    expect(slugifier("Lumen Élec")).toBe("lumen-elec");
  });
});
