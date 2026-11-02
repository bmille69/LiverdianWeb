/**
 * Intégration Astro du kit :
 * 1. valide `src/data/site.json` avant tout build et échoue avec un message français lisible ;
 * 2. vérifie les contrastes du thème final (surcharges comprises) ;
 * 3. expose le module virtuel `virtual:liverdian/polices` : @font-face des deux polices du thème
 *    (+ repli système ajusté), et l'URL des fichiers à précharger. Seules ces polices sont émises.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AstroIntegration } from "astro";
import sitemap from "@astrojs/sitemap";
import { validerSite } from "./schema.ts";
import { resoudreTheme, verifierContrastes } from "./lib/theme.ts";
import { POLICES_DEF, REPLI_SYSTEME, UNICODE_LATIN } from "./lib/polices.ts";

const ID_VIRTUEL = "virtual:liverdian/polices";
const ID_RESOLU = "\0" + ID_VIRTUEL;

function echec(titre: string, lignes: string[]): never {
  const msg = [``, `✖ ${titre}`, ...lignes.map((l) => `  • ${l}`), ``].join("\n");
  console.error(msg);
  // Sortie propre : pas de pile d'appels, code 1 pour le hub.
  process.exit(1);
}

export function lireSite(racine: string) {
  const fichier = path.join(racine, "src", "data", "site.json");
  if (!fs.existsSync(fichier)) echec("site.json introuvable", [fichier]);
  let brut: unknown;
  try {
    brut = JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch (e) {
    echec("site.json n'est pas un JSON valide", [String((e as Error).message)]);
  }
  const r = validerSite(brut);
  if (!r.ok) echec("site.json invalide — corriger les champs suivants :", r.erreurs);
  return { fichier, site: r.site };
}

async function moduleTypo(racine: string): Promise<string> {
  const { site } = lireSite(racine);
  const theme = resoudreTheme(site.theme);
  const require = createRequire(path.join(racine, "package.json"));
  const imports: string[] = [];
  const faces: string[] = [];
  const precharges: string[] = [];
  const roles = [theme.polices.titres, theme.polices.corps].filter((p, i, a) => a.indexOf(p) === i);
  let n = 0;
  for (const id of roles) {
    const def = POLICES_DEF[id];
    for (const f of def.fichiers) {
      const v = `u${n++}`;
      imports.push(`import ${v} from ${JSON.stringify(`${def.paquet}/${f.fichier}?url`)};`);
      faces.push(
        `"@font-face{font-family:'${def.famille}';font-style:normal;font-display:swap;font-weight:${f.poids};src:url("+${v}+") format('woff2');unicode-range:${UNICODE_LATIN}}"`,
      );
      // Précharge le fichier des titres (graisse des titres) et le fichier variable du corps.
      const graisseTitre = f.poids.includes(" ") || f.poids === String(def.poidsTitre);
      if ((id === theme.polices.titres && graisseTitre) || (id === theme.polices.corps && def.fichiers.length === 1)) precharges.push(v);
    }
    // Repli ajusté : métriques Capsize de la police et de la police système.
    try {
      const metriques = (await import(pathToFileURL(require.resolve(`@capsizecss/metrics/${def.metriques}`)).href)).default;
      const sys = (await import(pathToFileURL(require.resolve(`@capsizecss/metrics/${def.base}`)).href)).default;
      const largeur = metriques.xWidthAvg / metriques.unitsPerEm / (sys.xWidthAvg / sys.unitsPerEm);
      const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
      faces.push(
        JSON.stringify(
          `@font-face{font-family:'${def.famille} repli';src:local('${REPLI_SYSTEME[def.base].local}');size-adjust:${pct(largeur)};` +
            `ascent-override:${pct(metriques.ascent / metriques.unitsPerEm / largeur)};` +
            `descent-override:${pct(Math.abs(metriques.descent) / metriques.unitsPerEm / largeur)};` +
            `line-gap-override:${pct(metriques.lineGap / metriques.unitsPerEm / largeur)}}`,
        ),
      );
    } catch {
      // Métriques absentes : pas de repli ajusté, la pile système suffit.
    }
  }
  return `${imports.join("\n")}\nexport const css = [${faces.join(",")}].join("");\nexport const precharges = [${precharges.join(",")}];\n`;
}

export default function liverdian(): AstroIntegration {
  return {
    name: "liverdian-site-kit",
    hooks: {
      "astro:config:setup": ({ config, updateConfig, addWatchFile }) => {
        const racine = fileURLToPath(config.root);
        const { fichier, site } = lireSite(racine);
        addWatchFile(fichier);
        const erreurs = verifierContrastes(resoudreTheme(site.theme).couleurs);
        if (erreurs.length) echec("Thème refusé : contrastes insuffisants (WCAG AA)", erreurs);
        updateConfig({
          // Le sitemap n'a de sens qu'avec une URL publique connue.
          ...(site.seo.url ? { site: site.seo.url, integrations: [sitemap()] } : {}),
          vite: {
            plugins: [
              {
                name: "liverdian-polices",
                resolveId(id: string) {
                  return id === ID_VIRTUEL ? ID_RESOLU : undefined;
                },
                load(id: string) {
                  return id === ID_RESOLU ? moduleTypo(racine) : undefined;
                },
              },
            ],
          },
        });
      },
    },
  };
}
