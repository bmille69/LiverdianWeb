import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHub, type Hub } from "../src/hub.ts";
import { apparier } from "../src/prospection/appariement.ts";
import { anneeCopyright, auditerSite, emailsDe, robotsPermet } from "../src/prospection/audit.ts";
import { calculerScore, GRILLE_DEFAUT, type Faits } from "../src/prospection/scoring.ts";
import { PLACES_FIELD_MASK } from "../src/prospection/sources/places.ts";
import { Reseau, type HttpFetch } from "../src/prospection/reseau.ts";
import { buildServer } from "../src/server/http.ts";
import { fakeSkills, tempDir, testHub } from "./helpers.ts";

const MAINTENANT = new Date("2026-11-02T10:00:00Z");
const BRON = { lat: 45.7355, lon: 4.9116 };

// ── Faux réseau ─────────────────────────────────────────────────────────────

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | null;
function fauxFetch(routes: Route[]): { fetch: HttpFetch; appels: string[] } {
  const appels: string[] = [];
  const fetch: HttpFetch = async (raw, init) => {
    const url = new URL(raw);
    appels.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  };
  return { fetch, appels };
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

type Etab = Partial<{ siret: string; est_siege: boolean; etat_administratif: string; activite_principale: string; adresse: string; code_postal: string; commune: string; libelle_commune: string; latitude: string; longitude: string; nom_commercial: string | null; tranche_effectif_salarie: string }>;
function entreprise(siren: string, nom: string, o: { naf?: string; date?: string; categorie?: string; ouverts?: number; opposition?: boolean; etab?: Etab; dirigeant?: [string, string] } = {}) {
  const etab = {
    siret: `${siren}00011`,
    est_siege: true,
    etat_administratif: "A",
    activite_principale: o.naf ?? "43.21A",
    adresse: "12 RUE DE LA REPUBLIQUE 69500 BRON",
    code_postal: "69500",
    commune: "69029",
    libelle_commune: "BRON",
    latitude: String(BRON.lat + 0.001),
    longitude: String(BRON.lon + 0.001),
    nom_commercial: null,
    tranche_effectif_salarie: "01",
    statut_diffusion_etablissement: "O",
    ...o.etab,
  };
  return {
    siren,
    nom_complet: nom,
    nom_raison_sociale: nom,
    activite_principale: o.naf ?? "43.21A",
    categorie_entreprise: o.categorie ?? "PME",
    date_creation: o.date ?? "2015-04-01",
    dirigeants: [{ type_dirigeant: "personne physique", nom: o.dirigeant?.[1] ?? "DUPONT", prenoms: o.dirigeant?.[0] ?? "JEAN PIERRE", date_de_naissance: "1970-01" }],
    nature_juridique: "1000",
    nombre_etablissements_ouverts: o.ouverts ?? 1,
    statut_diffusion: "O",
    opposition_diffusion_commerciale: o.opposition ?? false,
    matching_etablissements: [etab],
  };
}

const SIRENE = [
  entreprise("111111111", "DUPONT ELECTRICITE"),
  entreprise("222222222", "MARTIN PLOMBERIE", { naf: "43.22A", date: "2023-01-10", dirigeant: ["PAUL", "MARTIN"], etab: { adresse: "3 AVENUE FRANKLIN ROOSEVELT 69500 BRON", siret: "22222222200015" } }),
  entreprise("333333333", "SNEF", { categorie: "GE", ouverts: 80 }),
  entreprise("444444444", "SECONDAIRE ELEC", { etab: { est_siege: false } }),
  entreprise("555555555", "OPPOSEE ELEC", { opposition: true }),
  entreprise("666666666", "LOINTAINE ELEC", { etab: { latitude: "45.2", longitude: "5.7" } }),
];

function routesCommunes(): Route {
  return (url) => {
    if (url.host !== "geo.api.gouv.fr") return null;
    if (url.pathname === "/communes" && url.searchParams.get("nom") === "Bron") return json([{ nom: "Bron", code: "69029", centre: { type: "Point", coordinates: [BRON.lon, BRON.lat] }, codeDepartement: "69", codesPostaux: ["69500"] }]);
    if (url.pathname === "/communes/69029") return json({ nom: "Bron", code: "69029" });
    return json([], 404);
  };
}
function routeSirene(results = SIRENE, compte?: { n: number }): Route {
  return (url) => {
    if (url.host !== "recherche-entreprises.api.gouv.fr") return null;
    if (compte) compte.n++;
    const naf = (url.searchParams.get("activite_principale") ?? "").split(",");
    const r = results.filter((e) => naf.includes(e.activite_principale));
    return json({ results: url.searchParams.get("page") === "1" ? r : [], total_results: r.length, page: Number(url.searchParams.get("page")), per_page: 25, total_pages: 1 });
  };
}
const routeOverpass: Route = (url) =>
  url.host === "overpass-api.de"
    ? json({ elements: [{ type: "node", id: 42, lat: BRON.lat + 0.0012, lon: BRON.lon + 0.001, tags: { name: "Dupont Électricité", craft: "electrician", website: "http://dupont-elec.fr", phone: "+33 4 72 00 00 01" } }] })
    : null;

/** Site daté : HTTP seulement, pas de viewport, copyright 2014, email sur la page contact. */
function routeSiteDate(): Route {
  return (url, init) => {
    if (url.host !== "dupont-elec.fr") return null;
    if (url.protocol === "https:") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    if (url.pathname === "/robots.txt") return new Response("", { status: 404 });
    if (url.pathname === "/contact") return html(`<html><body><p>Écrivez-nous : contact@dupont-elec.fr</p></body></html>`);
    if (url.pathname === "/" && (init?.method ?? "GET") === "GET")
      return html(`<html><head><title>Dupont Électricité</title></head><body><table width="800"><tr><td><a href="/contact">Contact</a></td></tr></table><table width="800"></table><table width="800"></table><p>© 2014 Dupont Électricité, Bron</p></body></html>`);
    return null;
  };
}

function hubProspection(routes: Route[], extra: { databasePath?: string; dataDir?: string } = {}) {
  const f = fauxFetch(routes);
  const hub = createHub({
    dataDir: extra.dataDir ?? tempDir(),
    skillsDir: fakeSkills(),
    databasePath: extra.databasePath ?? ":memory:",
    now: () => MAINTENANT,
    prospection: { fetch: f.fetch, pause: false, lighthouse: null, flou: null },
  });
  return { hub, appels: f.appels };
}

const CRITERES = { metiers: ["electricien", "plombier"], zone: { type: "rayon", commune: "Bron", rayonKm: 10 } };

async function campagne(hub: Hub, criteres: object = CRITERES) {
  const c = hub.prospection.campagnes.creer({ nom: "Bron + 10 km", criteres });
  hub.prospection.campagnes.lancer(c.id);
  await hub.jobs.idle();
  return hub.prospection.campagnes.get(c.id);
}

const fermer: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of fermer.splice(0)) await f();
});

