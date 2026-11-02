import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QuotaClaudeError } from "../src/agents/claude-cli.ts";
import { SiteKit, type CheckReport, type KitRunner, type NewSiteResult } from "../src/atelier/kit.ts";
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

const MISE: Design["theme"]["mise"] = { echelle: "affirmee", densite: "standard", images: "naturel", cadre: "auto", boutons: "pilule", rythme: "alterne", titres: "normale", surtitres: "filet" };

const DESIGN: Design = {
  intention: ["Un site pour les particuliers de Bron et de l'est lyonnais.", "Une impression de précision et de calme, sans esbroufe.", "Une teinte cuivre qui le distingue des électriciens bleu et jaune."],
  theme: {
    preset: "electricien",
    palette: { teinte: 230, accent: 55, vivacite: "franche", accentTon: "clair", neutres: "teintes", fond: "casse", sombre: "profond" },
    polices: { paire: "plan-de-coupe" },
    rayon: 4,
    signature: "faisceau",
    mise: MISE,
  },
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
    { type: "surmesure", variante: "composant", nombreItems: 2, justification: "Élément propre à Lumen Élec" },
    { type: "devis", variante: "scinde", justification: "Formulaire court" },
  ],
  signature: { element: "Trame technique", description: "Le motif faisceau en fond des sections teintées" },
  surMesure: {
    element: "Tableau électrique annoté",
    composant: "TableauAnnote",
    description: "Schéma SVG d'un tableau électrique, chaque rangée de disjoncteurs reliée à une légende ; deux colonnes au bureau, empilé sur mobile, jetons du thème.",
    textes: "Un titre, une intro et deux éléments (titre + texte) : ce que protège chaque rangée.",
    pourquoi: "Lumen Élec fait surtout des mises aux normes de tableaux à Bron.",
  },
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
    {
      type: "surmesure",
      titre: "Ce que protège votre tableau",
      elements: [
        { titre: "Les différentiels", texte: "Ils coupent le courant en cas de fuite vers la terre." },
        { titre: "Les disjoncteurs", texte: "Chacun protège un circuit contre les surcharges." },
      ],
    },
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
  /** L'agent indiqué répond « limite de l'abonnement atteinte » tant que la fonction rend vrai (ADR-16). */
  quota?: { agent: string; active: () => boolean };
  /** Exemples du kit (examples/<nom>/site.json), inscrits au registre au démarrage. */
  exemples?: Record<string, object>;
};

const KIT_REEL = new SiteKit(join(import.meta.dirname, "..", "..", "..", "packages", "site-kit"));

