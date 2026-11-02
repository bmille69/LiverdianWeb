import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CheckReport, KitRunner, NewSiteResult } from "../src/atelier/kit.ts";
import type { Contenu, Design } from "../src/atelier/schemas.ts";
import { assembler, attribuer, verifierCoherence } from "../src/atelier/assemblage.ts";
import { buildBrief, dateSuppression, lireHoraires, prerequisMaquette } from "../src/atelier/brief.ts";
import { createHub } from "../src/hub.ts";
import { fakeSkills, tempDir } from "./helpers.ts";

// ── Données de test ─────────────────────────────────────────────────────────

const LUMEN = {
  raisonSociale: "Lumen Élec",
  naf: "43.21A",
  metier: "Électricien",
  telephone: "04 72 00 00 00",
  dateCreation: "2019-04-01",
  adresse: { ligne: "2 avenue Franklin Roosevelt", codePostal: "69500", commune: "Bron" },
  google: { valeur: 4.7, nombre: 23 },
  zone: { commune: "Bron", voisines: ["Vaulx-en-Velin", "Villeurbanne", "Saint-Priest", "Chassieu", "Lyon 8e"] },
};

const DESIGN: Design = {
  intention: ["Un site pour les particuliers de Bron et de l'est lyonnais.", "Une impression de précision et de calme, sans esbroufe.", "Une teinte cuivre qui le distingue des électriciens bleu et jaune."],
  theme: { preset: "electricien", couleurs: { accent: "#E0A060", sombre: "#101820" }, signature: "faisceau" },
  ajustements: "Accent cuivre et fond sombre ardoise pour se distinguer de l'exemple ambre.",
  entete: { variante: "simple" },
  pied: { variante: "complet" },
  images: [
    { cle: "hero", fichier: "stock/electricien/a.jpg", alt: "Tableau électrique ouvert et propre", justification: "Photo nette et calme" },
    { cle: "b", fichier: "stock/electricien/b.jpg", alt: "Pose d'une prise murale", justification: "Geste du métier" },
    { cle: "c", fichier: "stock/maison/c.jpg", alt: "Séjour lumineux d'une maison", justification: "Résultat chez le client" },
  ],
  sections: [
    { type: "hero", variante: "scinde", image: "hero", justification: "Photo forte mais chargée" },
    { type: "services", variante: "cartes", nombreItems: 2, justification: "Prestations courantes" },
    { type: "realisations", variante: "grille", images: ["hero", "b", "c"], justification: "Trois photos cohérentes" },
    { type: "zone", variante: "carte", justification: "Communes voisines avec coordonnées" },
    { type: "devis", variante: "scinde", justification: "Formulaire court" },
  ],
  signature: { element: "Trame technique", description: "Le motif faisceau en fond des sections teintées" },
  surMesure: { demande: false, consigne: "" },
};

const CONTENU: Contenu = {
  sections: [
    { type: "hero", titre: "Votre électricien à Bron", sousTitre: "Dépannage, mise aux normes et rénovation électrique à Bron et alentour.", afficherNote: true },
    {
      type: "services",
      titre: "Ce que nous faisons",
      items: [
        { titre: "Dépannage", texte: "Une panne, un disjoncteur qui saute : diagnostic et réparation.", icone: "zap" },
        { titre: "Mise aux normes", texte: "Remise en sécurité de l'installation selon la NF C 15-100.", icone: "shield-check" },
      ],
    },
    { type: "realisations", titre: "En images", legendes: ["Tableau électrique", "Pose d'une prise", "Séjour éclairé"] },
    { type: "zone", titre: "Bron et l'est lyonnais" },
    { type: "devis", titre: "Décrivez votre besoin", intro: "Laissez quelques mots : nous vous rappelons pour en parler." },
  ],
  seo: { description: "Électricien à Bron : dépannage, mise aux normes et rénovation électrique. Lumen Élec intervient aussi à Villeurbanne et Saint-Priest." },
  laisseDeCote: [],
};

const RAPPORT_OK: CheckReport = {
  ok: true,
  demo: true,
  build: { ok: true, dureeMs: 1000 },
  lighthouse: { performance: 99, accessibilite: 100, bonnesPratiques: 100, seo: 66, auditsRates: { performance: [], accessibilite: [], bonnesPratiques: [], seo: [] } },
  axe: { graves: 0, violations: [] },
  controles: [{ id: "appel-visible-ecran-initial", ok: true, bloquant: true, detail: "ok" }],
  captures: {},
  echecs: [],
};

