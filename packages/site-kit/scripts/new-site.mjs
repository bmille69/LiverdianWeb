#!/usr/bin/env node
/**
 * Crée un projet de site client à partir du kit.
 *
 *   node scripts/new-site.mjs <dossier-cible> <site.json> [--images <dossier>] [--force]
 *
 * - valide le site.json (message français et code 1 s'il est invalide) ;
 * - copie les sources du kit (src/, astro.config.mjs, tsconfig.json, package.json) ;
 * - écrit src/data/site.json ;
 * - copie uniquement les images de la banque citées par le site.json (stock/…) ;
 * - copie les photos du client (--images) dans photos/ ;
 * - relie node_modules à celui du kit par une jonction Windows (aucune réinstallation).
 * Ensuite : `npm run build` dans le dossier cible.
 *
 * --force : régénère un dossier existant (sources et banque remplacées ; photos/ conservé sauf si --images).
 * Sortie : une ligne JSON finale { ok, cible, images, photos } pour le hub.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A_COPIER = ["src", "astro.config.mjs", "tsconfig.json", "package.json", ".gitignore"];

function sortir(code, message, extra = {}) {
  if (code !== 0) console.error(`✖ ${message}`);
  console.log(JSON.stringify({ ok: code === 0, message, ...extra }));
  process.exit(code);
}

// ─── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const pos = [];
let dossierImages;
let force = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--images") dossierImages = args[++i];
  else if (args[i] === "--force") force = true;
  else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage : node scripts/new-site.mjs <dossier-cible> <site.json> [--images <dossier>] [--force]");
    process.exit(0);
  } else pos.push(args[i]);
}
if (pos.length !== 2) sortir(2, "usage : new-site.mjs <dossier-cible> <site.json> [--images <dossier>] [--force]");
const cible = path.resolve(pos[0]);
const fichierSite = path.resolve(pos[1]);

// ─── Validation du site.json ─────────────────────────────────────────────────
if (!fs.existsSync(fichierSite)) sortir(1, `site.json introuvable : ${fichierSite}`);
let donnees;
try {
  donnees = JSON.parse(fs.readFileSync(fichierSite, "utf8"));
} catch (e) {
  sortir(1, `site.json n'est pas un JSON valide : ${e.message}`);
}
const { validerSite } = await import(pathToFileURL(path.join(KIT, "src", "schema.ts")).href);
const r = validerSite(donnees);
if (!r.ok) {
  console.error("✖ site.json invalide — corriger les champs suivants :");
  for (const e of r.erreurs) console.error("  • " + e);
  sortir(1, "site.json invalide", { erreurs: r.erreurs });
}
const site = r.site;
const { resoudreTheme, verifierContrastes } = await import(pathToFileURL(path.join(KIT, "src", "lib", "theme.ts")).href);
const contrastes = verifierContrastes(resoudreTheme(site.theme).couleurs);
if (contrastes.length) {
  console.error("✖ Thème refusé : contrastes insuffisants (WCAG AA)");
  for (const e of contrastes) console.error("  • " + e);
  sortir(1, "thème refusé (contrastes)", { erreurs: contrastes });
}

// Images citées : stock/… doit exister dans la banque du kit ; photos/… dans --images.
const fichiersImages = Object.values(site.images).map((i) => i.fichier);
const stock = [...new Set(fichiersImages.filter((f) => f.startsWith("stock/")))];
const photos = fichiersImages.filter((f) => f.startsWith("photos/"));
const manquantes = stock.filter((f) => !fs.existsSync(path.join(KIT, f)));
if (manquantes.length) sortir(1, `images absentes de la banque : ${manquantes.join(", ")}`);
if (dossierImages && !fs.existsSync(dossierImages)) sortir(1, `dossier d'images introuvable : ${dossierImages}`);

// ─── Dossier cible ───────────────────────────────────────────────────────────
if (fs.existsSync(cible) && fs.readdirSync(cible).length > 0) {
  if (!force) sortir(1, `le dossier cible existe et n'est pas vide (utiliser --force pour régénérer) : ${cible}`);
  for (const n of [...A_COPIER, "stock", "dist", ".astro", ".astro-cache"]) fs.rmSync(path.join(cible, n), { recursive: true, force: true });
  if (dossierImages) fs.rmSync(path.join(cible, "photos"), { recursive: true, force: true });
}
fs.mkdirSync(cible, { recursive: true });

for (const n of A_COPIER) {
  const src = path.join(KIT, n);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(cible, n), { recursive: true });
}
fs.writeFileSync(path.join(cible, "src", "data", "site.json"), JSON.stringify(donnees, null, 2) + "\n");

for (const f of stock) {
  fs.mkdirSync(path.dirname(path.join(cible, f)), { recursive: true });
  fs.copyFileSync(path.join(KIT, f), path.join(cible, f));
}
// Crédits des images de banque utilisées (traçabilité des licences).
const credits = JSON.parse(fs.readFileSync(path.join(KIT, "stock", "CREDITS.json"), "utf8"));
const utilises = credits.filter((c) => stock.includes("stock/" + c.fichier));
fs.mkdirSync(path.join(cible, "stock"), { recursive: true });
fs.writeFileSync(path.join(cible, "stock", "CREDITS.json"), JSON.stringify(utilises, null, 2) + "\n");

if (dossierImages) fs.cpSync(path.resolve(dossierImages), path.join(cible, "photos"), { recursive: true });
const photosManquantes = photos.filter((f) => !fs.existsSync(path.join(cible, f)));
if (photosManquantes.length) sortir(1, `photos client absentes : ${photosManquantes.join(", ")} (option --images)`);

// ─── node_modules partagé (jonction) ─────────────────────────────────────────
const nm = path.join(cible, "node_modules");
if (!fs.existsSync(nm)) {
  const nmKit = path.join(KIT, "node_modules");
  if (!fs.existsSync(nmKit)) sortir(1, "le kit n'a pas de node_modules : lancer `npm install` dans packages/site-kit");
  fs.symlinkSync(nmKit, nm, "junction");
}

fs.writeFileSync(
  path.join(cible, ".liverdian-kit.json"),
  JSON.stringify({ kit: KIT, version: JSON.parse(fs.readFileSync(path.join(KIT, "package.json"), "utf8")).version, genereLe: new Date().toISOString() }, null, 2) + "\n",
);

sortir(0, "site créé", { cible, slug: site.slug, images: stock.length, photos: photos.length });
