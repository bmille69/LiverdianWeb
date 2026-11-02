/**
 * Registre des polices auto-hébergées (paquets @fontsource). Seul le sous-ensemble « latin »
 * est chargé : il couvre tout le français (é, œ, «, espaces fines…).
 * Chaque police a une police de repli système ajustée (size-adjust, ascent/descent-override)
 * calculée depuis les métriques Capsize : pas de saut de mise en page au chargement.
 */
import type { Police } from "../schema.ts";

export type DefPolice = {
  /** Nom CSS de la famille déclarée dans @font-face. */
  famille: string;
  /** Paquet npm. */
  paquet: string;
  /** Fichiers woff2 (relatifs au paquet) et graisses couvertes. */
  fichiers: { fichier: string; poids: string }[];
  /** Nom de la police dans @capsizecss/metrics et police système de repli à ajuster. */
  metriques: string;
  base: "arial" | "georgia";
  /** Graisse des titres qui met la police en valeur. */
  poidsTitre: number;
  /** Approche des titres (letter-spacing). */
  approche: string;
};

export const UNICODE_LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

export const REPLI_SYSTEME = {
  arial: { local: "Arial", pile: "ui-sans-serif, system-ui, 'Segoe UI', Roboto, Arial, sans-serif" },
  georgia: { local: "Georgia", pile: "ui-serif, Georgia, 'Times New Roman', serif" },
} as const;

const variable = (nom: string) => [{ fichier: `files/${nom}-latin-wght-normal.woff2`, poids: "100 900" }];

export const POLICES_DEF: Record<Police, DefPolice> = {
  archivo: {
    famille: "Archivo Variable",
    paquet: "@fontsource-variable/archivo",
    fichiers: variable("archivo"),
    metriques: "archivo",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.02em",
  },
  "barlow-semi-condensed": {
    famille: "Barlow Semi Condensed",
    paquet: "@fontsource/barlow-semi-condensed",
    fichiers: [
      { fichier: "files/barlow-semi-condensed-latin-500-normal.woff2", poids: "500" },
      { fichier: "files/barlow-semi-condensed-latin-600-normal.woff2", poids: "600" },
      { fichier: "files/barlow-semi-condensed-latin-700-normal.woff2", poids: "700" },
    ],
    metriques: "barlowSemiCondensed",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.005em",
  },
  "bricolage-grotesque": {
    famille: "Bricolage Grotesque Variable",
    paquet: "@fontsource-variable/bricolage-grotesque",
    fichiers: variable("bricolage-grotesque"),
    metriques: "bricolageGrotesque",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.03em",
  },
  "dm-serif-display": {
    famille: "DM Serif Display",
    paquet: "@fontsource/dm-serif-display",
    fichiers: [{ fichier: "files/dm-serif-display-latin-400-normal.woff2", poids: "400" }],
    metriques: "dMSerifDisplay",
    base: "georgia",
    poidsTitre: 400,
    approche: "-0.01em",
  },
  fraunces: {
    famille: "Fraunces Variable",
    paquet: "@fontsource-variable/fraunces",
    fichiers: variable("fraunces"),
    metriques: "fraunces",
    base: "georgia",
    poidsTitre: 600,
    approche: "-0.02em",
  },
  inter: {
    famille: "Inter Variable",
    paquet: "@fontsource-variable/inter",
    fichiers: variable("inter"),
    metriques: "inter",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.025em",
  },
  manrope: {
    famille: "Manrope Variable",
    paquet: "@fontsource-variable/manrope",
    fichiers: variable("manrope"),
    metriques: "manrope",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.025em",
  },
  "plus-jakarta-sans": {
    famille: "Plus Jakarta Sans Variable",
    paquet: "@fontsource-variable/plus-jakarta-sans",
    fichiers: variable("plus-jakarta-sans"),
    metriques: "plusJakartaSans",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.025em",
  },
  "schibsted-grotesk": {
    famille: "Schibsted Grotesk Variable",
    paquet: "@fontsource-variable/schibsted-grotesk",
    fichiers: variable("schibsted-grotesk"),
    metriques: "schibstedGrotesk",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.03em",
  },
  "source-sans-3": {
    famille: "Source Sans 3 Variable",
    paquet: "@fontsource-variable/source-sans-3",
    fichiers: variable("source-sans-3"),
    metriques: "sourceSans3",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.01em",
  },
  "space-grotesk": {
    famille: "Space Grotesk Variable",
    paquet: "@fontsource-variable/space-grotesk",
    fichiers: variable("space-grotesk"),
    metriques: "spaceGrotesk",
    base: "arial",
    poidsTitre: 650,
    approche: "-0.03em",
  },
  "work-sans": {
    famille: "Work Sans Variable",
    paquet: "@fontsource-variable/work-sans",
    fichiers: variable("work-sans"),
    metriques: "workSans",
    base: "arial",
    poidsTitre: 650,
    approche: "-0.02em",
  },
};
