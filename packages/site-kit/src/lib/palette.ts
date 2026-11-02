/**
 * Palettes générées par site. Le Directeur artistique donne des intentions (teinte des neutres, teinte de l'accent,
 * vivacité, ton de l'accent, fond, sombre) ; le code calcule les 14 jetons dans l'espace OKLCH (perceptuellement
 * régulier) et ajuste la luminosité de chaque couleur de texte jusqu'à atteindre les contrastes WCAG exigés par le kit.
 * Résultat : une infinité de palettes crédibles, toutes AA par construction (le kit les revérifie quand même).
 *
 * Aucun import d'exécution : ce fichier est lu tel quel par Node (hub) et par Astro.
 */
import type { Couleurs, Palette } from "../schema.ts";

type Oklch = { l: number; c: number; h: number };

// ─── Conversions ─────────────────────────────────────────────────────────────

const versLineaire = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const versGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklchVersRgbLineaire({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const dansGamut = (rgb: number[]) => rgb.every((v) => v >= -0.0001 && v <= 1.0001);

/** OKLCH → #RRGGBB, en réduisant la chroma jusqu'à rentrer dans le gamut sRGB (la teinte et la luminosité restent). */
export function oklchVersHex(o: Oklch): string {
  let c = Math.max(0, o.c);
  let rgb = oklchVersRgbLineaire({ ...o, c });
  while (!dansGamut(rgb) && c > 0) {
    c = Math.max(0, c - 0.002);
    rgb = oklchVersRgbLineaire({ ...o, c });
  }
  return (
    "#" +
    rgb
      .map((v) => Math.round(Math.min(1, Math.max(0, versGamma(Math.min(1, Math.max(0, v))))) * 255))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

/** #RRGGBB → OKLCH (teinte en degrés). Sert aussi au registre d'unicité du hub (écart de teinte entre sites). */
export function hexVersOklch(hex: string): Oklch {
  const [r, g, b] = [1, 3, 5].map((i) => versLineaire(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.sqrt(A * A + B * B), h: h < 0 ? h + 360 : h };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => versLineaire(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrasteHex(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * Déplace la luminosité d'une couleur (vers le sombre ou le clair) jusqu'à atteindre le contraste voulu avec
 * chacun des fonds donnés. Rend la couleur trouvée (ou la plus extrême si impossible : le kit refusera alors).
 */
function ajuster(o: Oklch, fonds: string[], min: number, sens: "fonce" | "clair"): string {
  let l = o.l;
  for (let i = 0; i < 200; i++) {
    const hex = oklchVersHex({ ...o, l });
    if (fonds.every((f) => contrasteHex(hex, f) >= min)) return hex;
    l += sens === "fonce" ? -0.005 : 0.005;
    if (l <= 0.02 || l >= 0.995) break;
  }
  return oklchVersHex({ ...o, l: Math.min(0.995, Math.max(0.02, l)) });
}

// ─── Génération ──────────────────────────────────────────────────────────────

const CHROMA_ACCENT = { sourde: 0.085, franche: 0.135, vive: 0.185 } as const;
const CHROMA_NEUTRES = { gris: 0.004, teintes: 0.009, colores: 0.018 } as const;
/** Marges au-dessus des seuils du kit : l'arrondi en #RRGGBB ne doit jamais faire passer sous le seuil. */
const AA = 4.65;
const AAA = 7.15;

/** Luminosité d'un accent « clair » selon sa teinte : les jaunes supportent d'être très clairs, les bleus moins. */
function lumAccentClair(h: number): number {
  const jaune = Math.max(0, Math.cos(((h - 95) * Math.PI) / 180));
  return 0.74 + 0.12 * jaune;
}

export function genererPalette(p: Palette): Couleurs {
  const hn = p.teinte;
  const ha = p.accent;
  const cn = CHROMA_NEUTRES[p.neutres ?? "teintes"];
  const ca = CHROMA_ACCENT[p.vivacite ?? "franche"];
  const ton = p.accentTon ?? "clair";

  const lFond = { blanc: 0.988, casse: 0.97, teinte: 0.956 }[p.fond ?? "casse"];
  const fond = oklchVersHex({ l: lFond, c: cn * (p.fond === "blanc" ? 0.3 : p.fond === "teinte" ? 1.5 : 0.9), h: hn });
  const surface = oklchVersHex({ l: Math.min(0.997, lFond + 0.025), c: cn * 0.3, h: hn });
  const teinte = oklchVersHex({ l: lFond - 0.045, c: Math.min(cn * 1.9, 0.05), h: hn });
  const trait = oklchVersHex({ l: lFond - 0.115, c: Math.min(cn * 1.6, 0.045), h: hn });
  const clairs = [fond, surface, teinte];

  const encre = ajuster({ l: 0.22, c: Math.min(cn * 2.2, 0.045), h: hn }, clairs, AAA, "fonce");
  const encreDouce = ajuster({ l: 0.5, c: Math.min(cn * 1.8, 0.04), h: hn }, clairs, AA, "fonce");

  const sombreDef = {
    nuit: { l: 0.19, c: Math.max(cn * 1.3, 0.012) },
    profond: { l: 0.235, c: Math.max(cn * 2.4, 0.035) },
    colore: { l: 0.285, c: 0.075 },
  }[p.sombre ?? "profond"];
  const sombre = oklchVersHex({ ...sombreDef, h: hn });
  const sombreSurface = oklchVersHex({ l: sombreDef.l + 0.065, c: sombreDef.c, h: hn });
  const surSombre = ajuster({ l: 0.965, c: cn * 0.5, h: hn }, [sombre], AAA, "clair");
  const surSombreDoux = ajuster({ l: 0.8, c: Math.min(cn * 1.4, 0.03), h: hn }, [sombre, sombreSurface], AA, "clair");

  let accent: string;
  let surAccent: string;
  if (ton === "clair") {
    surAccent = encre;
    accent = ajuster({ l: lumAccentClair(ha), c: ca, h: ha }, [surAccent], AA, "clair");
  } else {
    surAccent = oklchVersHex({ l: 0.992, c: 0.004, h: hn });
    accent = ajuster({ l: 0.55, c: ca, h: ha }, [surAccent], AA, "fonce");
  }
  const accentTexte = ajuster({ l: 0.52, c: Math.min(ca, 0.16), h: ha }, clairs, AA, "fonce");
  const accentSurSombre = ajuster({ l: 0.8, c: ca, h: ha }, [sombre, sombreSurface], AA, "clair");

  return { fond, surface, teinte, encre, encreDouce, trait, sombre, sombreSurface, surSombre, surSombreDoux, accent, surAccent, accentTexte, accentSurSombre };
}
