/**
 * Registre des polices auto-hébergées (paquets @fontsource). Seul le sous-ensemble « latin »
 * est chargé : il couvre tout le français (é, œ, «, espaces fines…).
 * Chaque police a une police de repli système ajustée (size-adjust, ascent/descent-override)
 * calculée depuis les métriques Capsize : pas de saut de mise en page au chargement.
 */
import type { PairePolices, Police } from "../schema.ts";

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
  bitter: {
    famille: "Bitter Variable",
    paquet: "@fontsource-variable/bitter",
    fichiers: variable("bitter"),
    metriques: "bitter",
    base: "georgia",
    poidsTitre: 700,
    approche: "-0.015em",
  },
  "dm-sans": {
    famille: "DM Sans Variable",
    paquet: "@fontsource-variable/dm-sans",
    fichiers: variable("dm-sans"),
    metriques: "dMSans",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.03em",
  },
  figtree: {
    famille: "Figtree Variable",
    paquet: "@fontsource-variable/figtree",
    fichiers: variable("figtree"),
    metriques: "figtree",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.02em",
  },
  "hanken-grotesk": {
    famille: "Hanken Grotesk Variable",
    paquet: "@fontsource-variable/hanken-grotesk",
    fichiers: variable("hanken-grotesk"),
    metriques: "hankenGrotesk",
    base: "arial",
    poidsTitre: 700,
    approche: "-0.025em",
  },
  "instrument-sans": {
    famille: "Instrument Sans Variable",
    paquet: "@fontsource-variable/instrument-sans",
    fichiers: variable("instrument-sans"),
    metriques: "instrumentSans",
    base: "arial",
    poidsTitre: 650,
    approche: "-0.02em",
  },
  "instrument-serif": {
    famille: "Instrument Serif",
    paquet: "@fontsource/instrument-serif",
    fichiers: [{ fichier: "files/instrument-serif-latin-400-normal.woff2", poids: "400" }],
    metriques: "instrumentSerif",
    base: "georgia",
    poidsTitre: 400,
    approche: "-0.01em",
  },
  "libre-franklin": {
    famille: "Libre Franklin Variable",
    paquet: "@fontsource-variable/libre-franklin",
    fichiers: variable("libre-franklin"),
    metriques: "libreFranklin",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.025em",
  },
  literata: {
    famille: "Literata Variable",
    paquet: "@fontsource-variable/literata",
    fichiers: variable("literata"),
    metriques: "literata",
    base: "georgia",
    poidsTitre: 650,
    approche: "-0.015em",
  },
  newsreader: {
    famille: "Newsreader Variable",
    paquet: "@fontsource-variable/newsreader",
    fichiers: variable("newsreader"),
    metriques: "newsreader",
    base: "georgia",
    poidsTitre: 600,
    approche: "-0.02em",
  },
  oswald: {
    famille: "Oswald Variable",
    paquet: "@fontsource-variable/oswald",
    fichiers: variable("oswald"),
    metriques: "oswald",
    base: "arial",
    poidsTitre: 600,
    approche: "0em",
  },
  "public-sans": {
    famille: "Public Sans Variable",
    paquet: "@fontsource-variable/public-sans",
    fichiers: variable("public-sans"),
    metriques: "publicSans",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.025em",
  },
  "red-hat-display": {
    famille: "Red Hat Display Variable",
    paquet: "@fontsource-variable/red-hat-display",
    fichiers: variable("red-hat-display"),
    metriques: "redHatDisplay",
    base: "arial",
    poidsTitre: 750,
    approche: "-0.02em",
  },
  "roboto-slab": {
    famille: "Roboto Slab Variable",
    paquet: "@fontsource-variable/roboto-slab",
    fichiers: variable("roboto-slab"),
    metriques: "robotoSlab",
    base: "georgia",
    poidsTitre: 650,
    approche: "-0.02em",
  },
  sora: {
    famille: "Sora Variable",
    paquet: "@fontsource-variable/sora",
    fichiers: variable("sora"),
    metriques: "sora",
    base: "arial",
    poidsTitre: 650,
    approche: "-0.035em",
  },
  "young-serif": {
    famille: "Young Serif",
    paquet: "@fontsource/young-serif",
    fichiers: [{ fichier: "files/young-serif-latin-400-normal.woff2", poids: "400" }],
    metriques: "youngSerif",
    base: "georgia",
    poidsTitre: 400,
    approche: "-0.015em",
  },
};

export type CaracterePolices = "technique" | "net" | "robuste" | "editorial" | "chaleureux" | "patrimoine" | "contemporain";

export type DefPaire = {
  titres: Police;
  corps: Police;
  caractere: CaracterePolices;
  /** Ce que la paire raconte, pour le Directeur artistique. */
  description: string;
  /** Métiers auxquels elle convient le mieux (indicatif, jamais une obligation). */
  metiers: string[];
};

/**
 * Paires de polices auto-hébergées, classées par caractère. Le Directeur artistique choisit une paire
 * (`theme.polices.paire`) ; deux sites du même métier n'ont jamais la même paire (contrôle d'unicité du hub).
 */
