import { ENTETES, MISE, PAIRES_POLICES, PALETTE, PIEDS, SIGNATURES, VARIANTES } from "./schemas.ts";
import { oklab, type Empreinte } from "./unicite.ts";

/**
 * Piste de départ du Directeur artistique, tirée au sort par le code pour chaque site (graine = id du site, donc
 * reproductible). Constaté en vraie fabrication : deux DA lancés en même temps, libres de tout choisir, ont composé
 * presque le même site (mêmes variantes « nouvelles », même en-tête, même signature, même idée sur mesure). Le tirage
 * casse cette convergence : chaque choix est pondéré pour s'écarter de ce que les sites proches emploient déjà.
 * Le DA part de la piste et peut s'en écarter en le justifiant ; le contrôle d'unicité reste le seul juge.
 */
export type Piste = {
  hero: string;
  sections: Record<string, string>;
  ordre: string[];
  entete: string;
  pied: string;
  signature: string;
  paire: string;
  rayon: number;
  mise: Record<string, string>;
  palette: { teinte: number; accent: number; vivacite: string; accentTon: string; neutres: string; fond: string; sombre: string };
  surMesure: string;
};

/** Familles d'idées d'élément sur mesure (le DA invente l'élément, la famille l'oriente). */
export const ANGLES_SUR_MESURE = [
  "une frise de déroulé (de l'appel à la fin du chantier), propre au métier et à la façon de travailler de l'entreprise",
  "un schéma technique annoté en SVG d'un équipement du métier, pédagogique, sans rien affirmer sur l'entreprise",
  "un repère local : les communes ou quartiers de la zone mis en scène autrement qu'une carte (bandeau, plan stylisé, liste illustrée)",
  "un nuancier ou comparatif visuel de matériaux, finitions ou solutions du métier",
  "une check-list illustrée « avant d'appeler » ou « ce qu'on vérifie » pour le visiteur",
  "une illustration SVG d'un détail du métier qui sert de signature graphique à une section de texte",
  "une chronologie de l'entreprise à partir des seuls faits du brief (création, commune, prestations)",
  "des questions fréquentes du métier présentées en cartes illustrées, réponses générales et vraies",
];

/** Générateur pseudo-aléatoire reproductible (mulberry32) à partir d'une chaîne. */
function hasard(graine: string): () => number {
  let h = 1779033703 ^ graine.length;
  for (let i = 0; i < graine.length; i++) h = Math.imul(h ^ graine.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Choix pondéré : une option déjà employée n fois par les sites proches pèse 1 / (1 + 3n). */
function tirer<T>(r: () => number, options: readonly T[], emplois: (o: T) => number): T {
  const poids = options.map((o) => 1 / (1 + 3 * emplois(o)));
  let x = r() * poids.reduce((s, p) => s + p, 0);
  for (let i = 0; i < options.length; i++) {
    x -= poids[i]!;
    if (x <= 0) return options[i]!;
  }
  return options[options.length - 1]!;
}

const ecartAngle = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function pisteDeDepart(graine: string, proches: Empreinte[]): Piste {
  const r = hasard(graine);
  const compte = (f: (e: Empreinte) => unknown) => (o: unknown) => proches.filter((e) => f(e) === o).length;
  const variantesEmployees = (type: string) => (v: string) => proches.filter((e) => e.sections.includes(`${type}:${v}`)).length;
  const sections: Record<string, string> = {};
  for (const t of ["services", "pourquoi", "realisations", "zone", "devis"] as const) sections[t] = tirer(r, VARIANTES[t], variantesEmployees(t));
  const hero = tirer(r, VARIANTES.hero, variantesEmployees("hero"));
  // Ordre : hero d'abord, devis à la fin, le reste mélangé (et l'élément sur mesure placé au hasard).
  const milieu = ["services", "pourquoi", "realisations", "zone", "surmesure"];
  for (let i = milieu.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [milieu[i], milieu[j]] = [milieu[j]!, milieu[i]!];
  }
  const mise: Record<string, string> = {};
  for (const [axe, valeurs] of Object.entries(MISE)) mise[axe] = tirer(r, valeurs, (v) => proches.filter((e) => e.mise?.[axe] === v).length);
  // Accent : parmi 24 teintes, celle qui s'écarte le plus des accents proches (au hasard parmi les meilleures).
  const accents = proches.map((e) => oklab(e.couleurs.accent).h);
  const candidates = Array.from({ length: 24 }, (_, i) => i * 15 + Math.floor(r() * 15));
  const ecart = (h: number) => (accents.length ? Math.min(...accents.map((a) => ecartAngle(a, h))) : 180);
  const meilleures = candidates.sort((x, y) => ecart(y) - ecart(x)).slice(0, 5);
  return {
    hero,
    sections,
    ordre: ["hero", ...milieu, "devis"],
    entete: tirer(r, ENTETES, compte((e) => e.entete)),
    pied: tirer(r, PIEDS, compte((e) => e.pied)),
    signature: tirer(r, SIGNATURES, compte((e) => e.signature)),
    paire: tirer(r, PAIRES_POLICES, compte((e) => e.paire)),
    rayon: tirer(r, [0, 2, 4, 6, 8, 12, 16], compte((e) => e.rayon)),
    mise,
    palette: {
      teinte: Math.floor(r() * 360),
      accent: meilleures[Math.floor(r() * meilleures.length)]!,
      vivacite: tirer(r, PALETTE.vivacite, () => 0),
      accentTon: tirer(r, PALETTE.accentTon, () => 0),
      neutres: tirer(r, PALETTE.neutres, () => 0),
      fond: tirer(r, PALETTE.fond, () => 0),
      sombre: tirer(r, PALETTE.sombre, () => 0),
    },
    surMesure: ANGLES_SUR_MESURE[Math.floor(r() * ANGLES_SUR_MESURE.length)]!,
  };
}
