#!/usr/bin/env node
/**
 * Prépare les captures d'un contrôle pour la relecture par vision et pour l'interface.
 *
 *   node scripts/decouper-captures.mjs <dossier-captures> <dossier-sortie>
 *
 * Une capture pleine page (1440 × 6600 px) réduite d'un bloc devient illisible pour un modèle de vision.
 * Le script la découpe en tranches de hauteur d'écran, numérotées dans l'ordre de la page :
 *   01-mobile-ecran-initial.png, 02-mobile-1.png …, puis tablette, puis bureau ;
 * et produit une vignette (haut de la page bureau, 640 px de large) : vignette.jpg.
 * Dernière ligne de stdout : JSON { ok, fichiers: [...], vignette }.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(KIT, "package.json"));
const sharp = require("sharp");

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error("Usage : node scripts/decouper-captures.mjs <dossier-captures> <dossier-sortie>");
  process.exit(2);
}
fs.rmSync(sortie, { recursive: true, force: true });
fs.mkdirSync(sortie, { recursive: true });

/** Tranches : hauteur proche d'un écran du support, avec un léger recouvrement pour ne rien couper sans le voir. */
const PLANS = [
  { source: "capture-375.png", nom: "mobile", hauteur: 1500, recouvrement: 80 },
  { source: "capture-768.png", nom: "tablette", hauteur: 1600, recouvrement: 80 },
  { source: "capture-1440.png", nom: "bureau", hauteur: 1100, recouvrement: 60 },
];

const fichiers = [];
let n = 1;
const num = () => String(n++).padStart(2, "0");

const initial = path.join(entree, "capture-375-initial.png");
if (fs.existsSync(initial)) {
  const f = `${num()}-mobile-ecran-initial.png`;
  fs.copyFileSync(initial, path.join(sortie, f));
  fichiers.push(f);
}

for (const plan of PLANS) {
  const src = path.join(entree, plan.source);
  if (!fs.existsSync(src)) continue;
  const meta = await sharp(src).metadata();
  const largeur = meta.width ?? 0;
  const total = meta.height ?? 0;
  let haut = 0;
  let i = 1;
  while (haut < total) {
    const h = Math.min(plan.hauteur, total - haut);
    // Une dernière tranche minuscule est rattachée à la précédente (rien d'utile à lire dans 100 px).
    if (h < 200 && i > 1) break;
    const f = `${num()}-${plan.nom}-${i}.png`;
    await sharp(src).extract({ left: 0, top: haut, width: largeur, height: h }).png({ compressionLevel: 9 }).toFile(path.join(sortie, f));
    fichiers.push(f);
    if (haut + h >= total) break;
    haut += plan.hauteur - plan.recouvrement;
    i++;
  }
}

let vignette = null;
const bureau = path.join(entree, "capture-1440.png");
if (fs.existsSync(bureau)) {
  const meta = await sharp(bureau).metadata();
  vignette = "vignette.jpg";
  await sharp(bureau)
    .extract({ left: 0, top: 0, width: meta.width ?? 1440, height: Math.min(meta.height ?? 900, 900) })
    .resize({ width: 640 })
    .jpeg({ quality: 78, mozjpeg: true })
    .toFile(path.join(path.dirname(sortie), vignette));
}

console.log(JSON.stringify({ ok: true, fichiers, vignette }));
