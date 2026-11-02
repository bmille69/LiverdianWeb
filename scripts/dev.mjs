// Développement : le hub (rechargé à chaque modification) et l'interface Vite (rechargement à chaud) ensemble.
// Ouvrir http://127.0.0.1:5173 ; Vite relaie /api et /files vers le hub.
import { spawn } from "node:child_process";

const opts = { stdio: "inherit", shell: process.platform === "win32" };
const hub = spawn("node", ["--watch", "apps/hub/src/main.ts"], opts);
const web = spawn("npm", ["run", "dev", "-w", "@liverdian/web"], opts);
const stop = () => {
  hub.kill();
  web.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
hub.on("exit", stop);
web.on("exit", stop);
