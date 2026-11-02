/**
 * Métiers lisibles d'une campagne → codes NAF (API Recherche d'entreprises) et étiquettes OpenStreetMap.
 * Les métiers du bâtiment sont ceux que l'atelier sait fabriquer (atelier/naf.ts) ; les services courants sont
 * sourcés et notés, mais « Créer la maquette » expliquera qu'aucune recette ne les couvre encore.
 */
export type MetierProspection = {
  id: string;
  libelle: string;
  groupe: "batiment" | "services";
  naf: string[];
  /** Étiquettes OSM [clé, valeur] des commerces et artisans de ce métier. */
  osm: [string, string][];
};

export const METIERS: MetierProspection[] = [
  { id: "electricien", libelle: "Électricien", groupe: "batiment", naf: ["43.21A"], osm: [["craft", "electrician"]] },
  { id: "plombier", libelle: "Plombier", groupe: "batiment", naf: ["43.22A"], osm: [["craft", "plumber"]] },
  { id: "chauffagiste", libelle: "Chauffagiste, climatisation", groupe: "batiment", naf: ["43.22B"], osm: [["craft", "hvac"], ["craft", "heating_engineer"]] },
  { id: "couvreur", libelle: "Couvreur", groupe: "batiment", naf: ["43.91B"], osm: [["craft", "roofer"]] },
  { id: "charpentier", libelle: "Charpentier", groupe: "batiment", naf: ["43.91A"], osm: [["craft", "carpenter"]] },
  { id: "menuisier", libelle: "Menuisier (bois, PVC)", groupe: "batiment", naf: ["43.32A"], osm: [["craft", "carpenter"], ["craft", "window_construction"]] },
  { id: "serrurier", libelle: "Serrurier, menuiserie métallique", groupe: "batiment", naf: ["43.32B"], osm: [["craft", "locksmith"], ["craft", "metal_construction"], ["shop", "locksmith"]] },
  { id: "peintre", libelle: "Peintre, vitrier", groupe: "batiment", naf: ["43.34Z"], osm: [["craft", "painter"], ["craft", "glaziery"]] },
  { id: "plaquiste", libelle: "Plâtrier, plaquiste", groupe: "batiment", naf: ["43.31Z"], osm: [["craft", "plasterer"]] },
  { id: "carreleur", libelle: "Carreleur, revêtements", groupe: "batiment", naf: ["43.33Z"], osm: [["craft", "tiler"], ["craft", "floorer"]] },
  { id: "macon", libelle: "Maçon", groupe: "batiment", naf: ["43.99C"], osm: [["craft", "builder"], ["craft", "stonemason"]] },
  { id: "paysagiste", libelle: "Paysagiste", groupe: "batiment", naf: ["81.30Z"], osm: [["craft", "gardener"], ["craft", "landscaper"]] },
  { id: "coiffeur", libelle: "Coiffeur", groupe: "services", naf: ["96.02A"], osm: [["shop", "hairdresser"]] },
  { id: "estheticienne", libelle: "Institut de beauté", groupe: "services", naf: ["96.02B"], osm: [["shop", "beauty"]] },
  { id: "garagiste", libelle: "Garagiste", groupe: "services", naf: ["45.20A"], osm: [["shop", "car_repair"]] },
  { id: "nettoyage", libelle: "Nettoyage", groupe: "services", naf: ["81.21Z"], osm: [["craft", "cleaning"]] },
  { id: "demenageur", libelle: "Déménageur", groupe: "services", naf: ["49.42Z"], osm: [["office", "moving_company"]] },
];

export function metier(id: string): MetierProspection | undefined {
  return METIERS.find((m) => m.id === id);
}

/** Codes NAF d'une liste de métiers, plus d'éventuels codes saisis à la main (sans doublon, triés). */
export function codesNaf(metiers: string[], autres: string[] = []): string[] {
  return [...new Set([...metiers.flatMap((id) => metier(id)?.naf ?? []), ...autres])].sort();
}

/** Libellé lisible d'un code NAF (le premier métier qui le porte), ou null. */
export function libelleNaf(naf: string | null | undefined): string | null {
  if (!naf) return null;
  return METIERS.find((m) => m.naf.includes(naf))?.libelle ?? null;
}

export function metierDeNaf(naf: string | null | undefined): MetierProspection | null {
  if (!naf) return null;
  return METIERS.find((m) => m.naf.includes(naf)) ?? null;
}