// ── Appariement ─────────────────────────────────────────────────────────────

describe("appariement Sirene ↔ Places / OSM", () => {
  const cible = { noms: ["Electricite Dupont", null, "Jean Dupont"], adresse: { ligne: "12 rue de la Republique", codePostal: "69500" }, lat: BRON.lat, lon: BRON.lon };

  it("même nom et même lieu : fusionné", () => {
    const a = apparier(cible, { nom: "Dupont Électricité", adresse: { ligne: "12 Rue de la République", codePostal: "69500" }, lat: BRON.lat + 0.0005, lon: BRON.lon });
    expect(a.statut).toBe("fusionne");
    expect(a.score).toBeGreaterThanOrEqual(0.75);
    expect(a.detail.distanceM).toBeLessThan(100);
  });

  it("nom voisin mais lieu éloigné : douteux, jamais fusionné", () => {
    const a = apparier(cible, { nom: "Dupont Rénovation", adresse: { ligne: "8 chemin des Vignes", codePostal: "69500" }, lat: BRON.lat + 0.02, lon: BRON.lon });
    expect(a.statut).toBe("douteux");
  });

  it("seuls les mots du métier en commun, ou un autre nom à la même adresse : aucun", () => {
    expect(apparier(cible, { nom: "Électricité Générale Services", adresse: { ligne: "12 rue de la République", codePostal: "69500" }, lat: BRON.lat, lon: BRON.lon }).statut).toBe("aucun");
    expect(apparier(cible, { nom: "Boulangerie Lefèvre", adresse: { ligne: "12 rue de la République", codePostal: "69500" }, lat: BRON.lat, lon: BRON.lon }).statut).toBe("aucun");
  });

  it("une marque générique ou un prénom en commun ne rapprochent pas (cas relevés en vraie campagne)", () => {
    const tahrati = { noms: ["Electricite Generale Tahrati - E. G. T.", "Tahrati SARL", "Tahrati"], adresse: { ligne: "6 allee des Sorbiers", codePostal: "69500" }, lat: BRON.lat, lon: BRON.lon };
    expect(apparier(tahrati, { nom: "Électricité Générale", adresse: { ligne: null, codePostal: null }, lat: BRON.lat + 0.01, lon: BRON.lon }).statut).toBe("aucun");
    const multi = { noms: ["Multi Elec", "Butaud"], adresse: { ligne: "13 boulevard Edmond Michelet", codePostal: "69008" }, lat: BRON.lat, lon: BRON.lon };
    expect(apparier(multi, { nom: "Jean Martin", adresse: { ligne: "86 avenue Viviani", codePostal: "69008" }, lat: BRON.lat + 0.008, lon: BRON.lon }).statut).toBe("aucun");
    // Le vrai cas fusionné de la campagne reste fusionné.
    const petezki = { noms: ["Electricite Generale Petezki et Fils"], adresse: { ligne: "63 rue Seignemartin", codePostal: "69008" }, lat: BRON.lat, lon: BRON.lon };
    expect(apparier(petezki, { nom: "Petezki & Fils", adresse: { ligne: "63 Rue Seignemartin", codePostal: null }, lat: BRON.lat, lon: BRON.lon }).statut).toBe("fusionne");
  });

  it("sans aucune information de lieu, le nom seul ne suffit pas à fusionner", () => {
    const a = apparier({ ...cible, adresse: { ligne: null, codePostal: null }, lat: null, lon: null }, { nom: "Électricité Dupont", adresse: { ligne: null, codePostal: null }, lat: null, lon: null });
    expect(a.statut).toBe("douteux");
  });
});

