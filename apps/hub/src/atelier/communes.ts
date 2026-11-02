/**
 * Petite table locale des communes de la zone de travail (métropole de Lyon, Rhône, nord de l'Isère), avec leurs
 * coordonnées (WGS84, centre de la commune, précision ~1 km) : la carte SVG de zone du kit en a besoin.
 * Sert aussi de liste fermée quand la fiche n'a pas de communes voisines : l'agent ne peut proposer que des
 * communes de cette table, choisies parmi les plus proches du siège (calcul fait ici, pas par l'agent).
 */
export type Commune = { nom: string; lat: number; lon: number; dep: "69" | "38" };

export const COMMUNES: Commune[] = [
  // Lyon, par arrondissement
  { nom: "Lyon 1er", lat: 45.77, lon: 4.8295, dep: "69" },
  { nom: "Lyon 2e", lat: 45.749, lon: 4.827, dep: "69" },
  { nom: "Lyon 3e", lat: 45.7597, lon: 4.851, dep: "69" },
  { nom: "Lyon 4e", lat: 45.7786, lon: 4.827, dep: "69" },
  { nom: "Lyon 5e", lat: 45.756, lon: 4.803, dep: "69" },
  { nom: "Lyon 6e", lat: 45.7705, lon: 4.8525, dep: "69" },
  { nom: "Lyon 7e", lat: 45.745, lon: 4.842, dep: "69" },
  { nom: "Lyon 8e", lat: 45.735, lon: 4.869, dep: "69" },
  { nom: "Lyon 9e", lat: 45.774, lon: 4.805, dep: "69" },
  // Métropole de Lyon
  { nom: "Villeurbanne", lat: 45.7719, lon: 4.8902, dep: "69" },
  { nom: "Vaulx-en-Velin", lat: 45.7786, lon: 4.9206, dep: "69" },
  { nom: "Bron", lat: 45.7386, lon: 4.9131, dep: "69" },
  { nom: "Saint-Priest", lat: 45.696, lon: 4.944, dep: "69" },
  { nom: "Chassieu", lat: 45.744, lon: 4.97, dep: "69" },
  { nom: "Décines-Charpieu", lat: 45.7686, lon: 4.9592, dep: "69" },
  { nom: "Meyzieu", lat: 45.767, lon: 5.003, dep: "69" },
  { nom: "Jonage", lat: 45.796, lon: 5.047, dep: "69" },
  { nom: "Vénissieux", lat: 45.697, lon: 4.886, dep: "69" },
  { nom: "Saint-Fons", lat: 45.708, lon: 4.853, dep: "69" },
  { nom: "Feyzin", lat: 45.673, lon: 4.858, dep: "69" },
  { nom: "Corbas", lat: 45.668, lon: 4.902, dep: "69" },
  { nom: "Mions", lat: 45.663, lon: 4.953, dep: "69" },
  { nom: "Solaize", lat: 45.64, lon: 4.84, dep: "69" },
  { nom: "Saint-Genis-Laval", lat: 45.695, lon: 4.793, dep: "69" },
  { nom: "Oullins-Pierre-Bénite", lat: 45.714, lon: 4.808, dep: "69" },
  { nom: "La Mulatière", lat: 45.728, lon: 4.812, dep: "69" },
  { nom: "Sainte-Foy-lès-Lyon", lat: 45.734, lon: 4.794, dep: "69" },
  { nom: "Irigny", lat: 45.673, lon: 4.822, dep: "69" },
  { nom: "Vernaison", lat: 45.647, lon: 4.811, dep: "69" },
  { nom: "Givors", lat: 45.59, lon: 4.769, dep: "69" },
  { nom: "Grigny", lat: 45.608, lon: 4.79, dep: "69" },
  { nom: "Francheville", lat: 45.737, lon: 4.763, dep: "69" },
  { nom: "Craponne", lat: 45.745, lon: 4.723, dep: "69" },
  { nom: "Tassin-la-Demi-Lune", lat: 45.764, lon: 4.78, dep: "69" },
  { nom: "Écully", lat: 45.774, lon: 4.778, dep: "69" },
  { nom: "Charbonnières-les-Bains", lat: 45.78, lon: 4.746, dep: "69" },
  { nom: "Saint-Genis-les-Ollières", lat: 45.759, lon: 4.726, dep: "69" },
  { nom: "Dardilly", lat: 45.806, lon: 4.753, dep: "69" },
  { nom: "Limonest", lat: 45.837, lon: 4.772, dep: "69" },
  { nom: "Champagne-au-Mont-d'Or", lat: 45.795, lon: 4.79, dep: "69" },
  { nom: "Saint-Didier-au-Mont-d'Or", lat: 45.813, lon: 4.799, dep: "69" },
  { nom: "Saint-Cyr-au-Mont-d'Or", lat: 45.815, lon: 4.817, dep: "69" },
  { nom: "Collonges-au-Mont-d'Or", lat: 45.821, lon: 4.844, dep: "69" },
  { nom: "Caluire-et-Cuire", lat: 45.7953, lon: 4.8467, dep: "69" },
  { nom: "Fontaines-sur-Saône", lat: 45.835, lon: 4.846, dep: "69" },
  { nom: "Rillieux-la-Pape", lat: 45.8211, lon: 4.8986, dep: "69" },
  { nom: "Sathonay-Camp", lat: 45.825, lon: 4.874, dep: "69" },
  { nom: "Neuville-sur-Saône", lat: 45.876, lon: 4.841, dep: "69" },
  // Rhône
  { nom: "Genas", lat: 45.731, lon: 5.002, dep: "69" },
  { nom: "Pusignan", lat: 45.755, lon: 5.067, dep: "69" },
  { nom: "Colombier-Saugnieu", lat: 45.718, lon: 5.104, dep: "69" },
  { nom: "Saint-Bonnet-de-Mure", lat: 45.691, lon: 5.029, dep: "69" },
  { nom: "Saint-Laurent-de-Mure", lat: 45.685, lon: 5.045, dep: "69" },
  { nom: "Toussieu", lat: 45.656, lon: 4.985, dep: "69" },
  { nom: "Saint-Pierre-de-Chandieu", lat: 45.646, lon: 5.013, dep: "69" },
  { nom: "Saint-Symphorien-d'Ozon", lat: 45.633, lon: 4.858, dep: "69" },
  { nom: "Ternay", lat: 45.603, lon: 4.809, dep: "69" },
  { nom: "Brignais", lat: 45.674, lon: 4.754, dep: "69" },
  { nom: "Chaponost", lat: 45.71, lon: 4.742, dep: "69" },
  { nom: "Mornant", lat: 45.619, lon: 4.672, dep: "69" },
  { nom: "L'Arbresle", lat: 45.835, lon: 4.617, dep: "69" },
  { nom: "Anse", lat: 45.936, lon: 4.719, dep: "69" },
  { nom: "Villefranche-sur-Saône", lat: 45.989, lon: 4.719, dep: "69" },
  // Nord de l'Isère
  { nom: "Vienne", lat: 45.525, lon: 4.874, dep: "38" },
  { nom: "Pont-Évêque", lat: 45.531, lon: 4.909, dep: "38" },
  { nom: "Estrablin", lat: 45.516, lon: 4.958, dep: "38" },
  { nom: "Chasse-sur-Rhône", lat: 45.579, lon: 4.801, dep: "38" },
  { nom: "Heyrieux", lat: 45.633, lon: 5.063, dep: "38" },
  { nom: "Saint-Quentin-Fallavier", lat: 45.643, lon: 5.111, dep: "38" },
  { nom: "La Verpillière", lat: 45.634, lon: 5.146, dep: "38" },
  { nom: "Villefontaine", lat: 45.613, lon: 5.15, dep: "38" },
  { nom: "L'Isle-d'Abeau", lat: 45.62, lon: 5.228, dep: "38" },
  { nom: "Bourgoin-Jallieu", lat: 45.586, lon: 5.274, dep: "38" },
  { nom: "Villette-d'Anthon", lat: 45.793, lon: 5.117, dep: "38" },
  { nom: "Janneyrias", lat: 45.752, lon: 5.11, dep: "38" },
  { nom: "Charvieu-Chavagneux", lat: 45.747, lon: 5.153, dep: "38" },
  { nom: "Pont-de-Chéruy", lat: 45.753, lon: 5.173, dep: "38" },
  { nom: "Crémieu", lat: 45.725, lon: 5.25, dep: "38" },
];

