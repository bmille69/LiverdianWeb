/**
 * Unicité des sites (brief D, ADR-14) : empreinte d'un site, distance de design pondérée entre deux empreintes,
 * similarité de texte par n-grammes de mots, et verdict du contrôle bloquant. Code pur, sans base ni fichiers :
 * le registre (`registre.ts`) fournit les empreintes, la recette décide qui corrige.
 */

/** Thème tel que le kit le résout (palette générée et paire de polices comprises). */
export type ThemeResolu = {
  couleurs: Record<string, string>;
  polices: { titres: string; corps: string };
  rayon: number;
  signature: string;
  mise: Record<string, string>;
};

export type Empreinte = {
  nom: string;
  metier: string;
  commune: string;
  lat: number | null;
  lon: number | null;
  preset: string;
  /** Couleurs finales (hex) qui comptent pour l'œil : accent, sombre, fond. */
  couleurs: { accent: string; sombre: string; fond: string };
  polices: { titres: string; corps: string };
  paire: string | null;
  rayon: number;
  signature: string;
  /** Mise en page résolue (cadre « auto » remplacé par celui de la signature). */
  mise: Record<string, string>;
  entete: string;
  pied: string;
  /** « type:variante » dans l'ordre de la page. */
  sections: string[];
  heroImage: string | null;
  images: string[];
  surMesure: { composant: string; element: string } | null;
  /** H1, titres de section et d'éléments, tels qu'écrits. */
  titres: string[];
  /** Phrases écrites pour ce site (hors titres), telles qu'écrites. */
  phrases: string[];
  /** Noms propres remplacés par des jetons avant de comparer les textes. */
  remplacements: { nom: string[]; communes: string[] };
};

// ─── Couleurs (OKLab) ────────────────────────────────────────────────────────

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export function oklab(hex: string): { l: number; a: number; b: number; c: number; h: number } {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, a: A, b: B, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** Écart perceptuel entre deux couleurs (distance euclidienne OKLab, ~0 à 0,5). */
export function ecartCouleur(x: string, y: string): number {
  const p = oklab(x);
  const q = oklab(y);
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

/** Écart de teinte en degrés (0 à 180). */
export function ecartTeinte(x: string, y: string): number {
  const d = Math.abs(oklab(x).h - oklab(y).h) % 360;
  return d > 180 ? 360 - d : d;
}

// ─── Distance de design ──────────────────────────────────────────────────────

/** Poids de chaque critère (la distance finale est la moyenne pondérée, de 0 = identique à 1 = tout diffère). */
export const POIDS = {
  accent: 3,
  sombre: 1.5,
  fond: 0.5,
  policeTitres: 2,
  policeCorps: 1,
  signature: 1.5,
  hero: 2,
  imageHero: 1.5,
  ordre: 2,
  variantes: 1,
  rayon: 0.4,
  entete: 0.5,
  pied: 0.5,
  "mise.echelle": 0.5,
  "mise.densite": 0.4,
  "mise.images": 0.6,
  "mise.cadre": 0.4,
  "mise.boutons": 0.6,
  "mise.rythme": 0.6,
  "mise.titres": 0.6,
  "mise.surtitres": 0.4,
  surMesure: 1.5,
} as const;
export type Critere = keyof typeof POIDS;

const LIBELLES: Record<Critere, string> = {
  accent: "couleur d'accent",
  sombre: "fond sombre",
  fond: "fond clair",
  policeTitres: "police des titres",
  policeCorps: "police du texte",
  signature: "élément signature (motif)",
  hero: "variante du hero",
  imageHero: "photo du hero",
  ordre: "ordre des sections",
  variantes: "variantes des sections",
  rayon: "rayon des coins",
  entete: "en-tête",
  pied: "pied de page",
  "mise.echelle": "échelle typographique",
  "mise.densite": "densité",
  "mise.images": "traitement des photos",
  "mise.cadre": "cadre des photos",
  "mise.boutons": "style des boutons",
  "mise.rythme": "rythme des fonds",
  "mise.titres": "casse des titres",
  "mise.surtitres": "style des surtitres",
  surMesure: "idée d'élément sur mesure",
};

/**
 * Série d'une photo de la banque : son nom sans le numéro (« boites-encastrement-01 » et « -02 » montrent le même sujet).
 * Deux photos de la même série comptent comme la même photo de hero.
 */
function memeIdee(a: string, b: string): boolean {
  const x = motsIdee(a);
  const y = motsIdee(b);
  if (!x.size || !y.size) return false;
  let n = 0;
  for (const m of x) if (y.has(m)) n++;
  return n / Math.min(x.size, y.size) >= 0.6;
}

export const seriePhoto = (f: string | null | undefined) => (f ? f.replace(/-\d+(\.[a-z]+)$/i, "$1") : null);

/** Mots porteurs d'un nom d'élément sur mesure (minuscules, sans accents, 4 lettres et plus). */
const motsIdee = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 4),
  );