function fakeKit(s: Scenario) {
  const root = tempDir("kit-");
  for (const [nom, site] of Object.entries(s.exemples ?? {})) {
    mkdirSync(join(root, "examples", nom), { recursive: true });
    writeFileSync(join(root, "examples", nom, "site.json"), JSON.stringify(site));
  }
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
    // Thème et catalogue : ceux du vrai kit (code pur), pour mesurer l'unicité comme en fabrication.
    resoudreTheme: (t: unknown) => KIT_REEL.resoudreTheme(t),
    catalogue: () => KIT_REEL.catalogue(),
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
      if (s.quota?.agent === req.agent && s.quota.active()) throw new QuotaClaudeError();
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
      mkdirSync(join(req.dir, "src", "sections", "custom"), { recursive: true });
      // L'élément sur mesure demandé par le design (étape « Élément sur mesure »).
      writeFileSync(join(req.dir, "src", "sections", "custom", "TableauAnnote.astro"), "---\n---\n<section></section>\n");
      writeFileSync(marque, String(appels.filter((a) => a.mode === "atelier").length));
      await attendre(req);
      if (s.quota?.agent === req.agent && s.quota.active()) throw new QuotaClaudeError();
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
    const b = buildBrief({ company: hub.companies.get(company.id), siteId: "s1", recette: "vitrine-artisan", now: new Date("2026-11-02T09:00:00Z"), credits: kit.credits() });
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
    const b = buildBrief({ company: hub.companies.get(company.id), siteId: "s1", recette: "vitrine-artisan", now: new Date(), credits: kit.credits() });
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
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:ok", "unicite:ok", "integration:ok", "controles:ok", "unicite-controle:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(hub.sites.get(site.id).statut).toBe("a_valider");
    expect(hub.sites.get(site.id).qualiteNote).toBe(87);
    const dir = join(dataDir, "sites", site.id);
    for (const fch of ["brief.json", "unicite-design.json", "unicite-textes.json", "design.json", "content.json", "site.json", "src/data/site.json", "src/sections/custom/TableauAnnote.astro", ".atelier/unicite.json"]) expect(existsSync(join(dir, fch))).toBe(true);
    // La fabrication réussie entre au registre.
    await attendre(() => hub.registre.liste().some((e) => e.id === site.id));
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
    expect(etapes(hub, site.id).slice(6)).toEqual(["controles:echec", "unicite-controle:ok", "faits:ok", "visuel:echec", "ux:ok", "correction:ok", "controles:ok", "unicite-controle:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(f.tours).toHaveLength(1);
    expect(f.tours[0]!.resultat).toBe("ok");
    const integ = appels.filter((a) => a.mode === "atelier")[1]!;
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
    // Le premier passage de l'Intégrateur code l'élément sur mesure (marqueur « 1 ») ; puis deux tours de correction.
    const integ = appels.filter((a) => a.mode === "atelier").slice(1);
    expect(integ).toHaveLength(2);
    expect(integ[0]!.marqueur).toBe("1");
    // Tour 2 : la version 1 (marqueur « 2 ») est abandonnée, le site est remis dans la version 0 (marqueur « 1 »).
    expect(integ[1]!.marqueur).toBe("1");
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
    expect(appels.filter((a) => a.mode === "atelier")).toHaveLength(4);
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
    expect(etapes(hub, site.id).slice(0, 8)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:renvoi", "da:ok", "redaction:ok", "assemblage:ok", "unicite:ok"]);
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
    expect(etapes(hub, site.id).slice(11)).toEqual(["correction:ok", "controles:ok", "unicite-controle:ok", "faits:ok", "visuel:ok", "ux:ok"]);
    expect(appels.filter((a) => a.mode === "atelier")[1]!.prompt).toContain(demande);
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
    expect(etapes(hub, site.id).slice(11, 13)).toEqual(["da:ok", "redaction:ok"]);
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
    a.hub.prospection.close();
    await a.hub.jobs.stop();
    a.hub.atelier.close();
    await a.hub.registre.fermer();
    // Les minuteries déjà programmées (relance de la file des maquettes) passent avant la fermeture de la base.
    await new Promise((r) => setTimeout(r, 0));
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

  it("limite du quota : la fabrication se met en attente, la reprise automatique réessaie, la manuelle aboutit", async () => {
    let quotaEpuise = true;
    const { hub, company } = setup({ quota: { agent: "redacteur", active: () => quotaEpuise } });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    let f = hub.atelier.pourSite(site.id)!;
    // La fabrication n'est ni arrêtée ni échouée : elle attend le rétablissement du quota.
    expect(f.etat).toBe("en_attente");
    expect(f.motifType).toBe("quota");
    expect(f.etape).toBe("redaction");
    expect(f.motif).toMatch(/Limite de l'abonnement Claude atteinte/);
    expect(f.passes.at(-1)).toMatchObject({ etape: "redaction", etat: "erreur", resume: "Limite de l'abonnement atteinte : mise en attente" });
    expect(hub.sites.get(site.id).statut).toBe("en_fabrication");
    // La reprise automatique (minuteur du moteur) relance les fabrications en attente.
    expect(hub.atelier.reprendreEnAttente()).toBe(1);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("en_attente"); // quota toujours épuisé : on attend encore
    // Quota rétabli : la reprise manuelle relance l'étape et la fabrication va au bout.
    quotaEpuise = false;
    hub.atelier.reprendre(site.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat === "a_valider");
    expect(hub.sites.get(site.id).statut).toBe("a_valider");
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

// ── Unicité ─────────────────────────────────────────────────────────────────

/** site.json d'un autre site (exemple du kit), à partir du design et des textes de test, avec des écarts choisis. */
function siteExemple(o: { nom: string; commune: string; lat: number; lon: number; design?: Partial<Design["theme"]>; hero?: string; variantes?: Record<string, string>; textes?: Contenu }) {
  const textes = o.textes ?? CONTENU;
  const images: Record<string, { fichier: string; alt: string }> = { hero: { fichier: o.hero ?? "stock/electricien/a.jpg", alt: "Photo" } };
  return {
    entreprise: { raisonSociale: o.nom, metier: "electricien", adresse: { rue: "1 rue A", codePostal: "69000", commune: o.commune } },
    zone: { commune: { nom: o.commune, lat: o.lat, lon: o.lon }, voisines: [] },
    theme: { ...DESIGN.theme, ...(o.design ?? {}) },
    images,
    entete: { variante: "simple" },
    pied: { variante: "complet" },
    sections: DESIGN.sections.map((d, i) => {
      const c = textes.sections[i] ?? {};
      return { type: d.type, variante: o.variantes?.[d.type] ?? d.variante, ...(d.type === "surmesure" ? { composant: "Autre" } : {}), contenu: { ...c, type: undefined, ...(d.type === "hero" ? { image: "hero" } : {}) } };
    }),
    seo: textes.seo,
  };
}

describe("unicité des sites", () => {
  it("registre : exemples et maquettes inscrits au démarrage, rattrapage idempotent", async () => {
    const { hub, company, dataDir } = setup({ exemples: { "electricien-bron": siteExemple({ nom: "Volt Est", commune: "Vénissieux", lat: 45.697, lon: 4.886 }) } });
    await hub.registre.pret;
    expect(hub.registre.liste().map((e) => e.id)).toEqual(["exemple:electricien-bron"]);
    // Une maquette déjà construite en base (avant le registre) : le rattrapage l'inscrit, sans doublon au second passage.
    const site = hub.sites.create({ companyId: company.id });
    mkdirSync(join(dataDir, "sites", site.id, "src", "data"), { recursive: true });
    writeFileSync(join(dataDir, "sites", site.id, "src", "data", "site.json"), JSON.stringify(siteExemple({ nom: "Lumen Élec", commune: "Bron", lat: 45.7386, lon: 4.9131 })));
    expect(await hub.registre.rattraper()).toMatchObject({ exemples: 1, maquettes: 1, erreurs: [] });
    expect(await hub.registre.rattraper()).toMatchObject({ exemples: 1, maquettes: 1 });
    const liste = hub.registre.liste();
    expect(liste).toHaveLength(2);
    expect(liste.find((e) => e.id === site.id)).toMatchObject({ origine: "maquette", companyId: company.id, metier: "electricien", commune: "Bron" });
    // Les maquettes de la même entreprise ne se comparent pas entre elles (ce sont des versions du même client).
    expect(hub.registre.comparables("autre-site", company.id).map((a) => a.id)).toEqual(["exemple:electricien-bron"]);
    // Un design remis en chantier (direction artistique relancée) sort du registre jusqu'au prochain contrôle d'unicité.
    hub.registre.retirer(site.id);
    expect(hub.registre.liste().map((e) => e.id)).toEqual(["exemple:electricien-bron"]);
    await hub.close();
  });

  it("design trop proche d'un site du même métier dans la zone : renvoyé au DA avec le site en conflit, deux fois, puis arrêt", async () => {
    // Même design (autre photo de hero), à Vénissieux (≈ 5 km de Bron).
    const { hub, company, appels, dataDir } = setup({ exemples: { proche: siteExemple({ nom: "Volt Est", commune: "Vénissieux", lat: 45.697, lon: 4.886, hero: "stock/electricien/b.jpg" }) } });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:renvoi", "da:renvoi", "da:renvoi"]);
    const das = appels.filter((a) => a.agent === "directeur-artistique");
    expect(das[1]!.prompt).toContain("Contrôle d'unicité du design");
    expect(das[1]!.prompt).toContain("Conflit avec « Volt Est » (Vénissieux");
    expect(das[1]!.prompt).toMatch(/même paire de polices que Volt Est/);
    expect(das[1]!.prompt).toMatch(/distance de design 0\.\d+ avec Volt Est .*minimum 0.55 ; éléments trop proches : même couleur d'accent : #[0-9A-F]{6} contre #[0-9A-F]{6}, 0° d'écart de teinte ; même police des titres/);
    // Le DA a reçu les empreintes des sites proches avant de dessiner.
    expect(das[0]!.prompt).toContain('<fichier chemin="unicite-design.json">');
    expect(JSON.parse(readFileSync(join(dataDir, "sites", site.id, "unicite-design.json"), "utf8")).sitesProches[0]).toMatchObject({ site: "Volt Est", relation: "même métier, même zone" });
    const f = hub.atelier.pourSite(site.id)!;
    expect(f.etat).toBe("arretee");
    expect(f.motif).toContain("Volt Est");
    await hub.close();
  });

  it("texte recyclé d'un autre site du métier : renvoyé au Rédacteur avec les passages verbatim", async () => {
    // Design très différent, mêmes textes : seul le Rédacteur est en cause.
    const ailleurs = siteExemple({
      nom: "Volt Est",
      commune: "Vénissieux",
      lat: 45.697,
      lon: 4.886,
      hero: "stock/electricien/b.jpg",
      design: { palette: { teinte: 150, accent: 300, vivacite: "vive", accentTon: "fonce", neutres: "colores", fond: "blanc", sombre: "colore" }, polices: { paire: "artisan-d-art" }, rayon: 16, signature: "tuiles", mise: { echelle: "monumentale", densite: "aeree", images: "duotone", cadre: "arche", boutons: "marque", rythme: "contraste", titres: "capitales", surtitres: "pastille" } },
      variantes: { hero: "panorama", services: "tuiles", realisations: "bande", zone: "tableau", devis: "appel" },
    });
    const { hub, company, appels, dataDir } = setup({ exemples: { ailleurs } });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:ok", "redaction:ok", "assemblage:ok", "unicite:renvoi", "redaction:ok", "assemblage:ok", "unicite:renvoi", "redaction:ok", "assemblage:ok", "unicite:renvoi"]);
    const reds = appels.filter((a) => a.agent === "redacteur");
    expect(reds[0]!.prompt).toContain('<fichier chemin="unicite-textes.json">');
    expect(reds[0]!.prompt).toContain("Dépannage");
    expect(reds[1]!.prompt).toContain("le texte est trop proche d'un site existant");
    expect(reds[1]!.prompt).toContain("passage déjà employé : « une panne un disjoncteur qui saute diagnostic et réparation »");
    expect(appels.filter((a) => a.agent === "directeur-artistique")).toHaveLength(1);
    const u = JSON.parse(readFileSync(join(dataDir, "sites", site.id, ".atelier", "unicite.json"), "utf8"));
    expect(u.plusProche.site).toBe("Volt Est");
    expect(u.texteMax.similarite).toBeGreaterThan(0.5);
    expect(hub.atelier.pourSite(site.id)!.etat).toBe("arretee");
    await hub.close();
  });

  it("photo déjà en hero dans la zone : exclue des candidates hero, refus du design qui la reprend", async () => {
    const autreMetier = { ...siteExemple({ nom: "Eau Claire", commune: "Villeurbanne", lat: 45.7719, lon: 4.8902 }), entreprise: { raisonSociale: "Eau Claire", metier: "plombier", adresse: { rue: "1 rue B", codePostal: "69100", commune: "Villeurbanne" } } };
    const { hub, company, appels, dataDir } = setup({ exemples: { plombier: autreMetier } });
    const { site } = hub.atelier.lancer(company.id);
    await attendre(() => hub.atelier.pourSite(site.id)!.etat !== "en_cours");
    const brief = JSON.parse(readFileSync(join(dataDir, "sites", site.id, "brief.json"), "utf8")) as { banqueImages: { fichier: string; hero: boolean; exclueHero?: string; usage?: unknown[] }[] };
    const a = brief.banqueImages.find((i) => i.fichier === "stock/electricien/a.jpg")!;
    expect(a.hero).toBe(false);
    expect(a.exclueHero).toMatch(/déjà en hero chez Eau Claire \(Villeurbanne, 4\.\d km\)/);
    expect(brief.banqueImages.find((i) => i.fichier === "stock/electricien/b.jpg")!.hero).toBe(true);
    expect(appels.filter((x) => x.agent === "directeur-artistique")[1]!.prompt).toContain("est exclue du hero (déjà en hero chez Eau Claire");
    expect(etapes(hub, site.id)).toEqual(["brief:ok", "da:renvoi", "da:renvoi"]);
    await hub.close();
  });
});
