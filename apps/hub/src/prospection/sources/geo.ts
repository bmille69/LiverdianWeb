import { trouverCommune } from "../../atelier/communes.ts";
import { HubError } from "../../domain/errors.ts";
import { ApiCache, type Reseau } from "../reseau.ts";
import { casseCommune } from "../texte.ts";

/**
 * Communes : API Découpage administratif (geo.api.gouv.fr, gratuite, sans clé). Sert à trouver le centre d'une
 * commune (zone « commune + rayon »), les codes INSEE d'une liste de communes, et le nom exact (accents) d'une
 * commune à partir de son code. Réponses en cache 30 jours. Sans réseau, repli sur la table locale de l'atelier.
 */
export type CommuneGeo = { code: string | null; nom: string; lat: number; lon: number; departement: string | null; codesPostaux: string[] };

const BASE = "https://geo.api.gouv.fr";
const DUREE = 30 * 86400_000;

type Brut = { nom: string; code: string; centre?: { coordinates: [number, number] }; codeDepartement?: string; codesPostaux?: string[] };

function versCommune(b: Brut): CommuneGeo | null {
  if (!b.centre) return null;
  return { code: b.code, nom: b.nom, lon: b.centre.coordinates[0], lat: b.centre.coordinates[1], departement: b.codeDepartement ?? null, codesPostaux: b.codesPostaux ?? [] };
}

export class Geo {
  readonly #reseau: Reseau;
  readonly #cache: ApiCache;
  readonly #base: string;
  constructor(reseau: Reseau, cache: ApiCache, base = BASE) {
    this.#reseau = reseau;
    this.#cache = cache;
    this.#base = base;
  }

  async #get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const cle = ApiCache.cle("geo", path);
    const hit = this.#cache.get<T>(cle);
    if (hit) return hit;
    const res = await this.#reseau.requete(`${this.#base}${path}`, { signal });
    if (!res.ok) throw new HubError(`geo.api.gouv.fr a répondu ${res.status}`, 502);
    const data = (await res.json()) as T;
    this.#cache.set(cle, "geo", data, DUREE);
    return data;
  }

  /** La commune la plus peuplée qui porte ce nom (ou ce code postal), avec son centre. */
  async commune(nom: string, signal?: AbortSignal): Promise<CommuneGeo> {
    const q = nom.trim();
    try {
      const path = /^\d{5}$/.test(q)
        ? `/communes?codePostal=${q}&fields=nom,code,centre,codeDepartement,codesPostaux&limit=5`
        : `/communes?nom=${encodeURIComponent(q)}&fields=nom,code,centre,codeDepartement,codesPostaux&boost=population&limit=5`;
      const list = (await this.#get<Brut[]>(path, signal)).map(versCommune).filter((c): c is CommuneGeo => !!c);
      const exacte = list.find((c) => c.nom.toLowerCase() === q.toLowerCase()) ?? list[0];
      if (exacte) return exacte;
    } catch (err) {
      if (signal?.aborted) throw err;
      const local = trouverCommune(q);
      if (local) return { code: null, nom: local.nom, lat: local.lat, lon: local.lon, departement: local.dep, codesPostaux: [] };
      throw err;
    }
    throw new HubError(`Commune introuvable : « ${q} »`, 400);
  }

  /** Nom exact d'une commune (ou d'un arrondissement de Lyon, Paris, Marseille) à partir de son code INSEE. */
  async nomDeCode(code: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const b = await this.#get<Brut | Brut[]>(`/communes/${encodeURIComponent(code)}?fields=nom`, signal);
      const r = Array.isArray(b) ? b[0] : b;
      if (!r?.nom) return null;
      // « Lyon 3e Arrondissement » → « Lyon » : le code postal porte l'arrondissement (69003), comme le reste du hub.
      return r.nom.replace(/\s+\d+(er|e)\s+Arrondissement$/i, "");
    } catch (err) {
      if (signal?.aborted) throw err;
      return null;
    }
  }
}

/** Repli quand geo.api ne répond pas : « LYON 3EME » → « Lyon », « SAINT-PRIEST » → « Saint-Priest ». */
export function communeLisible(libelle: string): string {
  return casseCommune(libelle.replace(/\s+\d+\s*(ER|EME|E)$/i, ""));
}