const VISUEL_OK = {
  description: "Hero scindé, services en cartes…",
  blocking: [],
  scores: { hierarchie: 5, espacement: 4, typographie: 4, couleur_images: 5, finition: 4, mobile: 4 },
  justifications: { hierarchie: "ok", espacement: "ok", typographie: "ok", couleur_images: "ok", finition: "ok", mobile: "ok" },
  corrections: [],
  verdict: "pass",
};

type Scenario = {
  /** Rapport du kit par appel de check-site (le dernier est répété). */
  rapports?: CheckReport[];
  newSite?: (n: number) => NewSiteResult;
  visuel?: (n: number) => object;
  /** Bloque l'agent indiqué (jamais de réponse tant que non débloqué). */
  bloquer?: string;
  /** L'agent indiqué lève une erreur technique tant que la fonction rend vrai. */
  panne?: { agent: string; active: () => boolean };
};

function fakeKit(s: Scenario) {
  const root = tempDir("kit-");
  for (const f of ["electricien/a.jpg", "electricien/b.jpg", "maison/c.jpg", "plombier/z.jpg"]) {
    mkdirSync(join(root, "stock", f.split("/")[0]!), { recursive: true });
    writeFileSync(join(root, "stock", f), "jpg");
  }
  const credits = ["electricien/a.jpg", "electricien/b.jpg", "maison/c.jpg", "plombier/z.jpg"].map((fichier) => ({ fichier, metier: fichier.split("/")[0]!, description: `Photo ${fichier}`, orientation: "paysage", hero: true, largeur: 2000, hauteur: 1300 }));
  const appels = { newSite: 0, checkSite: 0 };
  const kit: KitRunner = {
    root,
    async newSite(siteDir: string, siteJson: string) {
      appels.newSite++;
      const r = s.newSite?.(appels.newSite) ?? { ok: true };
      if (r.ok) {
        mkdirSync(join(siteDir, "src", "data"), { recursive: true });
        writeFileSync(join(siteDir, "src", "data", "site.json"), readFileSync(siteJson));
      }
      return r;
    },
    async checkSite(siteDir: string) {
      appels.checkSite++;
      const liste = s.rapports ?? [RAPPORT_OK];
      const r = liste[Math.min(appels.checkSite - 1, liste.length - 1)]!;
      mkdirSync(join(siteDir, "dist"), { recursive: true });
      writeFileSync(join(siteDir, "dist", "index.html"), `<html lang="fr"><title>Électricien à Bron</title><h1>Votre électricien à Bron</h1><a href="tel:+33472000000">04 72 00 00 00</a><form><label>Nom<input name="nom"></label></form></html>`);
      return r;
    },
    async decouperCaptures(_siteDir: string, out: string) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "01-mobile-ecran-initial.png"), "png");
      return ["01-mobile-ecran-initial.png"];
    },
    async presets() {
      return { electricien: { description: "Bleu nuit", couleurs: { accent: "#F4B63F", sombre: "#0C1524" }, polices: { titres: "archivo", corps: "inter" }, rayon: 4, signature: "faisceau" } };
    },
    async contrastes() {
      return [];
    },
    icones: () => new Set(["zap", "shield-check", "house"]),
    credits: () => credits,
  };
  return { kit, appels };
}

type AskReq = { agent: string; prompt: string; imagesDir?: string; signal?: AbortSignal };