export const PAIRES_DEF: Record<PairePolices, DefPaire> = {
  "atelier-technique": { titres: "archivo", corps: "inter", caractere: "technique", description: "Grotesque large et précise, corps neutre : plan, mesure, sécurité.", metiers: ["electricien", "chauffagiste"] },
  "plan-de-coupe": { titres: "space-grotesk", corps: "source-sans-3", caractere: "technique", description: "Grotesque à détails mécaniques, corps humaniste lisible : ingénieux sans froideur.", metiers: ["electricien", "plombier"] },
  "chantier-net": { titres: "public-sans", corps: "public-sans", caractere: "net", description: "Une seule famille, administrative et franche : sérieux, sans effet.", metiers: ["electricien", "plombier", "chauffagiste"] },
  "grotesque-franche": { titres: "schibsted-grotesk", corps: "inter", caractere: "net", description: "Grotesque de presse serrée : direct, contemporain.", metiers: ["peintre", "electricien"] },
  "geometrie-douce": { titres: "manrope", corps: "dm-sans", caractere: "contemporain", description: "Géométrique arrondie, corps géométrique léger : moderne, accueillant.", metiers: ["chauffagiste", "plombier"] },
  "contemporain-clair": { titres: "sora", corps: "figtree", caractere: "contemporain", description: "Géométrique large et aérée : jeune entreprise, technologie (domotique, pompe à chaleur).", metiers: ["electricien", "chauffagiste"] },
  "industriel-condense": { titres: "barlow-semi-condensed", corps: "plus-jakarta-sans", caractere: "robuste", description: "Condensée d'atelier, corps rond : signalétique de chantier, efficace.", metiers: ["electricien", "couvreur", "plombier"] },
  "affiche-robuste": { titres: "oswald", corps: "work-sans", caractere: "robuste", description: "Condensée d'affiche, superbe en capitales : force, urgence, dépannage.", metiers: ["plombier", "couvreur", "electricien"] },
  signaletique: { titres: "red-hat-display", corps: "hanken-grotesk", caractere: "net", description: "Grotesque de signalétique, chiffres nets : clair, organisé.", metiers: ["electricien", "chauffagiste", "plombier"] },
  "editorial-serif": { titres: "newsreader", corps: "instrument-sans", caractere: "editorial", description: "Serif de journal fine, corps grotesque : posé, expert, haut de gamme.", metiers: ["menuisier", "peintre", "electricien"] },
  "maison-de-famille": { titres: "young-serif", corps: "figtree", caractere: "chaleureux", description: "Serif ronde et généreuse : entreprise familiale, proximité.", metiers: ["menuisier", "chauffagiste", "plombier"] },
  "gazette-locale": { titres: "literata", corps: "libre-franklin", caractere: "editorial", description: "Serif de livre, corps franklin : enraciné, sérieux, local.", metiers: ["couvreur", "menuisier", "chauffagiste"] },
  "artisan-d-art": { titres: "fraunces", corps: "work-sans", caractere: "patrimoine", description: "Serif à caractère, douce et contrastée : savoir-faire, matière.", metiers: ["couvreur", "menuisier"] },
  "bois-et-papier": { titres: "dm-serif-display", corps: "dm-sans", caractere: "chaleureux", description: "Didone généreuse et corps géométrique : élégant, chaleureux.", metiers: ["menuisier", "peintre"] },
  "elegance-sobre": { titres: "instrument-serif", corps: "inter", caractere: "editorial", description: "Serif condensée élégante en grands corps : finitions, décoration.", metiers: ["peintre", "menuisier"] },
  patrimoine: { titres: "fraunces", corps: "source-sans-3", caractere: "patrimoine", description: "Serif ancienne chaleureuse : bâti ancien, pierre, restauration.", metiers: ["couvreur", "menuisier"] },
  "slab-robuste": { titres: "roboto-slab", corps: "inter", caractere: "robuste", description: "Égyptienne solide : fiable, mécanique, durable.", metiers: ["plombier", "chauffagiste", "couvreur"] },
  "slab-editorial": { titres: "bitter", corps: "hanken-grotesk", caractere: "chaleureux", description: "Égyptienne d'écran douce : pédagogue, rassurant.", metiers: ["chauffagiste", "plombier", "electricien"] },
  "rondeur-accueillante": { titres: "plus-jakarta-sans", corps: "figtree", caractere: "contemporain", description: "Grotesques rondes et ouvertes : service, disponibilité.", metiers: ["plombier", "electricien"] },
  "precision-suisse": { titres: "instrument-sans", corps: "public-sans", caractere: "net", description: "Grotesque suisse serrée : rigueur, propreté du travail.", metiers: ["electricien", "peintre"] },
  "caractere-fort": { titres: "bricolage-grotesque", corps: "source-sans-3", caractere: "chaleureux", description: "Grotesque à forte personnalité : artisan qui a du caractère.", metiers: ["plombier", "peintre"] },
  "classique-moderne": { titres: "literata", corps: "dm-sans", caractere: "patrimoine", description: "Serif de texte en titres, corps géométrique : classique sans être daté.", metiers: ["couvreur", "menuisier", "peintre"] },
};
