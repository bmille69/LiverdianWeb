import { distanceKm } from "../atelier/communes.ts";
import { ressemblanceAdresses, ressemblanceNoms } from "./texte.ts";

/**
 * Appariement d'une entreprise Sirene avec une fiche Places ou un lieu OSM, par le nom et le lieu.
 * Le score (0 à 1) est gardé avec son détail. Au-dessus de SEUIL_FUSION, les données sont fusionnées ;
 * entre SEUIL_DOUTE et SEUIL_FUSION, l'appariement est « douteux » : signalé dans la fiche, jamais fusionné
 * sans accord du propriétaire ; en dessous, aucun appariement.
 */
export const SEUIL_FUSION = 0.75;
export const SEUIL_DOUTE = 0.5;

export type Cible = {
  noms: (string | null | undefined)[];
  adresse: { ligne: string | null; codePostal: string | null };
  lat: number | null;
  lon: number | null;
};

export type Candidat = { nom: string; adresse: { ligne: string | null; codePostal: string | null }; lat: number | null; lon: number | null };

export type Appariement = {
  score: number;
  statut: "fusionne" | "douteux" | "aucun";
  detail: { nom: number; adresse: number | null; distanceM: number | null };
};

function scoreDistance(m: number): number {
  if (m <= 120) return 1;
  if (m <= 350) return 0.85;
  if (m <= 1000) return 0.6;
  if (m <= 3000) return 0.3;
  return 0;
}

export function apparier(cible: Cible, cand: Candidat): Appariement {
  const nom = Math.max(0, ...cible.noms.filter(Boolean).map((n) => ressemblanceNoms(n, cand.nom)));
  const adresse = ressemblanceAdresses(cible.adresse, cand.adresse);
  const distanceM = cible.lat != null && cible.lon != null && cand.lat != null && cand.lon != null ? Math.round(distanceKm({ lat: cible.lat, lon: cible.lon }, { lat: cand.lat, lon: cand.lon }) * 1000) : null;
  const lieux = [adresse, distanceM != null ? scoreDistance(distanceM) : null].filter((x): x is number => x != null);
  // Sans aucune information de lieu, le nom seul ne suffit jamais à fusionner.
  const lieu = lieux.length ? Math.max(...lieux) : null;
  let score = lieu == null ? nom * 0.7 : 0.6 * nom + 0.4 * lieu;
  // Un nom très différent n'est pas rattrapé par la seule proximité (voisins de palier, zones d'activité).
  if (nom < 0.4) score = Math.min(score, nom);
  score = Math.round(score * 100) / 100;
  return { score, statut: score >= SEUIL_FUSION ? "fusionne" : score >= SEUIL_DOUTE ? "douteux" : "aucun", detail: { nom: Math.round(nom * 100) / 100, adresse: adresse == null ? null : Math.round(adresse * 100) / 100, distanceM } };
}

/** Le meilleur candidat (score le plus haut), avec son appariement ; null si aucun n'atteint le seuil de doute. */
export function meilleur<T extends Candidat>(cible: Cible, candidats: T[]): { candidat: T; appariement: Appariement } | null {
  let best: { candidat: T; appariement: Appariement } | null = null;
  for (const c of candidats) {
    const a = apparier(cible, c);
    if (!best || a.score > best.appariement.score) best = { candidat: c, appariement: a };
  }
  return best && best.appariement.statut !== "aucun" ? best : null;
}