function fakeAgents(s: Scenario) {
  const appels: { agent: string; mode: "ask" | "atelier"; prompt: string; imagesDir?: string; marqueur?: string | null }[] = [];
  const debloquer: (() => void)[] = [];
  let visuels = 0;
  const attendre = (req: { agent: string; signal?: AbortSignal }) =>
    s.bloquer === req.agent
      ? new Promise<void>((resolve, reject) => {
          debloquer.push(resolve);
          req.signal?.addEventListener("abort", () => reject(new Error("Appel annulé")));
        })
      : Promise.resolve();
  const agents = {
    async ask(req: AskReq) {
      appels.push({ agent: req.agent, mode: "ask", prompt: req.prompt, imagesDir: req.imagesDir });
      await attendre(req);
      if (s.panne?.agent === req.agent && s.panne.active()) throw new Error("Claude Code n'a pas répondu en 900 s");
      let data: unknown;
      if (req.agent === "directeur-artistique") data = DESIGN;
      else if (req.agent === "redacteur") data = CONTENU;
      else if (req.agent === "relecteur-ux") data = { parcours: { urgent: "ok", comparateur: "ok", sceptique: "ok" }, problemes: [{ gravite: "mineur", parcours: "comparateur", constat: "Survol discret", consigne: "Renforcer le survol" }], verdict: "pass" };
      else if (req.imagesDir) data = s.visuel?.(++visuels) ?? VISUEL_OK;
      else data = { items: [{ phrase: "04 72 00 00 00", section: "hero", statut: "conforme", source: "telephone" }], verdict: "pass" };
      return { text: "", data, costUsd: 0, model: "test", durationMs: 1 } as never;
    },
    async atelier(req: { agent: string; prompt: string; dir: string; signal?: AbortSignal }) {
      // Chaque passage de l'Intégrateur laisse une trace dans src/ : on voit ainsi de quelle version il repart.
      const marque = join(req.dir, "src", "marqueur.txt");
      const marqueur = existsSync(marque) ? readFileSync(marque, "utf8") : null;
      appels.push({ agent: req.agent, mode: "atelier", prompt: req.prompt, marqueur });
      mkdirSync(join(req.dir, "src"), { recursive: true });
      writeFileSync(marque, String(appels.filter((a) => a.mode === "atelier").length));
      await attendre(req);
      return { text: "Consignes appliquées.", costUsd: 0, model: "test", denials: [] };
    },
  };
  return { agents, appels, debloquer };
}

function setup(s: Scenario = {}, over: { dataDir?: string; databasePath?: string } = {}) {
  const { kit, appels: kitAppels } = fakeKit(s);
  const { agents, appels, debloquer } = fakeAgents(s);
  const dataDir = over.dataDir ?? tempDir();
  const hub = createHub({ dataDir, skillsDir: fakeSkills(), databasePath: over.databasePath ?? ":memory:", kit, atelierAgents: agents as never, now: () => new Date("2026-11-02T09:00:00Z") });
  hub.start();
  const company = hub.companies.create(LUMEN);
  return { hub, kit, kitAppels, appels, debloquer, company, dataDir };
}

const etapes = (hub: ReturnType<typeof setup>["hub"], siteId: string) => hub.atelier.pourSite(siteId)!.passes.map((p) => `${p.etape}:${p.etat}`);
const tick = () => new Promise((r) => setTimeout(r, 10));
async function attendre(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("délai dépassé");
    await tick();
  }
}

// ── Brief, assemblage (code pur) ───────────────────────────────────────────

describe("brief et assemblage", () => {
  it("prérequis : nom, métier/NAF, commune et adresse, téléphone", () => {
    const { hub } = setup();
    const vide = hub.companies.create({ raisonSociale: "X" });
    const p = prerequisMaquette(vide);
    expect(p.possible).toBe(false);
    expect(p.manques.join(" ")).toMatch(/métier/);
    expect(p.manques.join(" ")).toMatch(/commune/);
    expect(p.manques.join(" ")).toMatch(/téléphone/);
  });

  it("brief : sources, prestations du NAF, coordonnées, lien Google honnête, J+30", () => {
    const { hub, company, kit } = setup();
    const b = buildBrief({ company: hub.companies.get(company.id), siteId: "s1", recette: "vitrine-artisan", now: new Date("2026-11-02T09:00:00Z"), credits: kit.credits(), sitesMemeMetier: [] });
    expect(b.entreprise.telephone).toEqual({ valeur: "04 72 00 00 00", source: "saisie" });
    expect(b.activite.prestationsPlausibles.length).toBeGreaterThan(4);
    expect(b.zone.voisines?.valeur.find((v) => v.nom === "Lyon 8e")?.lat).toBeTypeOf("number");
    expect(b.zone.carteDisponible).toBe(true);
    expect(b.entreprise.noteGoogle?.url.source).toMatch(/recherche Google Maps/);
    expect(b.demo.dateSuppression.valeur).toBe("2026-12-02");
    expect(b.banqueImages.filter((i) => i.candidate).map((i) => i.fichier)).toEqual(["stock/electricien/a.jpg", "stock/electricien/b.jpg", "stock/maison/c.jpg"]);
    expect(dateSuppression(new Date(2026, 0, 15))).toBe("2026-02-14");
  });

  it("horaires lus depuis le texte de la fiche", () => {
    expect(lireHoraires({ lundi: "8h–12h, 14h–18h", mardi: "8h-12h, 14h-18h", samedi: "Sur rendez-vous", dimanche: "Fermé" })).toEqual([
      { jours: ["lu", "ma"], ouverture: "08:00", fermeture: "12:00" },
      { jours: ["lu", "ma"], ouverture: "14:00", fermeture: "18:00" },
    ]);
  });

  it("cohérence design/contenu et attribution des erreurs du kit à l'agent fautif", () => {
    const { hub, company, kit } = setup();
    const b = buildBrief({ company: hub.companies.get(company.id), siteId: "s1", recette: "vitrine-artisan", now: new Date(), credits: kit.credits(), sitesMemeMetier: [] });
    expect(verifierCoherence(b, DESIGN, CONTENU, new Set(["zap", "shield-check"]))).toEqual([]);
    const mauvais = { ...CONTENU, sections: CONTENU.sections.slice(0, 4) };
    expect(verifierCoherence(b, DESIGN, mauvais)[0]).toMatchObject({ agent: "redacteur" });
    const icone = verifierCoherence(b, DESIGN, CONTENU, new Set(["zap"]));
    expect(icone[0]?.message).toMatch(/icône « shield-check » inconnue/);
    const site = assembler(b, DESIGN, CONTENU);
    expect((site.entreprise as { noteGoogle: { valeur: number } }).noteGoogle.valeur).toBe(4.7);
    expect(attribuer("sections[1].contenu.titre : trop long (90 caractères max)", site)).toBe("redacteur");
    expect(attribuer("theme.couleurs.accent : couleur attendue au format #RRGGBB", site)).toBe("directeur-artistique");
    expect(attribuer("contraste surAccent (#000000) sur accent (#111111) = 1.10:1, minimum 4.5:1", site)).toBe("directeur-artistique");
    expect(attribuer("sections[0].contenu.image : le hero « photo » demande une image", site)).toBe("directeur-artistique");
    expect(attribuer("entreprise.telephone : numéro de téléphone français attendu", site)).toBeNull();
  });
});

