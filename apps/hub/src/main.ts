import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHub } from "./hub.ts";
import { buildPreviewServer, buildServer } from "./server/http.ts";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const dataDir = process.env.LIVERDIAN_DATA_DIR ? resolve(process.env.LIVERDIAN_DATA_DIR) : join(root, ".data");
const port = Number(process.env.LIVERDIAN_PORT ?? 4320);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`LIVERDIAN_PORT invalide : ${process.env.LIVERDIAN_PORT}`);
  process.exit(1);
}

const hub = createHub({ dataDir, skillsDir: join(root, "skills"), claudeBinary: process.env.LIVERDIAN_CLAUDE_BIN });
const previewPort = Number(process.env.LIVERDIAN_PREVIEW_PORT ?? port + 1);
const app = await buildServer(hub, { port, previewPort, webDist: join(root, "apps", "web", "dist") });
const preview = await buildPreviewServer(hub, { port: previewPort });
const { recovered, fabrications } = hub.start();

try {
  // Écoute locale uniquement (ADR-02) : rien n'est joignable depuis le réseau.
  await app.listen({ host: "127.0.0.1", port });
  // Aperçus des sites : un sous-domaine local par site (<id>.localhost), pour que leurs chemins absolus marchent.
  await preview.listen({ host: "127.0.0.1", port: previewPort });
} catch (err) {
  const code = (err as { code?: string }).code;
  console.error(code === "EADDRINUSE" ? `Le port ${port} est déjà utilisé : Liverdian tourne peut-être déjà (ouvrez http://127.0.0.1:${port}).` : `Démarrage impossible : ${(err as Error).message}`);
  await hub.close();
  process.exit(1);
}

hub.events.append({ type: "hub.started", message: "Liverdian a démarré" });
console.log(`\n  Liverdian est prêt : http://127.0.0.1:${port}`);
console.log(`  Données : ${dataDir}`);
console.log(`  Aperçus des sites : http://<site>.localhost:${previewPort}`);
if (recovered) console.log(`  ${recovered} travail(aux) repris après l'arrêt précédent`);
if (fabrications) console.log(`  ${fabrications} fabrication(s) remise(s) en route`);
console.log(`  DeepSeek : ${hub.deepseek.configured ? "configuré" : "non configuré (facultatif)"}`);
console.log("  Ctrl+C pour arrêter.\n");

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("\n  Arrêt de Liverdian…");
  await app.close();
  await preview.close();
  await hub.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