function levenshtein<T>(a: T[], b: T[]): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

const jaccard = <T>(a: Set<T>, b: Set<T>) => {
  if (!a.size && !b.size) return 1;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

const heroDe = (e: Empreinte) => e.sections.find((s) => s.startsWith("hero:")) ?? "";

/** Écarts par critère (0 = identique, 1 = franchement différent). */
export function ecarts(x: Empreinte, y: Empreinte): Record<Critere, number> {
  const diff = (a: unknown, b: unknown) => (a === b ? 0 : 1);
  const longueur = Math.max(x.sections.length, y.sections.length, 1);
  return {
    accent: Math.min(1, ecartCouleur(x.couleurs.accent, y.couleurs.accent) / 0.12),
    sombre: Math.min(1, ecartCouleur(x.couleurs.sombre, y.couleurs.sombre) / 0.08),
    fond: Math.min(1, ecartCouleur(x.couleurs.fond, y.couleurs.fond) / 0.035),
    policeTitres: diff(x.polices.titres, y.polices.titres),
    policeCorps: diff(x.polices.corps, y.polices.corps),
    signature: diff(x.signature, y.signature),
    hero: diff(heroDe(x), heroDe(y)),
    imageHero: diff(seriePhoto(x.heroImage), seriePhoto(y.heroImage)),
    ordre: levenshtein(x.sections, y.sections) / longueur,
    variantes: 1 - jaccard(new Set(x.sections), new Set(y.sections)),
    rayon: Math.min(1, Math.abs(x.rayon - y.rayon) / 8),
    entete: diff(x.entete, y.entete),
    pied: diff(x.pied, y.pied),
    "mise.echelle": diff(x.mise.echelle, y.mise.echelle),
    "mise.densite": diff(x.mise.densite, y.mise.densite),
    "mise.images": diff(x.mise.images, y.mise.images),
    "mise.cadre": diff(x.mise.cadre, y.mise.cadre),
    "mise.boutons": diff(x.mise.boutons, y.mise.boutons),
    "mise.rythme": diff(x.mise.rythme, y.mise.rythme),
    "mise.titres": diff(x.mise.titres, y.mise.titres),
    "mise.surtitres": diff(x.mise.surtitres, y.mise.surtitres),
    // Deux idées d'élément sur mesure dont le nom le plus court est repris aux trois cinquièmes sont la même idée.
    surMesure: x.surMesure && y.surMesure ? (memeIdee(x.surMesure.element, y.surMesure.element) ? 0 : 1) : x.surMesure || y.surMesure ? 1 : 0,
  };
}

const POIDS_TOTAL = Object.values(POIDS).reduce((a, b) => a + b, 0);

/** Distance de design pondérée entre deux sites, de 0 (identiques) à 1 (tout diffère). */
export function distanceDesign(x: Empreinte, y: Empreinte): number {
  const e = ecarts(x, y);
  const s = (Object.keys(POIDS) as Critere[]).reduce((acc, k) => acc + POIDS[k] * e[k], 0);
  return Math.round((s / POIDS_TOTAL) * 1000) / 1000;
}

/** Ce qui est identique ou presque entre deux sites, lisible (« même police des titres : archivo »). */
export function elementsProches(x: Empreinte, y: Empreinte): string[] {
  const e = ecarts(x, y);
  const valeur: Partial<Record<Critere, string>> = {
    accent: `${x.couleurs.accent} contre ${y.couleurs.accent}, ${Math.round(ecartTeinte(x.couleurs.accent, y.couleurs.accent))}° d'écart de teinte`,
    sombre: `${x.couleurs.sombre} contre ${y.couleurs.sombre}`,
    fond: `${x.couleurs.fond} contre ${y.couleurs.fond}`,
    policeTitres: x.polices.titres,
    policeCorps: x.polices.corps,
    signature: x.signature,
    hero: heroDe(x),
    imageHero: x.heroImage ?? "aucune",
    ordre: x.sections.join(" → "),
    variantes: x.sections.filter((s) => y.sections.includes(s)).join(", "),
    rayon: `${x.rayon} px`,
    surMesure: `« ${x.surMesure?.element ?? ""} » contre « ${y.surMesure?.element ?? ""} »`,
    entete: x.entete,
    pied: x.pied,
  };
  return (Object.keys(POIDS) as Critere[])
    .filter((k) => e[k] < 0.35 && POIDS[k] >= 0.4)
    .sort((a, b) => POIDS[b] - POIDS[a])
    .map((k) => `${e[k] === 0 ? "même" : "presque même"} ${LIBELLES[k]} : ${valeur[k] ?? x.mise[k.replace("mise.", "")] ?? ""}`);
}

// ─── Texte ───────────────────────────────────────────────────────────────────

/**
 * Texte d'un site réduit à ce qui le rend propre : minuscules, sans ponctuation, le nom de l'entreprise, les communes
 * et le téléphone remplacés par des jetons. Deux sites qui recyclent la même phrase avec un autre nom ou une autre
 * commune (« Votre électricien à Bron… » / « Votre électricien à Bron… ») sont ainsi repérés.
 */
export function normaliserTexte(textes: string[], remplacer: { nom: string[]; communes: string[] }): string[] {
  const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plat = (s: string) => s.toLowerCase().replace(/[’']/g, " ").replace(/[‑–—-]/g, " ");
  // Mot entier seulement (« Bron » ne doit pas toucher « bronze »).
  const mot = (n: string) => new RegExp(`(?<![\\p{L}\\p{N}])${echapper(plat(n).trim())}(?![\\p{L}\\p{N}])`, "gu");
  const motifs: [RegExp, string][] = [
    ...[...new Set(remplacer.nom)].filter((n) => n.trim().length > 1).sort((a, b) => b.length - a.length).map((n) => [mot(n), " jnom "] as [RegExp, string]),
    ...[...new Set(remplacer.communes)].filter((n) => n.trim().length > 1).sort((a, b) => b.length - a.length).map((n) => [mot(n), " jcommune "] as [RegExp, string]),
    [/(?:\+33|0)\s*[1-9](?:[\s.]*\d{2}){4}/g, " jtel "],
  ];
  const mots: string[] = [];
  for (const t of textes) {
    let s = plat(t);
    for (const [re, jeton] of motifs) s = s.replace(re, jeton);
    s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
    mots.push(...s.split(/\s+/).filter(Boolean), "¶");
  }
  return mots;
}

const JETONS = new Set(["jnom", "jcommune", "jtel", "et", "à", "a", "de", "du", "la", "le", "les", "en", "ou"]);

/**
 * Un n-gramme compte s'il porte au moins deux vrais mots : une liste de communes (« jcommune jcommune et jcommune… »)
 * n'est pas une phrase recyclée.
 */
const significatif = (g: string[]) => !g.includes("¶") && g.filter((m) => !JETONS.has(m)).length >= 2;

/** N-grammes de mots (« shingles ») d'un texte normalisé ; les fins de bloc (¶) coupent les n-grammes. */
export function shingles(mots: string[], n = 5): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= mots.length; i++) {
    const g = mots.slice(i, i + n);
    if (significatif(g)) out.add(g.join(" "));
  }
  return out;
}

export function similariteTexte(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  return Math.round(jaccard(a, b) * 1000) / 1000;
}

/** Passages communs (suites de mots du texte `mots` dont les n-grammes existent dans `autre`), du plus long au plus court. */
export function passagesCommuns(mots: string[], autre: Set<string>, n = 5): string[] {
  const couvert = new Array<boolean>(mots.length).fill(false);
  for (let i = 0; i + n <= mots.length; i++) {
    const g = mots.slice(i, i + n);
    if (significatif(g) && autre.has(g.join(" "))) for (let k = i; k < i + n; k++) couvert[k] = true;
  }
  const out: string[] = [];
  let cur: string[] = [];
  mots.forEach((m, i) => {
    if (couvert[i] && m !== "¶") cur.push(m);
    else if (cur.length) {
      out.push(cur.join(" "));
      cur = [];
    }
  });
  if (cur.length) out.push(cur.join(" "));
  return [...new Set(out)].sort((x, y) => y.length - x.length);
}

// ─── Géographie ──────────────────────────────────────────────────────────────

export function distanceKm(a: { lat: number | null; lon: number | null }, b: { lat: number | null; lon: number | null }): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

// ─── Contrôle ────────────────────────────────────────────────────────────────

export type SeuilsUnicite = {
  /** Rayon de la « zone » d'un site, en km. */
  zoneKm: number;
  /** Distance de design minimale avec un site du même métier dans la zone. */
  distanceVoisin: number;
  /** … avec un site du même métier hors de la zone. */
  distanceMetier: number;
  /** … avec un site d'un autre métier dans la zone. */
  distanceZone: number;
  /** Similarité de texte maximale (Jaccard des 5-grammes) avec un site du même métier. */
  texteMetier: number;
  /** … avec n'importe quel autre site. */
  texteAutre: number;
  /** Écart minimal de teinte d'accent (degrés) avec un site du même métier dans la zone, sauf contraste de luminosité franc. */
  teinteVoisin: number;
};

export type Autre = { id: string; nom: string; commune: string; origine: string; empreinte: Empreinte; mots: string[] };

export type Comparaison = {
  id: string;
  nom: string;
  commune: string;
  origine: string;
  relation: "voisin" | "metier" | "zone" | "autre";
  km: number | null;
  distance: number;
  seuilDistance: number | null;
  similarite: number;
  seuilTexte: number;
};

export type Conflit = {
  agent: "directeur-artistique" | "redacteur";
  site: { id: string; nom: string; commune: string; origine: string };
  motif: string;
  details: string[];
};

export type VerdictUnicite = {
  ok: boolean;
  comparaisons: Comparaison[];
  conflits: Conflit[];
  /** Le site le plus proche (distance de design la plus faible), pour l'affichage. */
  plusProche: Comparaison | null;
  /** La plus forte similarité de texte, pour l'affichage. */
  texteMax: Comparaison | null;
};

/** Vérifie un site contre tous les autres sites du registre. */
export function verifierUnicite(moi: Empreinte, mesMots: string[], autres: Autre[], s: SeuilsUnicite): VerdictUnicite {
  const mesShingles = shingles(mesMots);
  const comparaisons: Comparaison[] = [];
  const conflits: Conflit[] = [];
  for (const o of autres) {
    const km = distanceKm(moi, o.empreinte);
    const proche = km !== null && km <= s.zoneKm;
    const memeMetier = o.empreinte.metier === moi.metier;
    const relation: Comparaison["relation"] = memeMetier ? (proche ? "voisin" : "metier") : proche ? "zone" : "autre";
    const seuilDistance = relation === "voisin" ? s.distanceVoisin : relation === "metier" ? s.distanceMetier : relation === "zone" ? s.distanceZone : null;
    const distance = distanceDesign(moi, o.empreinte);
    const autreShingles = shingles(o.mots);
    const similarite = similariteTexte(mesShingles, autreShingles);
    const seuilTexte = memeMetier ? s.texteMetier : s.texteAutre;
    comparaisons.push({ id: o.id, nom: o.nom, commune: o.commune, origine: o.origine, relation, km, distance, seuilDistance, similarite, seuilTexte });
    const site = { id: o.id, nom: o.nom, commune: o.commune, origine: o.origine };
    const ou = `${o.nom} (${o.commune}${km !== null ? `, ${km} km` : ""}, ${o.origine})`;

    // Design : règles strictes d'abord (photo du hero, paire de polices, teinte), puis distance pondérée.
    const details: string[] = [];
    if ((memeMetier || proche) && moi.heroImage && seriePhoto(moi.heroImage) === seriePhoto(o.empreinte.heroImage)) {
      details.push(`même photo de hero (ou même série) que ${ou} : ${moi.heroImage}${moi.heroImage !== o.empreinte.heroImage ? ` contre ${o.empreinte.heroImage}` : ""}`);
    }
    if (relation === "voisin" && moi.surMesure && o.empreinte.surMesure && ecarts(moi, o.empreinte).surMesure === 0) details.push(`même idée d'élément sur mesure que ${ou} : « ${moi.surMesure?.element} » contre « ${o.empreinte.surMesure?.element} » ; invente autre chose, propre à cette entreprise`);
    if (relation === "voisin" && moi.polices.titres === o.empreinte.polices.titres && moi.polices.corps === o.empreinte.polices.corps) {
      details.push(`même paire de polices que ${ou} : ${moi.polices.titres} / ${moi.polices.corps}`);
    }
    if (relation === "voisin") {
      const dh = ecartTeinte(moi.couleurs.accent, o.empreinte.couleurs.accent);
      const dl = Math.abs(oklab(moi.couleurs.accent).l - oklab(o.empreinte.couleurs.accent).l);
      if (dh < s.teinteVoisin && dl < 0.15) details.push(`teinte d'accent trop proche de ${ou} : ${moi.couleurs.accent} contre ${o.empreinte.couleurs.accent} (${Math.round(dh)}° d'écart, minimum ${s.teinteVoisin}°, ou une luminosité franchement différente)`);
    }
    if (seuilDistance !== null && distance < seuilDistance) {
      details.push(`distance de design ${distance.toFixed(3)} avec ${ou}, minimum ${seuilDistance} ; éléments trop proches : ${elementsProches(moi, o.empreinte).join(" ; ") || "ensemble trop semblable"}`);
    }
    if (details.length) conflits.push({ agent: "directeur-artistique", site, motif: "design", details });

    if (similarite > seuilTexte) {
      const passages = passagesCommuns(mesMots, autreShingles).slice(0, 10);
      conflits.push({
        agent: "redacteur",
        site,
        motif: "texte",
        details: [
          `similarité de texte ${similarite.toFixed(3)} avec ${ou}, maximum ${seuilTexte} (n-grammes de 5 mots ; jnom = nom de l'entreprise, jcommune = une commune, jtel = le téléphone)`,
          ...passages.map((p) => `passage déjà employé : « ${p} »`),
        ],
      });
    }
  }
  const plusProche = [...comparaisons].sort((a, b) => a.distance - b.distance)[0] ?? null;
  const texteMax = [...comparaisons].sort((a, b) => b.similarite - a.similarite)[0] ?? null;
  return { ok: conflits.length === 0, comparaisons, conflits, plusProche, texteMax };
}

/** Message de renvoi à un agent : les sites en conflit et les éléments trop proches, mot pour mot. */
export function messageConflits(conflits: Conflit[]): string {
  return conflits
    .map((c) => [`Conflit avec « ${c.site.nom} » (${c.site.commune}, ${c.site.origine}, id ${c.site.id}) :`, ...c.details.map((d) => `  - ${d}`)].join("\n"))
    .join("\n");
}
