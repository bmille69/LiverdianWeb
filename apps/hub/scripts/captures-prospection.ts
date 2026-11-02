/**
 * Captures de l'écran Prospection avec Microsoft Edge (playwright-core), pour relecture.
 *   LIVERDIAN_PORT=4330 node apps/hub/scripts/captures-prospection.ts [--sortie <dossier>] [--maquette]
 * Le hub doit tourner sur un dossier de données d'essai avec au moins une campagne. --maquette clique « Créer la
 * maquette » sur un prospect prêt (à n'utiliser que sur un hub d'essai sans vrai Claude).
 */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";

const base = `http://127.0.0.1:${process.env.LIVERDIAN_PORT ?? 4330}`;
const i = process.argv.indexOf("--sortie");
const out = resolve(i > 0 ? process.argv[i + 1]! : "C:/Temp/captures-prospection");
mkdirSync(out, { recursive: true });

const get = async <T>(p: string) => (await (await fetch(base + p)).json()) as T;
const campagnes = (await get<{ campagnes: { id: string }[] }>("/api/prospection/campagnes")).campagnes;
const prospects = (await get<{ prospects: { id: string; nom: string; siteStatut: string | null; maquettePossible: boolean; telephone: string | null }[] }>(`/api/prospection/prospects?campagne=${campagnes[0]?.id ?? ""}`)).prospects;
const audite = prospects.find((p) => p.siteStatut === "non_mobile") ?? prospects.find((p) => p.siteStatut && p.siteStatut !== "aucun") ?? prospects[0];

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
const page = await ctx.newPage();
const erreurs: string[] = [];
page.on("pageerror", (e) => erreurs.push(e.message));
page.on("console", (m) => m.type() === "error" && erreurs.push(m.text()));

async function shot(nom: string, p: Page = page) {
  await p.waitForTimeout(450);
  await p.screenshot({ path: join(out, `${nom}.png`) });
  console.log("capture", nom);
}

await page.goto(`${base}/prospection?campagne=${campagnes[0]?.id ?? ""}`);
await page.waitForSelector(".prosp-table, .empty", { timeout: 15_000 });
await shot("01-prospects");
await page.locator(".prosp-table tbody tr").nth(1).locator("input[type=checkbox]").check();
await page.locator(".prosp-table tbody tr").nth(2).locator("input[type=checkbox]").check();
await page.locator(".prosp-table tbody tr").nth(3).hover();
await shot("02-selection");
await page.locator(".selection-bar .btn-ghost").click();
if (audite) {
  await page.goto(`${base}/prospection/${audite.id}?campagne=${campagnes[0]?.id ?? ""}`);
  await page.waitForSelector(".score-card", { timeout: 15_000 });
  await shot("03-fiche");
  await page.locator(".drawer-body").evaluate((el) => el.scrollTo(0, 700));
  await shot("04-fiche-suite");
  await page.keyboard.press("Escape");
}
await page.goto(`${base}/prospection`);
await page.locator(".page-actions .btn-primary").click();
await page.waitForSelector(".metier-chips");
await shot("05-nouvelle-campagne");
await page.keyboard.press("Escape");
for (const [o, n] of [["grille", "06-grille"], ["maquettes", "07-file"], ["rgpd", "08-rgpd"]] as const) {
  await page.goto(`${base}/prospection?onglet=${o}`);
  await shot(n);
}
await page.goto(`${base}/reglages`);
await page.locator("text=Clé Google Places").scrollIntoViewIfNeeded();
await shot("09-reglages");

// Thème clair et petite largeur.
const clair = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: "light" });
const p2 = await clair.newPage();
await p2.goto(`${base}/prospection?campagne=${campagnes[0]?.id ?? ""}`);
await p2.evaluate(() => localStorage.setItem("liverdian:theme", "light"));
await p2.reload();
await p2.waitForSelector(".prosp-table, .empty");
await shot("10-clair", p2);

if (process.argv.includes("--maquette")) {
  const pret = prospects.find((p) => p.maquettePossible);
  if (!pret) console.log("Aucun prospect prêt pour une maquette");
  else {
    await page.goto(`${base}/prospection/${pret.id}`);
    await page.waitForSelector(".score-card");
    await page.locator(".drawer-foot .btn-primary").click();
    await page.waitForTimeout(1500);
    await shot("11-maquette-lancee");
    console.log("Maquette demandée pour", pret.nom);
  }
}
console.log(erreurs.length ? `Erreurs de la page :\n${erreurs.join("\n")}` : "Aucune erreur dans la page");
await browser.close();