// ── Scoring ─────────────────────────────────────────────────────────────────

describe("score : grille du plan, chaque point expliqué", () => {
  const base: Faits = { statutSite: "aucun", sourcesSite: ["places", "osm"], https: null, mobile: null, anneeCopyright: null, techDatee: null, avis: { note: 4.6, nombre: 31 }, dateCreation: "2015-04-01", franchise: null };

  it("aucun site + bons avis + ancienneté : 70, qualifié, avec le détail", () => {
    const s = calculerScore(GRILLE_DEFAUT, base, MAINTENANT);
    expect(s.total).toBe(70);
    expect(s.qualifie).toBe(true);
    const l = Object.fromEntries(s.lignes.map((x) => [x.regle, x]));
    expect(l.aucun_site).toMatchObject({ points: 40, applique: true });
    expect(l.aucun_site!.incertain).toBeUndefined();
    expect(l.avis).toMatchObject({ points: 20, raison: "4,6/5 sur 31 avis" });
    expect(l.anciennete!.raison).toMatch(/01\/04\/2015 \(11 ans\)/);
    expect(l.site_correct).toMatchObject({ points: 0, applique: false });
  });

  it("site daté sans HTTPS : +25 +10 ; site récent et correct : −50", () => {
    const date = calculerScore(GRILLE_DEFAUT, { ...base, statutSite: "sans_https", https: false, mobile: false, anneeCopyright: 2014, avis: null }, MAINTENANT);
    expect(date.lignes.find((l) => l.regle === "site_defaillant")).toMatchObject({ points: 25, raison: "sans HTTPS, non adapté au mobile" });
    expect(date.lignes.find((l) => l.regle === "copyright_ancien")).toMatchObject({ points: 10, raison: "copyright 2014" });
    expect(date.lignes.find((l) => l.regle === "avis")).toMatchObject({ points: 0, incertain: true });
    expect(date.total).toBe(45);
    expect(date.qualifie).toBe(false);
    const correct = calculerScore(GRILLE_DEFAUT, { ...base, statutSite: "correct", https: true, mobile: true, anneeCopyright: 2025 }, MAINTENANT);
    expect(correct.total).toBe(-50 + 20 + 10);
  });

  it("franchise : exclue quel que soit le total ; sans Places, « aucun site » est marqué incertain", () => {
    const f = calculerScore(GRILLE_DEFAUT, { ...base, franchise: { oui: true, raison: "membre du réseau X" } }, MAINTENANT);
    expect(f.exclu).toBe("membre du réseau X");
    expect(f.qualifie).toBe(false);
    const sansPlaces = calculerScore(GRILLE_DEFAUT, { ...base, sourcesSite: ["osm"], avis: null }, MAINTENANT);
    expect(sansPlaces.lignes[0]).toMatchObject({ regle: "aucun_site", points: 40, incertain: true });
    expect(sansPlaces.lignes[0]!.raison).toMatch(/sans Google Places/);
    // 50 points dont 40 incertains : au seuil, mais à vérifier plutôt que qualifiée.
    expect(sansPlaces).toMatchObject({ total: 50, qualifie: false, aVerifier: true });
  });

  it("grille éditée : règle désactivée, points et seuil changés", () => {
    const g = structuredClone(GRILLE_DEFAUT);
    g.regles.find((r) => r.id === "avis")!.actif = false;
    g.regles.find((r) => r.id === "aucun_site")!.points = 30;
    g.seuil = 45;
    const s = calculerScore(g, base, MAINTENANT);
    expect(s.total).toBe(40);
    expect(s.qualifie).toBe(false);
    expect(s.lignes.find((l) => l.regle === "avis")!.raison).toBe("règle désactivée");
  });
});

// ── Audit ───────────────────────────────────────────────────────────────────

