import { HubError } from "../../domain/errors.ts";
import { ApiCache, type Compteur, type Reseau } from "../reseau.ts";

/**
 * Google Places API (New), `places:searchText`. Officielle et payante à l'usage : aucun scraping de Google Maps.
 * Le masque de champs est minimal ; il contient des champs « Enterprise » (téléphone, site, note, avis, horaires),
 * donc chaque requête est facturée au tarif Text Search Enterprise : 1 000 appels gratuits par mois, puis environ
 * 35 $ les 1 000 (tarif public de mars 2025, à vérifier sur la console Google Cloud). Le hub compte chaque appel
 * réellement envoyé et refuse de dépasser le plafond mensuel réglé (900 par défaut, sous le quota gratuit).
 * Les réponses restent 30 jours en cache (durée de conservation permise par les conditions de Google pour ces champs).
 */
export const PLACES_BASE = "https://places.googleapis.com";
export const PLACES_COUT_USD = 0.035;
export const PLACES_QUOTA_GRATUIT = 1000;
const DUREE_CACHE = 30 * 86400_000;

export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

export type FichePlaces = {
  id: string;
  nom: string;
  adresse: string | null;
  lat: number | null;
  lon: number | null;
  telephone: string | null;
  site: string | null;
  note: number | null;
  avis: number | null;
  horaires: string[];
  statut: string | null;
  url: string | null;
};

type BrutPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  googleMapsUri?: string;
};

export class PlafondPlacesAtteint extends HubError {
  constructor(plafond: number) {
    super(`Plafond mensuel Google Places atteint (${plafond} appels) : enrichissement Places arrêté jusqu'au mois prochain ou jusqu'à ce que le plafond soit relevé dans les réglages.`, 429);
  }
}

export class GooglePlaces {
  readonly #reseau: Reseau;
  readonly #cache: ApiCache;
  readonly #compteur: Compteur;
  readonly #cle: () => string | null;
  readonly #plafond: () => number;
  readonly #base: string;
  constructor(deps: { reseau: Reseau; cache: ApiCache; compteur: Compteur; cle: () => string | null; plafond: () => number; base?: string }) {
    this.#reseau = deps.reseau;
    this.#cache = deps.cache;
    this.#compteur = deps.compteur;
    this.#cle = deps.cle;
    this.#plafond = deps.plafond;
    this.#base = (deps.base ?? PLACES_BASE).replace(/\/$/, "");
  }

  get configure(): boolean {
    return !!this.#cle();
  }

  usage(): { appels: number; coutUsd: number; plafond: number; restants: number } {
    const m = this.#compteur.duMois("places");
    const plafond = this.#plafond();
    return { ...m, plafond, restants: Math.max(0, plafond - m.appels) };
  }

  /** Recherche « nom + commune » autour de l'établissement. Réponse en cache : pas de nouvel appel facturé. */
  async chercher(req: { texte: string; lat?: number | null; lon?: number | null; signal?: AbortSignal; campagneId?: string | null }): Promise<{ fiches: FichePlaces[]; depuisCache: boolean }> {
    const cle = this.#cle();
    if (!cle) throw new HubError("Google Places n'est pas configuré", 400);
    const body: Record<string, unknown> = { textQuery: req.texte, languageCode: "fr", regionCode: "FR", pageSize: 5 };
    if (req.lat != null && req.lon != null) body.locationBias = { circle: { center: { latitude: req.lat, longitude: req.lon }, radius: 3000 } };
    const cacheCle = ApiCache.cle("places", body, PLACES_FIELD_MASK);
    const hit = this.#cache.get<BrutPlace[]>(cacheCle);
    if (hit) return { fiches: hit.map(versFiche), depuisCache: true };

    const plafond = this.#plafond();
    if (this.#compteur.duMois("places").appels >= plafond) throw new PlafondPlacesAtteint(plafond);
    const res = await this.#reseau.requete(`${this.#base}/v1/places:searchText`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": cle, "x-goog-fieldmask": PLACES_FIELD_MASK },
      body: JSON.stringify(body),
      signal: req.signal,
      essais: 3,
    });
    // Un appel parti est compté (et facturé par Google) même s'il échoue côté réponse.
    this.#compteur.noter("places", { campagneId: req.campagneId, coutUsd: PLACES_COUT_USD, statut: res.status });
    if (!res.ok) {
      const texte = (await res.text().catch(() => "")).slice(0, 200);
      throw new HubError(`Google Places a répondu ${res.status}${res.status === 403 ? " (clé refusée ou API non activée)" : ""} : ${texte}`, 502);
    }
    const data = (await res.json()) as { places?: BrutPlace[] };
    const places = data.places ?? [];
    this.#cache.set(cacheCle, "places", places, DUREE_CACHE);
    return { fiches: places.map(versFiche), depuisCache: false };
  }
}

function versFiche(p: BrutPlace): FichePlaces {
  return {
    id: p.id,
    nom: p.displayName?.text ?? "",
    adresse: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lon: p.location?.longitude ?? null,
    telephone: p.nationalPhoneNumber ?? null,
    site: p.websiteUri ?? null,
    note: p.rating ?? null,
    avis: p.userRatingCount ?? null,
    horaires: p.regularOpeningHours?.weekdayDescriptions ?? [],
    statut: p.businessStatus ?? null,
    url: p.googleMapsUri ?? null,
  };
}

/** « 12 Rue X, 69500 Bron, France » → ligne et code postal, pour l'appariement. */
export function decouperAdresse(adresse: string | null): { ligne: string | null; codePostal: string | null } {
  if (!adresse) return { ligne: null, codePostal: null };
  const cp = /\b(\d{5})\b/.exec(adresse)?.[1] ?? null;
  return { ligne: adresse.split(",")[0]?.trim() ?? null, codePostal: cp };
}

const JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
/** « lundi: 08:00 – 18:00 » → { lundi: "08:00 – 18:00" } (format des fiches entreprise). */
export function horairesDePlaces(lignes: string[]): Partial<Record<(typeof JOURS_FR)[number], string>> {
  const out: Partial<Record<(typeof JOURS_FR)[number], string>> = {};
  for (const l of lignes) {
    const m = /^\s*([a-zéû]+)\s*:\s*(.+)$/i.exec(l);
    if (!m) continue;
    const jour = m[1]!.toLowerCase() as (typeof JOURS_FR)[number];
    if (JOURS_FR.includes(jour)) out[jour] = m[2]!.replace(/ | /g, " ").trim().slice(0, 120);
  }
  return out;
}