/** Comparaison tolérante : casse, accents, tirets, « Saint »/« St », « Lyon 8 » / « Lyon 8e » / « Lyon 8ème ». */
export function cleCommune(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\bst\b\.?/g, "saint")
    .replace(/\bste\b\.?/g, "sainte")
    .replace(/(\d+)\s*(e|eme|er|ere)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function trouverCommune(nom: string | null | undefined): Commune | null {
  if (!nom) return null;
  const k = cleCommune(nom);
  // « Lyon 69008 » ou « Lyon » + code postal sont gérés par trouverParCodePostal.
  return COMMUNES.find((c) => cleCommune(c.nom) === k) ?? null;
}

/** Lyon : le code postal donne l'arrondissement (69001 → Lyon 1er). */
export function trouverAvecCodePostal(nom: string | null | undefined, codePostal: string | null | undefined): Commune | null {
  const direct = trouverCommune(nom);
  if (direct) return direct;
  if (nom && cleCommune(nom) === "lyon" && codePostal && /^6900[1-9]$/.test(codePostal)) {
    return trouverCommune(`Lyon ${Number(codePostal.slice(3))}`);
  }
  return null;
}

/** Distance en kilomètres (haversine). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Les communes les plus proches du siège (hors siège), triées par distance. */
export function communesProches(siege: Commune, n = 14, maxKm = 18): (Commune & { km: number })[] {
  return COMMUNES.filter((c) => c.nom !== siege.nom)
    .map((c) => ({ ...c, km: Math.round(distanceKm(siege, c) * 10) / 10 }))
    .filter((c) => c.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}