describe("audit d'un site existant", () => {
  it("relevés par le code : HTTP seul, pas de viewport, copyright 2014, tableaux, email de la page contact", async () => {
    const { fetch, appels } = fauxFetch([routeSiteDate()]);
    const a = await auditerSite({ url: "dupont-elec.fr", entreprise: "Dupont", commune: "Bron" }, { reseau: new Reseau({ fetch, pause: false }), maintenant: () => MAINTENANT });
    expect(a).toMatchObject({ statutSite: "sans_https", https: false, mobile: false, anneeCopyright: 2014, techDatee: "mise en page en tableaux", email: "contact@dupont-elec.fr", robots: "absent" });
    expect(a.preuves.map((p) => p.constat).join("\n")).toMatch(/Pas de HTTPS \(dupont-elec.fr injoignable : ECONNREFUSED\)[\s\S]*Aucune balise viewport[\s\S]*Copyright 2014/);
    // Une visite légère : robots.txt, l'accueil, une page contact, et un test HTTPS.
    expect(a.pagesVisitees).toEqual(["http://dupont-elec.fr/", "http://dupont-elec.fr/contact"]);
    expect(appels.filter((x) => x.includes("dupont-elec.fr")).length).toBeLessThanOrEqual(5);
  });

  it("robots.txt interdit : aucune page visitée ; page Facebook : pas un vrai site, sans visite", async () => {
    const { fetch, appels } = fauxFetch([(u) => (u.pathname === "/robots.txt" ? new Response("User-agent: *\nDisallow: /", { headers: { "content-type": "text/plain" } }) : html("<p>secret</p>"))]);
    const a = await auditerSite({ url: "https://interdit.fr", entreprise: "X", commune: null }, { reseau: new Reseau({ fetch, pause: false }) });
    expect(a.robots).toBe("interdit");
    expect(a.pagesVisitees).toEqual([]);
    expect(appels).toEqual(["GET interdit.fr/robots.txt"]);
    const fb = await auditerSite({ url: "https://www.facebook.com/dupont.elec", entreprise: "X", commune: null }, { reseau: new Reseau({ fetch, pause: false }) });
    expect(fb.statutSite).toBe("annuaire_seulement");
    expect(appels).toHaveLength(1);
  });

  it("l'email proposé par l'Éclaireur n'est gardé que s'il figure sur le site", async () => {
    const { fetch } = fauxFetch([routeSiteDate()]);
    const flou = async () => ({ fournisseur: "test", modele: "x", flou: { franchise: false, franchise_preuve: null, vrai_site: "oui" as const, vrai_site_preuve: null, email: "patron@gmail.com", email_preuve: null } });
    const a = await auditerSite({ url: "http://dupont-elec.fr", entreprise: "Dupont", commune: "Bron" }, { reseau: new Reseau({ fetch, pause: false }), flou, maintenant: () => MAINTENANT });
    expect(a.email).toBeNull();
    expect(a.preuves.at(-1)!.constat).toMatch(/ignoré/);
  });

  it("outils : robots.txt, copyright, emails", () => {
    expect(robotsPermet("User-agent: *\nDisallow: /admin\nAllow: /admin/public", "/admin/public/x")).toBe(true);
    expect(robotsPermet("User-agent: *\nDisallow: /admin", "/admin/x")).toBe(false);
    expect(robotsPermet("User-agent: LiverdianAudit\nDisallow: /\n\nUser-agent: *\nDisallow:", "/")).toBe(false);
    expect(anneeCopyright("Copyright © 2009 - 2019 Dupont", MAINTENANT)).toBe(2019);
    expect(anneeCopyright("© 2099", MAINTENANT)).toBeNull();
    expect(emailsDe('<a href="mailto:Contact@Dupont.fr">x</a> logo@2x.png info [at] dupont.fr')).toEqual(["contact@dupont.fr", "info@dupont.fr"]);
  });
});

// ── Campagne de bout en bout (sources simulées) ─────────────────────────────

