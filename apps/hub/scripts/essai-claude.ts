/**
 * Essai manuel du câblage des agents : un VRAI appel au CLI claude (abonnement), hors de la suite de tests.
 *   npm run essai:claude              → mode structured, modèle haiku
 *   npm run essai:claude -- --vision  → en plus, lecture d'une image par vision (dossier donné en 2e argument)
 * Données dans un dossier temporaire : la base de .data n'est pas touchée.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createHub } from "../src/hub.ts";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dataDir = mkdtempSync(join(tmpdir(), "liverdian-essai-"));
const hub = createHub({ dataDir, skillsDir: join(root, "skills") });

try {
  console.log("Appel structured (directeur, haiku)…");
  const r = await hub.agents.ask({
    agent: "directeur",
    model: "haiku",
    prompt: "Donne en une phrase la règle la plus importante de la maison Liverdian, et le nombre de règles que tu connais.",
    schema: z.object({ regle: z.string().min(5), nombreDeRegles: z.number().int() }),
    summary: "Essai de câblage",
  });
  console.log("  Réponse :", r.data);
  console.log(`  Modèle ${r.model} · ${(r.durationMs / 1000).toFixed(1)} s · coût indicatif ${r.costUsd?.toFixed(4) ?? "?"} $`);

  const visionIdx = process.argv.indexOf("--vision");
  if (visionIdx >= 0) {
    const dir = resolve(process.argv[visionIdx + 1] ?? join(root, ".data", "captures"));
    console.log(`Appel vision (relecteur-ux, haiku) sur ${dir}…`);
    const v = await hub.agents.ask({
      agent: "relecteur-ux",
      model: "haiku",
      imagesDir: dir,
      prompt: "Lis la première image (outil Read) et décris en une phrase ce qu'elle montre.",
      schema: z.object({ fichier: z.string(), description: z.string() }),
      summary: "Essai vision",
    });
    console.log("  Réponse :", v.data);
  }
  console.log("Journal des appels :", hub.agents.calls().map((c) => `${c.agent}/${c.model}/${c.mode} ok=${c.ok} ${c.durationMs} ms`));
} catch (err) {
  console.error("ÉCHEC :", (err as Error).message);
  process.exitCode = 1;
} finally {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
}
