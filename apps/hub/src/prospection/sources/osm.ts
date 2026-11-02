import { ApiCache, messageReseau, type Compteur, type Reseau } from "../reseau.ts";

/**
 * OpenStreetMap via Overpass (gratuit, données sous licence ODbL : on en garde le site web et le téléphone, avec
 * la source « osm »). Une seule requête par campagne et par zone, en cache 7 jours. Les serveurs publics sont
 * souvent saturés : on essaie plusieurs instances, avec attente ; si aucune ne répond, l'étape est sautée et la
 * campagne continue (le motif est affiché).
 */
export const OVERPASS_SERVEURS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const DUREE_CACHE = 7 * 86400_000;

export type LieuOsm = {
  id: string;
  nom: string;
  lat: number | null;
  lon: number | null;
  site: string | null;
  telephone: string | null;
  adresse: { ligne: string | null; codePostal: string | null; commune: string | null };
  etiquette: string;
};

export type ZoneOsm = { type: "cercle"; lat: number; lon: number; rayonKm: number }[] | { type: "departements"; departements: string[] };

type BrutElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function requeteOverpass(zone: ZoneOsm, etiquettes: [string, string][]): string {
  const filtres = [...new Set(etiquettes.map(([k, v]) => `["${k}"="${v}"]`))];
  const zones = Array.isArray(zone) ? zone.map((c) => `(around:${Math.round(c.rayonKm * 1000)},${c.lat},${c.lon})`) : ["(area.zone)"];
  const entete = Array.isArray(zone) ? "" : `(${zone.departements.map((d) => `area["ISO3166-2"="FR-${d}"];`).join("")})->.zone;`;
  const corps = zones.flatMap((z) => filtres.map((f) => `nwr${z}${f}["name"];`)).join("");
  return `[out:json][timeout:90];${entete}(${corps});out center tags;`;
}

export class OpenStreetMap {
  readonly #reseau: Reseau;
  readonly #cache: ApiCache;
  readonly #compteur: Compteur;
  readonly #serveurs: string[];
  constructor(deps: { reseau: Reseau; cache: ApiCache; compteur: Compteur; serveurs?: string[] }) {
    this.#reseau = deps.reseau;
    this.#cache = deps.cache;
    this.#compteur = deps.compteur;
    this.#serveurs = deps.serveurs ?? OVERPASS_SERVEURS;
  }

  async lieux(zone: ZoneOsm, etiquettes: [string, string][], opts: { signal?: AbortSignal; campagneId?: string | null } = {}): Promise<{ lieux: LieuOsm[]; depuisCache: boolean; serveur: string | null }> {
    if (!etiquettes.length) return { lieux: [], depuisCache: true, serveur: null };
    const q = requeteOverpass(zone, etiquettes);
    const cle = ApiCache.cle("osm", q);
    const hit = this.#cache.get<BrutElement[]>(cle);
    if (hit) return { lieux: hit.map(versLieu).filter((l): l is LieuOsm => !!l), depuisCache: true, serveur: null };
    const erreurs: string[] = [];
    for (const serveur of this.#serveurs) {
      try {
        const res = await this.#reseau.requete(serveur, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(q)}`,
          signal: opts.signal,
          timeoutMs: 100_000,
          essais: 2,
        });
        this.#compteur.noter("osm", { campagneId: opts.campagneId, statut: res.status });
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          erreurs.push(`${new URL(serveur).host} : ${res.status}`);
          continue;
        }
        const data = (await res.json()) as { elements?: BrutElement[] };
        const elements = data.elements ?? [];
        this.#cache.set(cle, "osm", elements, DUREE_CACHE);
        return { lieux: elements.map(versLieu).filter((l): l is LieuOsm => !!l), depuisCache: false, serveur };
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        erreurs.push(`${new URL(serveur).host} : ${messageReseau(err)}`);
      }
    }
    throw new Error(`OpenStreetMap indisponible (${erreurs.join(" ; ")})`);
  }
}

function versLieu(e: BrutElement): LieuOsm | null {
  const t = e.tags ?? {};
  if (!t.name) return null;
  const lat = e.lat ?? e.center?.lat ?? null;
  const lon = e.lon ?? e.center?.lon ?? null;
  const ligne = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
  return {
    id: `${e.type}/${e.id}`,
    nom: t.name,
    lat,
    lon,
    site: t.website ?? t["contact:website"] ?? t.url ?? null,
    telephone: t.phone ?? t["contact:phone"] ?? t["contact:mobile"] ?? null,
    adresse: { ligne, codePostal: t["addr:postcode"] ?? null, commune: t["addr:city"] ?? null },
    etiquette: Object.entries(t).find(([k]) => k === "craft" || k === "shop" || k === "office")?.join("=") ?? "",
  };
}