// ── Machine à états ─────────────────────────────────────────────────────────

describe("machine à états de l'atelier", () => {
  it("enchaîne toutes les étapes jusqu'à « à valider », fichiers exacts passés aux agents", async () => {
    const { hub, company, appels, dataDir } = setup();
    const { site } = hub.atelier.lancer(company.id);
    expect(hub.sites.get(site.id).statut).toBe("en_fabrication");
    await hub.jobs.idle();
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours").catch(() => {
      throw new Error(JSON.stringify({ f: hub.atelier.pourSite(site.id), jobs: hub.jobs.list().map((j) => [j.label, j.state, j.error]) }).slice(0, 3000));
    });
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("a_valider");
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:ok", "integration:sautee", "controles:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(hub.sites.get(site.id).statut).toBe("a_valider");
    expect(hub.sites.get(site.id).qualiteNote).toBe(87);
    const dir = join(dataDir, "sites", site.id);
    for (const fch of ["brief.json", "design.json", "content.json", "site.json", "src/data/site.json"]) expect(existsSync(join(dir, fch))).toBe(true);
    // Le Rédacteur reçoit le brief et le design exacts (contenu du fichier), pas un résumé.
    const red = appels.find((a) => a.agent === "redacteur")!;
    expect(red.prompt).toContain(readFileSync(join(dir, "design.json"), "utf8").trim());
    expect(red.prompt).toContain('<fichier chemin="brief.json">');
    // Le DA voit les photos candidates (vision), et seulement elles.
    expect(appels.find((a) => a.agent === "directeur-artistique")!.imagesDir).toBe(join(dir, ".atelier", "candidats"));
    // Validation humaine.
    hub.atelier.valider(site.id);
    expect(hub.sites.get(site.id).statut).toBe("demo_prete");
    expect(hub.companies.get(company.id).statut).toBe("maquette");
    await hub.close();
  });

  it("un contrôle raté bloque : tour de correction avec les consignes exactes, puis retour aux contrôles", async () => {
    const rate: CheckReport = {
      ...RAPPORT_OK,
      ok: false,
      lighthouse: { ...RAPPORT_OK.lighthouse!, accessibilite: 88, auditsRates: { accessibilite: [{ id: "color-contrast", titre: "Contraste insuffisant", score: 0 }] } },
      echecs: ["lighthouse-accessibilite : 88/100"],
      controles: [{ id: "lighthouse-accessibilite", ok: false, bloquant: true, detail: "88/100" }],
    };
    const { hub, company, appels } = setup({ rapports: [rate, RAPPORT_OK], visuel: (n) => (n === 1 ? { ...VISUEL_OK, scores: { ...VISUEL_OK.scores, finition: 2 }, corrections: [{ section: "hero", probleme: "Boutons serrés", consigne: "Espacer les boutons du hero de 16 px" }] } : VISUEL_OK) });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("a_valider");
    expect(etapes(hub, site.id).slice(5)).toEqual(["controles:echec", "faits:ok", "visuel:echec", "ux:ok", "correction:ok", "controles:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(f.tours).toHaveLength(1);
    expect(f.tours[0]!.resultat).toBe("ok");
    const integ = appels.find((a) => a.mode === "atelier")!;
    expect(integ.agent).toBe("integrateur");
    expect(integ.prompt).toContain("color-contrast");
    expect(integ.prompt).toContain("Espacer les boutons du hero de 16 px");
    await hub.close();
  });

  it("garde-fou : un tour qui fait baisser la note repart de la meilleure version, avec ses consignes", async () => {
    const note = (n: number) => ({ ...VISUEL_OK, scores: { hierarchie: n, espacement: n, typographie: n, couleur_images: n, finition: n, mobile: n }, corrections: [{ section: "hero", probleme: `note ${n}`, consigne: `Consigne de la version notée ${n}` }] });
    // v0 : 3/5 (échec) ; v1 : 2/5 (pire) ; v2 : réussite.
    const { hub, company, appels } = setup({ visuel: (n) => (n === 1 ? note(3) : n === 2 ? note(2) : VISUEL_OK) });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const integ = appels.filter((a) => a.mode === "atelier");
    expect(integ).toHaveLength(2);
    expect(integ[0]!.marqueur).toBeNull();
    // Tour 2 : la version 1 (marqueur « 1 ») est abandonnée, le site est remis dans la version 0.
    expect(integ[1]!.marqueur).toBeNull();
    expect(integ[1]!.prompt).toContain("meilleure version (version 0)");
    expect(integ[1]!.prompt).toContain("Consigne de la version notée 3");
    expect(integ[1]!.prompt).toContain("à NE PAS reproduire");
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("a_valider");
    expect(f.passes.find((p) => p.etape === "correction" && p.tour === 2)!.resume).toMatch(/Retour à la version 0/);
    await hub.close();
  });

  it("trois tours de correction au plus, puis arrêt « à revoir » avec le motif", async () => {
    const rate: CheckReport = { ...RAPPORT_OK, ok: false, echecs: ["defilement-horizontal 375px : déborde de 24 px"], controles: [{ id: "defilement-horizontal 375px", ok: false, bloquant: true, detail: "déborde de 24 px" }] };
    const { hub, company, appels } = setup({ rapports: [rate] });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("arretee");
    expect(f.motifType).toBe("controle");
    expect(f.motif).toMatch(/3 tours de correction/);
    expect(f.motif).toMatch(/Contrôles automatiques/);
    expect(f.tours.map((t) => t.resultat)).toEqual(["echec", "echec", "echec"]);
    expect(appels.filter((a) => a.mode === "atelier")).toHaveLength(3);
    expect(f.passes.filter((p) => p.etape === "controles")).toHaveLength(4);
    expect(hub.sites.get(site.id).statut).toBe("a_revoir");
    await hub.close();
  });

  it("refus du schéma du kit : renvoyé une fois à l'agent fautif avec le message exact, puis arrêt", async () => {
    const msg = "sections[1].contenu.titre : trop long (90 caractères max)";
    const { hub, company, appels } = setup({ newSite: () => ({ ok: false, message: "site.json invalide", erreurs: [msg] }) });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const f = hub.atelier.pourSite(site.id)!;
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:renvoi", "redaction:ok", "assemblage:renvoi"]);
    const reds = appels.filter((a) => a.agent === "redacteur");
    expect(reds).toHaveLength(2);
    expect(reds[0]!.prompt).not.toContain(msg);
    expect(reds[1]!.prompt).toContain(msg);
    expect(f.etat).toBe("arretee");
    expect(f.motifType).toBe("schema");
    expect(f.motif).toContain(msg);
    await hub.close();
  });

  it("un renvoi corrigé laisse la chaîne continuer", async () => {
    const { hub, company } = setup({ newSite: (n) => (n === 1 ? { ok: false, message: "thème refusé (contrastes)", erreurs: ["contraste surAccent (#FFFFFF) sur accent (#E0A060) = 2.10:1, minimum 4.5:1"] } : { ok: true }) });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(etapes(hub, site.id).slice(0, 7)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:renvoi", "da:ok", "redaction:ok", "assemblage:ok"]);
    expect(hub.atelier.pourSite(site.id)!.etat).toBe("a_valider");
    await hub.close();
  });

  it("modifications demandées : le texte est transmis mot pour mot, puis toute la chaîne de contrôle repasse", async () => {
    const { hub, company, appels, dataDir } = setup();
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat === "a_valider");
    const demande = "Mettez le numéro de téléphone en plus gros dans l'en-tête, et retirez la section réalisations.";
    hub.atelier.modifier(site.id, demande);
    expect(hub.sites.get(site.id).statut).toBe("en_fabrication");
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("a_valider");
    expect(f.exigences).toEqual([demande]);
    expect(f.tours[0]).toMatchObject({ origine: "demande", consignes: [{ origine: "Demande du propriétaire", texte: demande }] });
    expect(etapes(hub, site.id).slice(9)).toEqual(["correction:ok", "controles:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(appels.find((a) => a.mode === "atelier")!.prompt).toContain(demande);
    expect(readFileSync(join(dataDir, "sites", site.id, ".atelier", "corrections", "tour-1.md"), "utf8")).toContain(demande);
    // La revue visuelle vérifie l'exigence.
    expect(appels.filter((a) => a.agent === "controleur-qa" && a.imagesDir).pop()!.prompt).toContain(demande);
    await hub.close();
  });

  it("refaire repart de la direction artistique avec le design précédent comme contre-exemple", async () => {
    const { hub, company, appels } = setup();
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat === "a_valider");
    hub.atelier.refaire(site.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(etapes(hub, site.id).slice(9, 11)).toEqual(["da:ok", "redaction:ok"]);
    expect(appels.filter((a) => a.agent === "directeur-artistique")[1]!.prompt).toContain("design-precedent.json");
    await hub.close();
  });

  it("reprend une fabrication après un redémarrage au milieu d'une étape", async () => {
    const dataDir = tempDir();
    const db = join(dataDir, "liverdian.db");
    const a = setup({ bloquer: "redacteur" }, { dataDir, databasePath: db });
    const { site } = a.hub.atelier.lancer(a.company.id);
    await attendre(() => a.appels.some((x) => x.agent === "redacteur"));
    expect(a.hub.atelier.pourSite(site.id)!.etape).toBe("redaction");
    // Arrêt du hub pendant que le Rédacteur travaille : le travail reste « running » en base.
    await a.hub.jobs.stop();
    a.hub.atelier.close();
    a.hub.db.close();

    const { kit } = fakeKit({});
    const { agents, appels } = fakeAgents({});
    const b = createHub({ dataDir, skillsDir: fakeSkills(), databasePath: db, kit, atelierAgents: agents as never });
    const r = b.start();
    expect(r.recovered).toBe(1);
    await attendre(() => b.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(b.atelier.pourSite(site.id)!.etat).toBe("a_valider");
    // L'étape interrompue est rejouée depuis ses fichiers d'entrée, les précédentes ne le sont pas.
    expect(appels.map((x) => x.agent)[0]).toBe("redacteur");
    expect(appels.some((x) => x.agent === "directeur-artistique")).toBe(false);
    await b.close();
  });

  it("une erreur technique arrête la fabrication ; « reprendre » relance l'étape", async () => {
    let panne = true;
    const { hub, company, appels } = setup({ panne: { agent: "redacteur", active: () => panne } });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("arretee");
    expect(f.motifType).toBe("technique");
    expect(f.motif).toMatch(/Rédaction.*900 s/);
    // Deux essais prévus pour une étape d'agent.
    expect(appels.filter((a) => a.agent === "redacteur")).toHaveLength(2);
    panne = false;
    hub.atelier.reprendre(site.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(hub.atelier.pourSite(site.id)!.etat).toBe("a_valider");
    await hub.close();
  });

  it("refuse une deuxième fabrication en cours pour la même entreprise, et une fiche incomplète", async () => {
    const { hub, company } = setup({ bloquer: "directeur-artistique" });
    hub.atelier.lancer(company.id);
    expect(() => hub.atelier.lancer(company.id)).toThrow(/déjà en fabrication/);
    const incomplete = hub.companies.create({ raisonSociale: "Sans téléphone", naf: "43.21A", adresse: { ligne: "1 rue A", codePostal: "69500", commune: "Bron" } });
    expect(() => hub.atelier.lancer(incomplete.id)).toThrow(/téléphone/);
    await hub.close();
  });
});