describe("campagne", () => {
  it("source, filtre, apparie OSM, audite, note ; sans doublon ni perte d'une saisie à la main", async () => {
    const { hub } = hubProspection([routesCommunes(), routeSirene(), routeOverpass, routeSiteDate()]);
    fermer.push(() => hub.close());
    // Une fiche saisie à la main existe déjà pour Dupont, avec son propre téléphone.
    const main = hub.companies.create({ raisonSociale: "Dupont (saisie)", siren: "111111111", telephone: "06 11 22 33 44", notes: "Rencontré au salon" });
    hub.jobs.start();
    const c = await campagne(hub);
    expect(c.etat).toBe("terminee");
    expect(c.compteurs).toMatchObject({ trouves: 6, sources: 2, nouvelles: 1, avecSite: 1, sansSite: 1, audites: 1, qualifies: 0, aVerifier: 1 });
    expect(c.compteurs.ecartes).toMatchObject({ "réseau ou entreprise de plus de 19 salariés": 1, "établissement secondaire": 1, "opposée à la prospection (registre)": 1, "hors zone": 1 });
    expect(c.compteurs.osm).toMatchObject({ lieux: 1, apparies: 1 });
    expect(c.compteurs.places?.saute).toMatch(/clé Google Places absente/);

    const dupont = hub.companies.get(main.id);
    expect(dupont.raisonSociale).toBe("Dupont (saisie)");
    expect(dupont.telephone).toBe("06 11 22 33 44");
    expect(dupont.sources).toMatchObject({ raisonSociale: "saisie", telephone: "saisie", naf: "sirene", dirigeant: "sirene", siteActuel: "osm", email: "audit" });
    expect(dupont.dirigeant).toBe("Jean Dupont");
    expect(dupont.adresse).toEqual({ ligne: "12 rue de la Republique", codePostal: "69500", commune: "Bron" });
    expect(dupont.siteActuel).toBe("http://dupont-elec.fr");

    const lignes = hub.prospection.liste({ campagneId: c.id });
    // Martin atteint 50 seulement grâce à « aucun site », incertain sans Places : à vérifier, pas qualifiée.
    expect(lignes.map((l) => [l.nom, l.siteStatut, l.scoreBrut, l.qualifie, l.aVerifier])).toEqual([
      ["Martin Plomberie", "aucun", 50, false, true],
      ["Dupont (saisie)", "sans_https", 45, false, false],
    ]);
    const fiche = hub.prospection.fiche(main.id);
    expect(fiche.prospect.audit?.preuves.length).toBeGreaterThan(2);
    expect(fiche.prospect.score?.lignes.find((l) => l.regle === "site_defaillant")?.points).toBe(25);
    expect(hub.companies.get(lignes[0]!.id).statut).toBe("prospect");

    // Relance : mêmes entreprises, aucune fiche en double, rien de saisi perdu.
    const avant = hub.companies.list().length;
    hub.prospection.campagnes.lancer(c.id);
    await hub.jobs.idle();
    expect(hub.companies.list().length).toBe(avant);
    expect(hub.companies.get(main.id).telephone).toBe("06 11 22 33 44");
    expect(hub.prospection.campagnes.get(c.id).compteurs.nouvelles).toBe(0);
  });

  it("filtres : sans site seulement, ancienneté minimale ; fiches écartées supprimées (minimisation)", async () => {
    const { hub } = hubProspection([routesCommunes(), routeSirene(), routeOverpass, routeSiteDate()]);
    fermer.push(() => hub.close());
    hub.jobs.start();
    const c = await campagne(hub, { ...CRITERES, site: "aucun", ancienneteMinAns: 5 });
    // Martin (2023) trop récente ; Dupont a un site : écartée puis supprimée car rien n'y a été saisi.
    expect(c.compteurs.ecartes).toMatchObject({ "trop récente": 1, "a déjà un site": 1 });
    expect(c.compteurs.nettoyes).toBe(1);
    expect(hub.companies.list()).toHaveLength(0);
  });

  it("liste d'opposition : une entreprise opposée n'est plus jamais sourcée", async () => {
    const { hub } = hubProspection([routesCommunes(), routeSirene(), routeOverpass, routeSiteDate()]);
    fermer.push(() => hub.close());
    hub.jobs.start();
    await campagne(hub);
    const martin = hub.companies.list().find((c) => c.siren === "222222222")!;
    const r = hub.prospection.store.exclure([martin.id], "Opposition : a répondu STOP");
    expect(r).toEqual({ exclues: 0, supprimees: 1 });
    expect(() => hub.companies.get(martin.id)).toThrow();
    // Seules des empreintes sont gardées.
    const brut = JSON.stringify(hub.db.prepare("SELECT * FROM opposition").all());
    expect(brut).not.toContain("222222222");
    expect(hub.prospection.store.estOpposee({ siren: "222 222 222" })).toBe(true);
    const c2 = await campagne(hub);
    expect(c2.compteurs.ecartes?.["liste d'opposition"]).toBe(1);
    expect(hub.companies.list().some((c) => c.siren === "222222222")).toBe(false);
  });

  it("purge : prospects non convertis supprimés après 6 mois, jamais une cliente ni une fiche saisie à la main", async () => {
    let maintenant = MAINTENANT;
    const f = fauxFetch([routesCommunes(), routeSirene(), routeOverpass, routeSiteDate()]);
    const hub = createHub({ dataDir: tempDir(), skillsDir: fakeSkills(), databasePath: ":memory:", now: () => maintenant, prospection: { fetch: f.fetch, pause: false, lighthouse: null, flou: null } });
    fermer.push(() => hub.close());
    hub.jobs.start();
    await campagne(hub);
    const [a, b] = hub.companies.list();
    hub.companies.update(a!.id, { statut: "client" });
    const manuelle = hub.companies.create({ raisonSociale: "Saisie à la main" });
    // Les dates en base viennent de l'horloge réelle : on vieillit les fiches de 7 mois.
    hub.db.prepare("UPDATE companies SET updated_at = '2026-03-01T00:00:00.000Z'").run();
    hub.db.prepare("UPDATE prospects SET updated_at = '2026-03-01T00:00:00.000Z'").run();
    maintenant = new Date("2026-11-02T10:00:00Z");
    expect(hub.prospection.purger().supprimees).toBe(1);
    expect(() => hub.companies.get(b!.id)).toThrow();
    expect(hub.companies.get(a!.id).statut).toBe("client");
    expect(hub.companies.get(manuelle.id).raisonSociale).toBe("Saisie à la main");
    expect(hub.prospection.registre()).toMatch(/supprimé automatiquement après \*\*6 mois\*\*/);
  });

  it("reprise après redémarrage : la campagne repart de sa phase, sans relire Sirene ni dupliquer", async () => {
    const dir = tempDir();
    const db = join(dir, "liverdian.db");
    let signalerBlocage!: () => void;
    const bloque = new Promise<void>((r) => (signalerBlocage = r));
    // Premier hub : l'audit du site reste bloqué (jusqu'à l'arrêt du hub).
    const premier = hubProspection(
      [
        routesCommunes(),
        routeSirene(),
        routeOverpass,
        (u, init) => {
          if (u.host !== "dupont-elec.fr") return null;
          signalerBlocage();
          return new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("arrêt"))));
        },
      ],
      { databasePath: db, dataDir: dir },
    );
    premier.hub.jobs.start();
    const c = premier.hub.prospection.campagnes.creer({ nom: "Reprise", criteres: CRITERES });
    premier.hub.prospection.campagnes.lancer(c.id);
    await bloque;
    expect(premier.hub.prospection.campagnes.get(c.id).phase).toBe("audit");
    await premier.hub.close();

    const compte = { n: 0 };
    const second = hubProspection([routesCommunes(), routeSirene(SIRENE, compte), routeOverpass, routeSiteDate()], { databasePath: db, dataDir: dir });
    fermer.push(() => second.hub.close());
    expect(second.hub.jobs.start().recovered).toBe(1);
    await second.hub.jobs.idle();
    const fin = second.hub.prospection.campagnes.get(c.id);
    expect(fin.etat).toBe("terminee");
    expect(compte.n).toBe(0);
    expect(fin.compteurs).toMatchObject({ sources: 2, audites: 1, aVerifier: 1 });
    expect(second.hub.companies.list()).toHaveLength(2);
  });
});

