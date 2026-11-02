#!/usr/bin/env node
/**
 * Contrôle automatique d'un site généré par le kit.
 *
 *   node scripts/check-site.mjs <dossier-site> [--sans-build] [--runs <n>]
 *
 * Étapes : build (`astro build`) → service local du dist (compressé, comme en production) →
 * Lighthouse mobile (Edge) → axe-core (375 et 1440 px) → captures pleine page 375 / 768 / 1440 + écran initial
 * mobile → contrôles (défilement horizontal, images cassées, textes interdits, liens internes, bandeau + noindex
 * en démo, bouton d'appel visible sans défiler, un seul H1, poids de page).
 *
 * Sorties dans <dossier-site>/.check/ :
 *   check-report.json            rapport (format documenté dans README.md, champ "version")
 *   capture-375.png, capture-768.png, capture-1440.png, capture-375-initial.png
 * Code de sortie : 0 = tout passe, 1 = au moins un contrôle bloquant échoue, 2 = erreur technique.
 * La dernière ligne de stdout est un résumé JSON { ok, rapport, echecs }.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(KIT, "package.json"));
const EDGE = process.env.CHROME_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SEUIL = 95;
const POIDS_MAX = 1024 * 1024;
const LARGEURS = [375, 768, 1440];
const ECRAN_INITIAL = { width: 375, height: 667 };

// ─── Arguments ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let dossier;
let build = true;
let runs = 1;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--sans-build") build = false;
  else if (args[i] === "--runs") runs = Math.max(1, Number(args[++i]) || 1);
  else dossier = args[i];
}
if (!dossier) {
  console.error("Usage : node scripts/check-site.mjs <dossier-site> [--sans-build] [--runs <n>]");
  process.exit(2);
}
dossier = path.resolve(dossier);
const sortie = path.join(dossier, ".check");
fs.rmSync(sortie, { recursive: true, force: true });
fs.mkdirSync(sortie, { recursive: true });

const rapport = {
  version: 1,
  site: dossier,
  date: new Date().toISOString(),
  ok: false,
  demo: null,
  seuils: { lighthouse: SEUIL, poidsMaxOctets: POIDS_MAX },
  build: { ok: false, dureeMs: 0 },
  lighthouse: null,
  axe: null,
  controles: [],
  captures: {},
  echecs: [],
};
const ecrire = () => fs.writeFileSync(path.join(sortie, "check-report.json"), JSON.stringify(rapport, null, 2) + "\n");
const controle = (id, ok, detail, bloquant = true) => {
  rapport.controles.push({ id, ok, bloquant, detail });
  if (!ok && bloquant) rapport.echecs.push(`${id} : ${detail}`);
};
function terminer(code) {
  rapport.ok = code === 0 && rapport.echecs.length === 0;
  ecrire();
  console.log(JSON.stringify({ ok: rapport.ok, rapport: path.join(sortie, "check-report.json"), echecs: rapport.echecs }));
  process.exit(code === 2 ? 2 : rapport.ok ? 0 : 1);
}
process.on("uncaughtException", (e) => {
  rapport.echecs.push(`erreur technique : ${e.message}`);
  console.error(e);
  terminer(2);
});

// ─── 1. Build ────────────────────────────────────────────────────────────────
const siteJson = path.join(dossier, "src", "data", "site.json");
if (!fs.existsSync(siteJson)) {
  rapport.echecs.push(`pas de src/data/site.json dans ${dossier}`);
  terminer(2);
}
const site = JSON.parse(fs.readFileSync(siteJson, "utf8"));
rapport.demo = !!site.demo?.actif;

if (build) {
  const t0 = Date.now();
  const astro = path.join(dossier, "node_modules", "astro", "bin", "astro.mjs");
  const r = spawnSync(process.execPath, [astro, "build"], { cwd: dossier, encoding: "utf8", env: { ...process.env, FORCE_COLOR: "0" } });
  rapport.build.dureeMs = Date.now() - t0;
  const journal = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(sortie, "build.log"), journal);
  const avertissements = journal.split("\n").filter((l) => /\[WARN\]|warning/i.test(l));
  rapport.build.avertissements = avertissements.slice(0, 20);
  if (r.status !== 0) {
    rapport.build.erreur = journal.split("\n").filter((l) => /✖|•|error/i.test(l)).slice(0, 30).join("\n") || journal.slice(-2000);
    rapport.echecs.push("build : échec (voir .check/build.log)");
    terminer(1);
  }
  rapport.build.ok = true;
  controle("build-sans-avertissement", avertissements.length === 0, avertissements.length ? avertissements.join(" | ") : "aucun avertissement", false);
} else {
  rapport.build = { ok: true, dureeMs: 0, ignore: true };
}
const dist = path.join(dossier, "dist");
if (!fs.existsSync(path.join(dist, "index.html"))) {
  rapport.echecs.push("dist/index.html absent");
  terminer(1);
}

// ─── 2. Serveur local (gzip, cache long sur /_astro comme Cloudflare) ────────
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".json": "application/json",
};
const serveur = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  let f = path.join(dist, p);
  if (!f.startsWith(dist)) return res.writeHead(403).end();
  if (!fs.existsSync(f) && fs.existsSync(path.join(f, "index.html"))) f = path.join(f, "index.html");
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404, { "Content-Type": "text/plain" }).end("404");
  const ext = path.extname(f).toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  const entetes = {
    "Content-Type": type,
    "Cache-Control": p.startsWith("/_astro/") ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  };
  let corps = fs.readFileSync(f);
  if (/text|javascript|svg|json|xml/.test(type) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
    corps = zlib.gzipSync(corps);
    entetes["Content-Encoding"] = "gzip";
  }
  res.writeHead(200, entetes).end(corps);
});
await new Promise((ok) => serveur.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${serveur.address().port}`;

// ─── 3. Contrôles statiques sur tous les HTML ────────────────────────────────
const pagesHtml = [];
(function parcourir(d) {
  for (const n of fs.readdirSync(d)) {
    const f = path.join(d, n);
    if (fs.statSync(f).isDirectory()) parcourir(f);
    else if (n.endsWith(".html")) pagesHtml.push(f);
  }
})(dist);
const texteDe = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ");
const interdits = [/\[À COMPLÉTER/i, /\bundefined\b/, /\blorem\b/i, /\bNaN\b/, /\[object Object\]/];
const idsParPage = new Map();
const liensInternes = [];
for (const f of pagesHtml) {
  const rel = "/" + path.relative(dist, f).replace(/\\/g, "/").replace(/index\.html$/, "");
  const html = fs.readFileSync(f, "utf8");
  const texte = texteDe(html);
  const trouves = interdits.filter((re) => re.test(texte)).map((re) => texte.match(re)?.[0]);
  controle(`texte-interdit ${rel}`, trouves.length === 0, trouves.length ? `trouvé : ${trouves.join(", ")}` : "aucun");
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  controle(`h1-unique ${rel}`, h1 === 1, `${h1} H1`);
  controle(`lang-fr ${rel}`, /<html[^>]*lang="fr"/.test(html), "attribut lang");
  idsParPage.set(rel, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) liensInternes.push({ page: rel, href: m[1] });
  if (rapport.demo) {
    controle(`demo-bandeau ${rel}`, html.includes("data-bandeau-demo") && /Maquette réalisée par/.test(texte), "bandeau maquette présent");
    controle(`demo-noindex ${rel}`, /<meta name="robots" content="noindex, nofollow"/.test(html), "meta robots noindex");
  }
}
const cassés = [];
for (const { page, href } of liensInternes) {
  if (/^(https?:|tel:|mailto:)/.test(href)) continue;
  const [chemin, ancre] = href.split("#");
  const cibleRel = chemin === "" ? page : chemin.endsWith("/") ? chemin : chemin + "/";
  const existe = chemin === "" || fs.existsSync(path.join(dist, chemin)) || fs.existsSync(path.join(dist, cibleRel, "index.html"));
  if (!existe) cassés.push(`${page} → ${href}`);
  else if (ancre && !idsParPage.get(cibleRel)?.has(ancre)) cassés.push(`${page} → ${href} (ancre absente)`);
}
controle("liens-internes", cassés.length === 0, cassés.length ? cassés.slice(0, 10).join(" ; ") : `${liensInternes.length} liens vérifiés`);
const robots = fs.existsSync(path.join(dist, "robots.txt")) ? fs.readFileSync(path.join(dist, "robots.txt"), "utf8") : "";
if (rapport.demo) controle("demo-robots", /Disallow:\s*\/\s*$/m.test(robots), "robots.txt Disallow: /");
const indexHtml = fs.readFileSync(path.join(dist, "index.html"), "utf8");
if (!rapport.demo) {
  controle("formulaire-destination", !indexHtml.includes("data-sans-action"), "formulaire.action renseigné dans site.json");
}
controle("json-ld", /<script type="application\/ld\+json">/.test(indexHtml), "données structurées LocalBusiness");

// ─── 4. Lighthouse mobile ────────────────────────────────────────────────────
const lighthouse = (await import(pathToFileURL(require.resolve("lighthouse")).href)).default;
const chromeLauncher = await import(pathToFileURL(require.resolve("chrome-launcher")).href);
const mesures = [];
for (let i = 0; i < runs; i++) {
  const chrome = await chromeLauncher.launch({
    chromePath: EDGE,
    chromeFlags: ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
  });
  try {
    const r = await lighthouse(base + "/", {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const lhr = r.lhr;
    if (i === runs - 1) fs.writeFileSync(path.join(sortie, "lighthouse.json"), JSON.stringify(lhr));
    const s = (k) => Math.round((lhr.categories[k]?.score ?? 0) * 100);
    const a = (k) => lhr.audits[k]?.numericValue;
    const rates = (cat) =>
      lhr.categories[cat].auditRefs
        .filter((ref) => ref.weight > 0 && (lhr.audits[ref.id]?.score ?? 1) < 0.9)
        .map((ref) => ({ id: ref.id, titre: lhr.audits[ref.id].title, score: lhr.audits[ref.id].score }));
    mesures.push({
      performance: s("performance"),
      accessibilite: s("accessibility"),
      bonnesPratiques: s("best-practices"),
      seo: s("seo"),
      metriques: {
        fcpMs: Math.round(a("first-contentful-paint")),
        lcpMs: Math.round(a("largest-contentful-paint")),
        tbtMs: Math.round(a("total-blocking-time")),
        cls: Number((a("cumulative-layout-shift") ?? 0).toFixed(3)),
        speedIndexMs: Math.round(a("speed-index")),
        poidsOctets: Math.round(a("total-byte-weight")),
      },
      auditsRates: {
        performance: rates("performance"),
        accessibilite: rates("accessibility"),
        bonnesPratiques: rates("best-practices"),
        seo: rates("seo"),
      },
    });
  } finally {
    await chrome.kill();
  }
}
// Médiane sur la performance (la plus variable) ; les autres catégories sont stables.
mesures.sort((x, y) => x.performance - y.performance);
const lh = mesures[Math.floor(mesures.length / 2)];
lh.runs = runs;
if (runs > 1) lh.performancesMesurees = mesures.map((m) => m.performance);
rapport.lighthouse = lh;
controle("lighthouse-performance", lh.performance >= SEUIL, `${lh.performance}/100`);
controle("lighthouse-accessibilite", lh.accessibilite >= SEUIL, `${lh.accessibilite}/100`);
controle("lighthouse-bonnes-pratiques", lh.bonnesPratiques >= SEUIL, `${lh.bonnesPratiques}/100`);
if (rapport.demo) {
  // En démo, le noindex pénalise volontairement la catégorie SEO : noté à part, hors seuil.
  const horsNoindex = lh.auditsRates.seo.filter((a) => a.id !== "is-crawlable");
  lh.seoNote = "démo : la catégorie SEO est pénalisée par noindex (attendu), non comptée dans le seuil";
  controle("lighthouse-seo-hors-noindex", horsNoindex.length === 0, horsNoindex.length ? horsNoindex.map((a) => a.id).join(", ") : "seul is-crawlable échoue (noindex)");
} else {
  controle("lighthouse-seo", lh.seo >= SEUIL, `${lh.seo}/100`);
}
controle("poids-page", lh.metriques.poidsOctets <= POIDS_MAX, `${Math.round(lh.metriques.poidsOctets / 1024)} Ko`);
controle("cls", lh.metriques.cls <= 0.05, `CLS ${lh.metriques.cls}`);

// ─── 5. Navigateur : axe, captures, contrôles visuels ────────────────────────
const pw = await import(pathToFileURL(require.resolve("playwright-core")).href);
const chromium = pw.chromium ?? pw.default.chromium;
const navigateur = await chromium.launch({ executablePath: EDGE, headless: true, timeout: 60000 });
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const violations = new Map();

async function preparer(page) {
  await page.goto(base + "/", { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  // Fait défiler pour charger les images paresseuses, puis revient en haut.
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = "auto";
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.8) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  // Attend les images encore en cours (8 s maximum : une image jamais chargée sera signalée comme cassée).
  await page.evaluate(() =>
    Promise.race([
      Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => i.addEventListener("load", r) || i.addEventListener("error", r))))),
      new Promise((r) => setTimeout(r, 8000)),
    ]),
  );
}

try {
  for (const largeur of LARGEURS) {
    const ctx = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 768 ? 812 : 900 }, deviceScaleFactor: 1, locale: "fr-FR" });
    const page = await ctx.newPage();
    await preparer(page);
    const etat = await page.evaluate(() => ({
      debordement: document.documentElement.scrollWidth - window.innerWidth,
      cassees: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.currentSrc || i.src),
    }));
    controle(`defilement-horizontal ${largeur}px`, etat.debordement <= 1, etat.debordement > 1 ? `déborde de ${etat.debordement} px` : "aucun");
    controle(`images-cassees ${largeur}px`, etat.cassees.length === 0, etat.cassees.length ? etat.cassees.join(", ") : "aucune");
    if (largeur === 375 || largeur === 1440) {
      await page.addScriptTag({ content: axeSource });
      const res = await page.evaluate(() =>
        window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } }),
      );
      for (const v of res.violations) {
        const prec = violations.get(v.id);
        violations.set(v.id, {
          id: v.id,
          impact: v.impact,
          aide: v.help,
          url: v.helpUrl,
          noeuds: (prec?.noeuds ?? 0) + v.nodes.length,
          exemples: [...(prec?.exemples ?? []), ...v.nodes.slice(0, 3).map((n) => `${largeur}px ${n.target.join(" ")}`)].slice(0, 5),
        });
      }
    }
    const fichier = `capture-${largeur}.png`;
    await page.screenshot({ path: path.join(sortie, fichier), fullPage: true });
    rapport.captures[String(largeur)] = fichier;
    await ctx.close();
  }

  // Écran initial mobile : le téléphone / bouton Appeler doit être visible sans défiler.
  const ctx = await navigateur.newContext({ viewport: ECRAN_INITIAL, deviceScaleFactor: 2, locale: "fr-FR", isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const appelVisible = await page.evaluate((h) => {
    return [...document.querySelectorAll('a[href^="tel:"]')].some((a) => {
      const r = a.getBoundingClientRect();
      const s = getComputedStyle(a);
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= h && s.visibility !== "hidden" && s.display !== "none";
    });
  }, ECRAN_INITIAL.height);
  controle("appel-visible-ecran-initial", appelVisible, appelVisible ? "lien tel: visible sans défiler (375×667)" : "aucun lien tel: visible sans défiler");
  if (rapport.demo) {
    const bandeau = await page.evaluate(() => {
      const b = document.querySelector("[data-bandeau-demo]");
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.height > 0 && r.top >= 0 && r.top < 10;
    });
    controle("demo-bandeau-visible", bandeau, bandeau ? "bandeau en haut de l'écran initial" : "bandeau absent de l'écran initial");
  }
  await page.screenshot({ path: path.join(sortie, "capture-375-initial.png") });
  rapport.captures.initial = "capture-375-initial.png";
  await ctx.close();
} finally {
  await navigateur.close();
  serveur.close();
}

const liste = [...violations.values()];
const graves = liste.filter((v) => v.impact === "serious" || v.impact === "critical");
rapport.axe = { violations: liste, graves: graves.length };
controle("axe-graves", graves.length === 0, graves.length ? graves.map((v) => `${v.id} (${v.noeuds})`).join(", ") : `0 grave, ${liste.length} mineure(s)`);

terminer(0);
