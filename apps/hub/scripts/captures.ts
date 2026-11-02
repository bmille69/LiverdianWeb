/**
 * Captures de l'interface avec Microsoft Edge (playwright-core, canal msedge), pour relecture visuelle.
 *   LIVERDIAN_PORT=4399 npm run captures -- [--seed] [--essai] [--site <id>]
 * Le hub doit tourner (de préférence sur un dossier de données temporaire). --seed ajoute des fiches de démonstration,
 * --essai lance un vrai essai d'agent (haiku) pour montrer un travail en cours. Images dans .data/captures/.
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const base = `http://127.0.0.1:${process.env.LIVERDIAN_PORT ?? 4320}`;
const out = join(root, ".data", "captures");
mkdirSync(out, { recursive: true });

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} : ${String(data.error)}`);
  return data;
}

if (process.argv.includes("--seed")) {
  const fiches = [
    {
      raisonSociale: "SARL Martin Plomberie Chauffage",
      nomCommercial: "Martin Plomberie",
      siren: "812345674",
      naf: "43.22A",
      metier: "Plombier chauffagiste",
      dateCreation: "2015-03-12",
      dirigeant: "Julien Martin",
      telephone: "04 78 12 34 56",
      email: "contact@martin-plomberie.fr",
      adresse: { ligne: "14 rue Paul Bert", codePostal: "69003", commune: "Lyon" },
      horaires: { lundi: "8h–12h, 14h–18h", mardi: "8h–12h, 14h–18h", mercredi: "8h–12h, 14h–18h", jeudi: "8h–12h, 14h–18h", vendredi: "8h–12h, 14h–17h", samedi: "Sur rendez-vous", dimanche: "Fermé" },
      google: { valeur: 4.8, nombre: 63, url: "https://maps.google.com/?cid=1" },
      zone: { commune: "Lyon 3e", voisines: ["Villeurbanne", "Bron", "Lyon 7e"] },
      statut: "qualifie",
      score: 82,
      notes: "Pas de site. Très bons avis, répond vite au téléphone.",
      sources: { siren: "sirene", naf: "sirene", dateCreation: "sirene", dirigeant: "sirene", raisonSociale: "sirene", adresse: "sirene", telephone: "places", horaires: "places", google: "places" },
    },
    { raisonSociale: "Électricité Dubois", metier: "Électricien", siren: "534567891", naf: "43.21A", telephone: "04 72 00 11 22", siteActuel: "http://elec-dubois.fr", adresse: { commune: "Villeurbanne", codePostal: "69100" }, google: { valeur: 4.5, nombre: 21 }, statut: "prospect", score: 64, sources: { siren: "sirene", naf: "sirene", siteActuel: "places", google: "places" } },
    { raisonSociale: "Menuiserie Bois & Fils", metier: "Menuisier", adresse: { commune: "Caluire-et-Cuire", codePostal: "69300" }, google: { valeur: 4.9, nombre: 112 }, statut: "maquette", score: 91 },
    { raisonSociale: "Peinture Rossi SAS", nomCommercial: "Rossi Déco", metier: "Peintre en bâtiment", adresse: { commune: "Lyon", codePostal: "69007" }, statut: "contacte", score: 58, telephone: "06 12 34 56 78" },
    { raisonSociale: "Toitures du Rhône", metier: "Couvreur", adresse: { commune: "Vénissieux", codePostal: "69200" }, google: { valeur: 4.2, nombre: 17 }, statut: "client", score: 77 },
    { raisonSociale: "Serrurerie Express 69", metier: "Serrurier", adresse: { commune: "Lyon", codePostal: "69008" }, statut: "exclu", notes: "Franchise nationale." },
  ];
  const ids: string[] = [];
  for (const f of fiches) ids.push(((await call("POST", "/api/companies", f)).company as { id: string }).id);
  const s1 = (await call("POST", "/api/sites", { companyId: ids[2] })).site as { id: string };
  await call("PATCH", `/api/sites/${s1.id}`, { statut: "a_valider", qualiteNote: 93 });
  const s2 = (await call("POST", "/api/sites", { companyId: ids[4] })).site as { id: string };
  await call("PATCH", `/api/sites/${s2.id}`, { statut: "livre", qualiteNote: 97, urlProd: "https://toitures-du-rhone.fr" });
  await call("POST", "/api/sites", { companyId: ids[0] });
  console.log("Données de démonstration ajoutées.");
}
if (process.argv.includes("--essai")) {
  await call("POST", "/api/agents/redacteur/essai", { question: "Présente-toi en deux phrases : ton rôle et la règle que tu ne transgresses jamais.", model: "haiku" });
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
async function shoot(name: string, path: string, opts: { theme?: "dark" | "light"; width?: number; height?: number; fullPage?: boolean; before?: (p: Page) => Promise<void> } = {}) {
  const context = await browser.newContext({ viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 }, deviceScaleFactor: 1, colorScheme: opts.theme ?? "dark" });
  await context.addInitScript((theme) => {
    localStorage.setItem("liverdian:theme", theme);
    localStorage.setItem("liverdian:motion", "reduced");
  }, opts.theme ?? "dark");
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(250);
  if (opts.before) await opts.before(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: opts.fullPage ?? false });
  if (errors.length) console.log(`  ${name} : erreurs console →`, errors);
  await context.close();
  console.log(`  ${name}.png`);
}

try {
  const companies = (await call("GET", "/api/companies")).companies as { id: string; raisonSociale: string }[];
  const sites = (await call("GET", "/api/sites")).sites as { id: string }[];
  const martin = companies.find((c) => c.raisonSociale.startsWith("SARL Martin")) ?? companies[0];
  await shoot("01-aujourdhui", "/");
  await shoot("02-entreprises", "/entreprises");
  if (martin) await shoot("03-entreprise-detail", `/entreprises/${martin.id}`);
  if (martin)
    await shoot("04-entreprise-formulaire", `/entreprises/${martin.id}`, {
      before: async (p) => {
        await p.getByRole("button", { name: "Modifier" }).click();
      },
    });
  await shoot("05-nouvelle-entreprise", "/entreprises?nouvelle=1");
  await shoot("06-atelier", "/atelier");
  await shoot("07-sites", "/sites");
  if (sites[0]) await shoot("08-site", `/sites/${sites[0].id}`);
  await shoot("09-prospection", "/prospection");
  await shoot("10-equipe", "/equipe");
  await shoot("11-skill", "/equipe", {
    before: async (p) => {
      await p.locator(".skill-chip", { hasText: "web-design-pro" }).first().click();
    },
  });
  await shoot("12-reglages", "/reglages");
  await shoot("13-palette", "/", {
    before: async (p) => {
      await p.keyboard.press("Control+k");
      await p.keyboard.type("ma");
    },
  });
  await shoot("14-clair-aujourdhui", "/", { theme: "light" });
  await shoot("15-clair-entreprises", "/entreprises", { theme: "light" });
  if (martin) await shoot("16-clair-detail", `/entreprises/${martin.id}`, { theme: "light" });
  await shoot("17-mobile", "/entreprises", { width: 390, height: 844 });
  // Écran d'un site fabriqué par l'atelier (--site <id>) : page entière, aperçu plein écran, fiche avec « Créer la maquette ».
  const i = process.argv.indexOf("--site");
  const siteId = i > 0 ? process.argv[i + 1] : undefined;
  if (siteId) {
    const attendreApercu = async (p: Page) => {
      await p.waitForTimeout(2500);
    };
    await shoot("20-site-atelier", `/sites/${siteId}`, { width: 1600, height: 1000, before: attendreApercu });
    // La page défile dans .main : une fenêtre très haute montre tout l'écran du site.
    await shoot("21-site-atelier-page", `/sites/${siteId}`, { width: 1600, height: 3600, before: attendreApercu });
    await shoot("22-site-apercu-plein-ecran", `/sites/${siteId}`, {
      width: 1600,
      height: 1000,
      before: async (p) => {
        await attendreApercu(p);
        await p.getByRole("button", { name: "Plein écran" }).click();
        await p.waitForTimeout(2500);
      },
    });
    await shoot("23-site-apercu-mobile", `/sites/${siteId}`, {
      width: 1600,
      height: 1000,
      before: async (p) => {
        await p.getByRole("button", { name: "Plein écran" }).click();
        await p.getByRole("radio", { name: "Mobile" }).click();
        await p.waitForTimeout(2500);
      },
    });
    await shoot("24-site-clair", `/sites/${siteId}`, { width: 1600, height: 1000, theme: "light", before: attendreApercu });
    const site = (await call("GET", `/api/sites/${siteId}`)).site as { companyId: string };
    await shoot("25-fiche-maquette", `/entreprises/${site.companyId}`);
    await shoot("26-atelier-fabrications", "/atelier");
    await shoot("27-sites-vignettes", "/sites");
    await shoot("28-aujourdhui", "/");
  }
} finally {
  await browser.close();
}
console.log(`Captures dans ${out}`);