// ── Google Places (faux serveur HTTP) ───────────────────────────────────────

describe("Google Places", () => {
  let serveur: Server | null = null;
  afterEach(() => new Promise<void>((r) => (serveur ? serveur.close(() => r()) : r())));

  async function fauxPlaces() {
    const requetes: { headers: IncomingMessage["headers"]; body: { textQuery: string } }[] = [];
    serveur = createServer((req, res) => {
      let corps = "";
      req.on("data", (c) => (corps += c));
      req.on("end", () => {
        const body = JSON.parse(corps) as { textQuery: string };
        requetes.push({ headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        if (req.url !== "/v1/places:searchText" || req.headers["x-goog-api-key"] !== "AIzaTESTTESTTESTTESTTESTTESTTESTTESTTE") {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: { message: "clé refusée" } }));
        }
        const places = /Dupont/i.test(body.textQuery)
          ? [{ id: "p1", displayName: { text: "Dupont Électricité" }, formattedAddress: "12 Rue de la République, 69500 Bron, France", location: { latitude: BRON.lat + 0.001, longitude: BRON.lon + 0.001 }, nationalPhoneNumber: "04 72 00 00 01", websiteUri: "https://dupont-elec.fr/", rating: 4.7, userRatingCount: 23, regularOpeningHours: { weekdayDescriptions: ["lundi: 08:00–18:00", "dimanche: Fermé"] }, googleMapsUri: "https://maps.google.com/?cid=1" }]
          : [{ id: "p2", displayName: { text: "Plomberie Martin" }, formattedAddress: "40 Chemin du Vinatier, 69500 Bron, France", location: { latitude: BRON.lat + 0.018, longitude: BRON.lon }, nationalPhoneNumber: "04 78 99 99 99", rating: 4.9, userRatingCount: 50 }];
        res.end(JSON.stringify({ places }));
      });
    });
    await new Promise<void>((r) => serveur!.listen(0, "127.0.0.1", () => r()));
    return { base: `http://127.0.0.1:${(serveur!.address() as AddressInfo).port}`, requetes };
  }

  function sitesCorrects(): Route {
    return (url) => {
      if (url.host !== "dupont-elec.fr") return null;
      if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /admin", { headers: { "content-type": "text/plain" } });
      return html(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dupont</title></head><body><a href="mailto:contact@dupont-elec.fr">contact@dupont-elec.fr</a><footer>© 2025 Dupont</footer></body></html>`);
    };
  }

  function hubPlaces(base: string, fetchRoutes: Route[]) {
    const f = fauxFetch(fetchRoutes);
    // Le faux serveur Places est joint par le vrai fetch ; le reste passe par le faux réseau.
    const fetch: HttpFetch = (url, init) => (url.startsWith(base) ? globalThis.fetch(url, init) : f.fetch(url, init));
    const hub = createHub({ dataDir: tempDir(), skillsDir: fakeSkills(), databasePath: ":memory:", now: () => MAINTENANT, prospection: { fetch, pause: false, lighthouse: null, flou: null, placesBase: base } });
    fermer.push(() => hub.close());
    hub.prospection.enregistrerSecret("GOOGLE_PLACES_API_KEY", "AIzaTESTTESTTESTTESTTESTTESTTESTTESTTE");
    return hub;
  }

  it("masque de champs minimal, appariement stocké, douteux signalé sans fusion, données fusionnées avec leur source", async () => {
    const { base, requetes } = await fauxPlaces();
    const hub = hubPlaces(base, [routesCommunes(), routeSirene(), routeOverpass, sitesCorrects()]);
    hub.jobs.start();
    const c = await campagne(hub);
    expect(requetes).toHaveLength(2);
    expect(requetes[0]!.headers["x-goog-fieldmask"]).toBe(PLACES_FIELD_MASK);
    expect(c.compteurs.places).toMatchObject({ appels: 2, apparies: 1, douteux: 1 });

    const dupont = hub.companies.list().find((x) => x.siren === "111111111")!;
    expect(dupont).toMatchObject({ telephone: "04 72 00 00 01", siteActuel: "https://dupont-elec.fr/", google: { valeur: 4.7, nombre: 23 }, horaires: { lundi: "08:00–18:00", dimanche: "Fermé" } });
    expect(dupont.sources).toMatchObject({ telephone: "places", siteActuel: "places", google: "places", horaires: "places", email: "audit" });
    const martin = hub.companies.list().find((x) => x.siren === "222222222")!;
    // Douteux : la note de 4,9 de « Plomberie Martin » n'est pas recopiée en silence.
    expect(martin.google).toBeNull();
    expect(martin.telephone).toBeNull();
    const ligne = hub.prospection.liste({ campagneId: c.id }).find((l) => l.id === martin.id)!;
    expect(ligne.douteux).toEqual(["places"]);
    // Site récent et correct : −50.
    expect(hub.prospection.fiche(dupont.id).prospect.score?.lignes.find((l) => l.regle === "site_correct")?.points).toBe(-50);

    // Le propriétaire accepte l'appariement : les données arrivent, le score est recalculé.
    const f = hub.prospection.decider(martin.id, "places", "acceptee");
    expect(f.company).toMatchObject({ telephone: "04 78 99 99 99", google: { valeur: 4.9, nombre: 50 } });
    expect(f.prospect.score?.lignes.find((l) => l.regle === "avis")?.points).toBe(20);
    // La clé n'apparaît nulle part en base.
    const tout = JSON.stringify([hub.db.prepare("SELECT * FROM api_cache").all(), hub.db.prepare("SELECT * FROM events").all(), hub.db.prepare("SELECT * FROM api_appels").all()]);
    expect(tout).not.toContain("AIzaTEST");
  });

  it("plafond mensuel : le hub refuse de le dépasser ; le cache ne recompte pas", async () => {
    const { base, requetes } = await fauxPlaces();
    const hub = hubPlaces(base, [routesCommunes(), routeSirene(), routeOverpass, sitesCorrects()]);
    hub.settings.set("prospection.places.plafondMensuel", 1);
    hub.jobs.start();
    const c = await campagne(hub);
    expect(requetes).toHaveLength(1);
    expect(c.compteurs.places?.saute).toMatch(/Plafond mensuel Google Places atteint \(1 appels\)/);
    expect(hub.prospection.places.usage()).toMatchObject({ appels: 1, restants: 0, coutUsd: 0.035 });
    // Relance : la première recherche vient du cache, la seconde est toujours refusée.
    hub.prospection.campagnes.lancer(c.id);
    await hub.jobs.idle();
    expect(requetes).toHaveLength(1);
    expect(hub.prospection.campagnes.get(c.id).compteurs.places).toMatchObject({ appels: 0, cache: 1 });
  });
});

// ── API : maquettes en lot, exclusion, clés ─────────────────────────────────

describe("API de la prospection", () => {
  it("« Créer la maquette » en lot : file visible, une fabrication à la fois, prérequis expliqués", async () => {
    const hub = testHub({ prospection: { fetch: fauxFetch([]).fetch, pause: false, lighthouse: null, flou: null } });
    const app = await buildServer(hub, { port: 4330 });
    fermer.push(async () => {
      await app.close();
      await hub.close();
    });
    const req = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { host: "127.0.0.1:4330" } });
    const mk = (nom: string, tel: string | null) => hub.companies.create({ raisonSociale: nom, naf: "43.21A", telephone: tel, adresse: { ligne: "1 rue A", codePostal: "69500", commune: "Bron" } });
    const a = mk("Alpha Élec", "04 72 00 00 01");
    const b = mk("Beta Élec", "04 72 00 00 02");
    const sansTel = mk("Gamma Élec", null);
    // File de travaux non démarrée : les étapes de l'atelier restent en file (aucun agent n'est appelé).
    const r = await req("POST", "/api/prospection/maquettes", { ids: [a.id, b.id, sansTel.id] });
    expect(r.statusCode).toBe(201);
    const file = r.json().file as { companyName: string; etat: string; message: string | null }[];
    const par = Object.fromEntries(file.map((x) => [x.companyName, x]));
    expect(par["Alpha Élec"]!.etat).toBe("lancee");
    expect(par["Beta Élec"]!.etat).toBe("en_attente");
    expect(par["Gamma Élec"]!.etat).toBe("en_attente");
    expect(hub.jobs.list({ state: "queued" }).filter((j) => j.type === "atelier.etape")).toHaveLength(1);
    // Fin de la première fabrication (annulée) : la suivante part ; celle sans téléphone est refusée avec le motif.
    const job = hub.jobs.list({ state: "queued" }).find((j) => j.type === "atelier.etape")!;
    hub.jobs.cancel(job.id);
    await new Promise((res) => setTimeout(res, 20));
    const apres = (await req("GET", "/api/prospection/maquettes")).json().file as { companyName: string; etat: string; message: string | null }[];
    expect(apres.find((x) => x.companyName === "Beta Élec")!.etat).toBe("lancee");
    hub.jobs.cancel(hub.jobs.list({ state: "queued" }).find((j) => j.type === "atelier.etape")!.id);
    await new Promise((res) => setTimeout(res, 20));
    const fin = (await req("GET", "/api/prospection/maquettes")).json().file as { companyName: string; etat: string; message: string | null }[];
    expect(fin.find((x) => x.companyName === "Gamma Élec")).toMatchObject({ etat: "refusee", message: expect.stringMatching(/téléphone/) });
  });

  it("clés : enregistrées hors base, jamais renvoyées ; réglages bornés ; grille validée", async () => {
    const hub = testHub({ prospection: { fetch: fauxFetch([]).fetch, pause: false, lighthouse: null, flou: null } });
    const app = await buildServer(hub, { port: 4330 });
    fermer.push(async () => {
      await app.close();
      await hub.close();
    });
    const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: { host: "127.0.0.1:4330" } });
    expect((await req("GET", "/api/prospection/etat")).json().places.configure).toBe(false);
    expect((await req("PUT", "/api/secrets", { nom: "GOOGLE_PLACES_API_KEY", valeur: "pas une clé" })).statusCode).toBe(400);
    const ok = await req("PUT", "/api/secrets", { nom: "GOOGLE_PLACES_API_KEY", valeur: "AIzaSyA-1234567890abcdefghijklmnopqrstu" });
    expect(ok.json()).toEqual({ nom: "GOOGLE_PLACES_API_KEY", configure: true });
    const liste = (await req("GET", "/api/secrets")).body;
    expect(liste).not.toContain("AIzaSyA");
    expect((await req("GET", "/api/prospection/etat")).json().places).toMatchObject({ configure: true, plafond: 900, appels: 0 });
    expect((await req("PATCH", "/api/settings", { "prospection.maquettes.parallele": 9 })).statusCode).toBe(400);
    const g = (await req("GET", "/api/prospection/grille")).json().grille;
    g.seuil = 60;
    expect((await req("PUT", "/api/prospection/grille", { grille: g })).json().grille.seuil).toBe(60);
    expect((await req("PUT", "/api/prospection/grille", { grille: { seuil: 10, regles: [] } })).statusCode).toBe(400);
    const camp = await req("POST", "/api/prospection/campagnes", { nom: "X", criteres: { metiers: [], zone: { type: "rayon", commune: "Bron", rayonKm: 80 } } });
    expect(camp.statusCode).toBe(400);
    expect(camp.json().error).toMatch(/50 km|métier/);
  });
});
