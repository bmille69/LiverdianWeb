/**
 * Vraie campagne de prospection, de bout en bout, sur un dossier de données séparé (jamais .data).
 *   LIVERDIAN_DATA_DIR=C:/Temp/essai node apps/hub/scripts/essai-prospection.ts [--minutes 9] [--serveur 4330]
 * Crée (une fois) la campagne « Électriciens et plombiers, Bron + 10 km », la lance ou la reprend là où elle s'était
 * arrêtée, attend la fin (ou le délai), affiche les chiffres. Avec --serveur, sert aussi l'interface pendant ce temps.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHub } from "../src/hub.ts";
import { buildServer } from "../src/server/http.ts";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dataDir = process.env.LIVERDIAN_DATA_DIR;
if (!dataDir || resolve(dataDir) === join(root, ".data")) {
  console.error("Indiquez un LIVERDIAN_DATA_DIR séparé (jamais le .data du propriétaire).");
  process.exit(1);
}
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const minutes = Number(arg("--minutes") ?? 9);
const port = arg("--serveur") ? Number(arg("--serveur")) : null;

const hub = createHub({ dataDir: resolve(dataDir), skillsDir: join(root, "skills"), claudeBinary: process.env.LIVERDIAN_CLAUDE_BIN });
const app = port ? await buildServer(hub, { port, previewPort: port + 1, webDist: join(root, "apps", "web", "dist") }) : null;
if (app) await app.listen({ host: "127.0.0.1", port: port! });
const { recovered } = hub.jobs.start();
const NOM = "Électriciens et plombiers, Bron + 10 km";
let c = hub.prospection.campagnes.list().find((x) => x.nom === NOM);
if (!c) c = hub.prospection.campagnes.creer({ nom: NOM, criteres: { metiers: ["electricien", "plombier"], zone: { type: "rayon", commune: "Bron", rayonKm: 10 } } });
if (arg("--limite") && c.etat !== "en_cours") c = hub.prospection.campagnes.modifier(c.id, { nom: c.nom, criteres: { ...c.criteres, limite: Number(arg("--limite")) } });
if (c.etat !== "en_cours" && !process.argv.includes("--sans-lancer")) c = hub.prospection.campagnes.lancer(c.id);
console.log(`Campagne ${c.id} : ${c.etat}${recovered ? ` (reprise de ${recovered} travail)` : ""}`);

const fin = Date.now() + minutes * 60_000;
let dernier = "";
while (Date.now() < fin) {
  c = hub.prospection.campagnes.get(c.id);
  const job = c.jobId ? hub.jobs.get(c.jobId) : null;
  const ligne = `${c.etat} · ${c.phase ?? "-"} · ${job?.progress.label ?? ""}`;
  if (ligne !== dernier) console.log(new Date().toLocaleTimeString("fr-FR"), ligne);
  dernier = ligne;
  // Avec --serveur, l'interface reste servie jusqu'au délai.
  if (c.etat !== "en_cours" && !port) break;
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(JSON.stringify({ etat: c.etat, phase: c.phase, erreur: c.erreur, compteurs: c.compteurs, appels: hub.prospection.compteur.parCampagne(c.id) }, null, 2));
if (app) await app.close();
await hub.close();
process.exit(0);
