/**
 * Carte stylisée de la zone d'intervention (SVG statique, aucune tuile ni service externe) :
 * projection équirectangulaire locale centrée sur le siège, anneaux de distance, communes placées
 * à leur vraie position relative, étiquettes écartées pour ne pas se chevaucher.
 */
import type { Zone } from "../schema.ts";

export type PointCarte = { nom: string; x: number; y: number; siege: boolean; lx: number; ly: number; ancre: "start" | "end" | "middle" };
export type Carte = { largeur: number; hauteur: number; cx: number; cy: number; points: PointCarte[]; anneaux: { r: number; km: number }[] };

const L = 720;
const H = 520;
const MARGE_X = 150;
const MARGE_Y = 56;
export const TAILLE_TEXTE = 26;

export function carteZone(zone: Zone): Carte {
  const siege = zone.commune;
  const lat0 = siege.lat ?? 0;
  const lon0 = siege.lon ?? 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const toutes = [{ ...siege, siege: true }, ...zone.voisines.map((v) => ({ ...v, siege: false }))];
  const km = toutes.map((c) => ({
    nom: c.nom,
    siege: c.siege,
    x: ((c.lon ?? lon0) - lon0) * k * 111.32,
    y: -((c.lat ?? lat0) - lat0) * 110.57,
  }));
  const portee = Math.max(1, ...km.map((p) => Math.hypot(p.x, p.y)));
  const maxX = Math.max(0.5, ...km.map((p) => Math.abs(p.x)));
  const maxY = Math.max(0.5, ...km.map((p) => Math.abs(p.y)));
  const echelle = Math.min((L / 2 - MARGE_X) / maxX, (H / 2 - MARGE_Y) / maxY);
  const cx = L / 2;
  const cy = H / 2;
  const pts = km.map((p) => ({ ...p, x: cx + p.x * echelle, y: cy + p.y * echelle }));

  // Étiquettes : 8 positions candidates par point (droite, gauche, dessus, dessous, et décalées en hauteur).
  // Placement glouton puis passes d'amélioration : chaque étiquette est replacée en tenant compte de toutes les autres,
  // en minimisant chevauchements (étiquettes, points) et débordements du cadre.
  type Boite = { x1: number; x2: number; y1: number; y2: number };
  type Cand = { ancre: "start" | "end" | "middle"; lx: number; ly: number; boite: Boite };
  const aire = (a: Boite, b: Boite) =>
    Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const boitesPoints: Boite[] = pts.map((p) => {
    const r = p.siege ? 24 : 10;
    return { x1: p.x - r, x2: p.x + r, y1: p.y - r, y2: p.y + r };
  });
  const candidatsDe = (p: (typeof pts)[number]): Cand[] => {
    const t = p.siege ? TAILLE_TEXTE * 1.15 : TAILLE_TEXTE;
    const w = p.nom.length * t * (p.siege ? 0.6 : 0.56);
    const ecart = p.siege ? 30 : 16;
    const base: ("start" | "end")[] = p.x >= cx ? ["start", "end"] : ["end", "start"];
    const dy = t * 0.95;
    const bruts: Omit<Cand, "boite">[] = [
      ...base.map((a) => ({ ancre: a, lx: a === "start" ? p.x + ecart : p.x - ecart, ly: p.y + t * 0.35 })),
      { ancre: "middle", lx: p.x, ly: p.y - ecart + 2 },
      { ancre: "middle", lx: p.x, ly: p.y + ecart + t * 0.7 },
      ...base.flatMap((a) => [-dy, dy].map((d) => ({ ancre: a, lx: a === "start" ? p.x + ecart * 0.6 : p.x - ecart * 0.6, ly: p.y + t * 0.35 + d }))),
    ];
    return bruts.map((c) => {
      const x1 = c.ancre === "start" ? c.lx : c.ancre === "end" ? c.lx - w : c.lx - w / 2;
      return { ...c, boite: { x1, x2: x1 + w, y1: c.ly - t * 0.8, y2: c.ly + t * 0.25 } };
    });
  };
  const cands = pts.map(candidatsDe);
  const choix: number[] = pts.map(() => -1);
  const score = (i: number, k: number) => {
    const bx = cands[i]![k]!.boite;
    const hors = Math.max(0, 6 - bx.x1) + Math.max(0, bx.x2 - (L - 6)) + Math.max(0, 6 - bx.y1) + Math.max(0, bx.y2 - (H - 6));
    let lab = 0;
    choix.forEach((kj, j) => {
      if (j !== i && kj >= 0) lab += aire(bx, cands[j]![kj]!.boite);
    });
    const pt = boitesPoints.reduce((n, q, j) => n + (j === i ? 0 : aire(bx, q)), 0);
    return hors * 1000 + lab * 3 + pt * 4 + k * 25;
  };
  const meilleur = (i: number) => cands[i]!.map((_, k) => k).sort((a, b) => score(i, a) - score(i, b))[0]!;
  const ordre = pts.map((_, i) => i).sort((a, b) => Number(pts[b]!.siege) - Number(pts[a]!.siege));
  for (const i of ordre) choix[i] = meilleur(i);
  for (let passe = 0; passe < 6; passe++) for (const i of ordre) choix[i] = meilleur(i);
  const points: PointCarte[] = pts.map((p, i) => {
    const c = cands[i]![choix[i]!]!;
    return { nom: p.nom, x: p.x, y: p.y, siege: p.siege, lx: c.lx, ly: c.ly, ancre: c.ancre };
  });

  // Anneaux de distance « ronds » (2, 5, 10, 15, 20 km…) jusqu'à la portée.
  const pas = portee <= 3 ? 1 : portee <= 6 ? 2 : portee <= 20 ? 5 : 10;
  const anneaux: { r: number; km: number }[] = [];
  for (let d = pas; d <= portee * 1.15; d += pas) anneaux.push({ km: d, r: d * echelle });
  return { largeur: L, hauteur: H, cx, cy, points, anneaux };
}
