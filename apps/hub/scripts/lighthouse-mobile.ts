/**
 * Lighthouse mobile léger sur une page (une mesure, performance + accessibilité), avec Microsoft Edge sans fenêtre.
 *   node apps/hub/scripts/lighthouse-mobile.ts <url> <dossier du kit>
 * Lighthouse et chrome-launcher sont ceux déjà installés par le kit des sites (lus, jamais modifiés).
 * Écrit une ligne JSON sur la sortie : { performance, accessibilite, lcpMs } ou { erreur }.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [url, kitDir] = process.argv.slice(2);
const EDGE = process.env.LIVERDIAN_EDGE ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

async function main() {
  if (!url || !/^https?:\/\//.test(url) || !kitDir) throw new Error("usage : lighthouse-mobile.ts <url> <dossier du kit>");
  const require = createRequire(join(kitDir, "package.json"));
  const lighthouse = (await import(pathToFileURL(require.resolve("lighthouse")).href)).default;
  const chromeLauncher = await import(pathToFileURL(require.resolve("chrome-launcher")).href);
  const chrome = await chromeLauncher.launch({ chromePath: EDGE, chromeFlags: ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"] });
  try {
    const r = await lighthouse(url, { port: chrome.port, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility"], maxWaitForLoad: 30_000 });
    const lhr = r?.lhr;
    if (!lhr) throw new Error("Lighthouse n'a rien rendu");
    if (lhr.runtimeError) throw new Error(lhr.runtimeError.message ?? lhr.runtimeError.code);
    const s = (k: string) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
    const lcp = lhr.audits["largest-contentful-paint"]?.numericValue;
    process.stdout.write(JSON.stringify({ performance: s("performance"), accessibilite: s("accessibility"), lcpMs: typeof lcp === "number" ? Math.round(lcp) : null }) + "\n");
  } finally {
    await chrome.kill();
  }
}

main().catch((err: Error) => {
  process.stdout.write(JSON.stringify({ erreur: err.message.slice(0, 300) }) + "\n");
  process.exit(0);
});
