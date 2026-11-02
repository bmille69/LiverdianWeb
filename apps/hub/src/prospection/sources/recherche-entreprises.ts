import { HubError } from "../../domain/errors.ts";
import { ApiCache, type Compteur, type Reseau } from "../reseau.ts";
import { casseNom } from "../texte.ts";

/**
 * API Recherche d'entreprises (recherche-entreprises.api.gouv.fr) : gratuite, sans clé, données Sirene + RNE.
 * Limite publiée : 7 requêtes par seconde et par adresse IP ; on reste à 5 (intervalle de 200 ms), avec reprise sur 429.
 * Une page = 25 entreprises au plus ; l'API ne sert pas au-delà de 10 000 résultats par recherche.
 */
export const RECHERCHE_BASE = "https://recherche-entreprises.api.gouv.fr";
const DUREE_CACHE = 7 * 86400_000;
const PAR_PAGE = 25;

export type ZoneRecherche =
  | { type: "rayon"; lat: number; lon: number; rayonKm: number }
  | { type: "communes"; codes: string[] }
  | { type: "departements"; departements: string[] };

/** Un établissement trouvé, réduit à ce qui sert (minimisation RGPD : pas de date de naissance, un seul dirigeant). */
export type EtablissementSirene = {
  siren: string;
  siret: string;
  raisonSociale: string;
  nomCommercial: string | null;
  enseignes: string[];
  sigle: string | null;
  naf: string;
  dateCreation: string | null;
  dirigeant: string | null;
  adresse: { ligne: string | null; codePostal: string | null; commune: string; codeCommune: string | null };
  lat: number | null;
  lon: number | null;
  estSiege: boolean;
  effectif: string | null;
  categorie: string | null;
  etablissementsOuverts: number | null;
  natureJuridique: string | null;
  /** L'entreprise s'est opposée à l'usage commercial de ses données (RNE) : on ne la prospecte pas. */
  oppositionProspection: boolean;
  /** Diffusion partielle (personne physique ayant demandé la non-diffusion) : on ne la prospecte pas. */
  diffusible: boolean;
};

export const TRANCHES_EFFECTIF: Record<string, { libelle: string; max: number }> = {
  NN: { libelle: "non employeuse", max: 0 },
  "00": { libelle: "0 salarié", max: 0 },
  "01": { libelle: "1 ou 2 salariés", max: 2 },
  "02": { libelle: "3 à 5 salariés", max: 5 },
  "03": { libelle: "6 à 9 salariés", max: 9 },
  "11": { libelle: "10 à 19 salariés", max: 19 },
  "12": { libelle: "20 à 49 salariés", max: 49 },
  "21": { libelle: "50 à 99 salariés", max: 99 },
  "22": { libelle: "100 à 199 salariés", max: 199 },
  "31": { libelle: "200 à 249 salariés", max: 249 },
  "32": { libelle: "250 à 499 salariés", max: 499 },
  "41": { libelle: "500 à 999 salariés", max: 999 },
  "42": { libelle: "1 000 à 1 999 salariés", max: 1999 },
  "51": { libelle: "2 000 à 4 999 salariés", max: 4999 },
  "52": { libelle: "5 000 à 9 999 salariés", max: 9999 },
  "53": { libelle: "10 000 salariés et plus", max: 100000 },
};

type BrutEtab = {
  siret: string;
  est_siege: boolean;
  etat_administratif: string;
  activite_principale?: string;
  adresse?: string;
  code_postal?: string | null;
  commune?: string | null;
  libelle_commune?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  nom_commercial?: string | null;
  liste_enseignes?: string[] | null;
  tranche_effectif_salarie?: string | null;
  statut_diffusion_etablissement?: string | null;
};
type BrutEntreprise = {
  siren: string;
  nom_complet: string;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  activite_principale?: string;
  categorie_entreprise?: string | null;
  date_creation?: string | null;
  dirigeants?: { type_dirigeant?: string; nom?: string; prenoms?: string; qualite?: string | null }[];
  nature_juridique?: string | null;
  nombre_etablissements_ouverts?: number | null;
  tranche_effectif_salarie?: string | null;
  statut_diffusion?: string | null;
  opposition_diffusion_commerciale?: boolean | null;
  siege?: BrutEtab;
  matching_etablissements?: BrutEtab[];
};
type BrutPage = { results: BrutEntreprise[]; total_results: number; total_pages: number; page: number };

/** « 12 RUE DE LA PAIX 69500 BRON » → « 12 rue de la Paix » sans le code postal ni la commune. */
export function ligneAdresse(adresse: string | null | undefined, codePostal: string | null | undefined): string | null {
  if (!adresse) return null;
  let a = adresse.trim();
  if (codePostal) {
    const i = a.lastIndexOf(codePostal);
    if (i > 0) a = a.slice(0, i).trim();
  }
  a = a.replace(/[,\s]+$/, "");
  return a ? casseVoie(a) : null;
}

const ABREV: Record<string, string> = { AV: "avenue", BD: "boulevard", CHE: "chemin", IMP: "impasse", PL: "place", RTE: "route", ALL: "allée", CRS: "cours", QU: "quai", SQ: "square", PAS: "passage", LOT: "lotissement", RES: "résidence" };
function casseVoie(a: string): string {
  if (a !== a.toUpperCase()) return a;
  return a
    .split(/\s+/)
    .map((m, i) => {
      if (ABREV[m] && i <= 2) return ABREV[m];
      if (/^(RUE|AVENUE|BOULEVARD|CHEMIN|IMPASSE|PLACE|ROUTE|ALLEE|COURS|QUAI|ZAC|ZA|ZI|BIS|TER|ETG|BAT)$/.test(m)) return m === "ZAC" || m === "ZA" || m === "ZI" ? m : m.toLowerCase();
      if (/^(DE|DU|DES|LA|LE|LES|D|L|EN|SUR|ET|AUX|AU)$/.test(m)) return m.toLowerCase();
      if (/^\d/.test(m)) return m;
      return m.charAt(0) + m.slice(1).toLowerCase();
    })
    .join(" ");
}

function dirigeantDe(e: BrutEntreprise): string | null {
  const p = e.dirigeants?.find((d) => d.type_dirigeant === "personne physique" && d.nom);
  if (!p) return null;
  const prenom = (p.prenoms ?? "").split(/\s+/)[0] ?? "";
  return casseNom(`${prenom} ${p.nom!.replace(/\s*\(.*\)$/, "")}`.trim());
}

function versEtablissement(e: BrutEntreprise, et: BrutEtab): EtablissementSirene {
  const num = (s: string | null | undefined) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
  const date = e.date_creation && e.date_creation !== "1900-01-01" ? e.date_creation : null;
  return {
    siren: e.siren,
    siret: et.siret,
    raisonSociale: casseNom(e.nom_raison_sociale || e.nom_complet.replace(/\s*\(.*\)$/, ""))!,
    nomCommercial: casseNom(et.nom_commercial ?? et.liste_enseignes?.[0] ?? null),
    enseignes: (et.liste_enseignes ?? []).map((x) => casseNom(x)!).slice(0, 3),
    sigle: e.sigle ?? null,
    naf: et.activite_principale ?? e.activite_principale ?? "",
    dateCreation: date,
    dirigeant: dirigeantDe(e),
    adresse: { ligne: ligneAdresse(et.adresse, et.code_postal), codePostal: et.code_postal ?? null, commune: et.libelle_commune ?? "", codeCommune: et.commune ?? null },
    lat: num(et.latitude),
    lon: num(et.longitude),
    estSiege: !!et.est_siege,
    effectif: et.tranche_effectif_salarie ?? e.tranche_effectif_salarie ?? null,
    categorie: e.categorie_entreprise ?? null,
    etablissementsOuverts: e.nombre_etablissements_ouverts ?? null,
    natureJuridique: e.nature_juridique ?? null,
    oppositionProspection: e.opposition_diffusion_commerciale === true,
    diffusible: (e.statut_diffusion ?? "O") === "O" && (et.statut_diffusion_etablissement ?? "O") === "O",
  };
}

export type PageResultat = { etablissements: EtablissementSirene[]; total: number; pages: number; depuisCache: boolean };

export class RechercheEntreprises {
  readonly #reseau: Reseau;
  readonly #cache: ApiCache;
  readonly #compteur: Compteur;
  readonly #base: string;
  constructor(deps: { reseau: Reseau; cache: ApiCache; compteur: Compteur; base?: string }) {
    this.#reseau = deps.reseau;
    this.#cache = deps.cache;
    this.#compteur = deps.compteur;
    this.#base = deps.base ?? RECHERCHE_BASE;
  }

  url(zone: ZoneRecherche, naf: string[], page: number): string {
    const p = new URLSearchParams();
    p.set("activite_principale", naf.join(","));
    p.set("etat_administratif", "A");
    p.set("per_page", String(PAR_PAGE));
    p.set("page", String(page));
    p.set("minimal", "true");
    p.set("include", "siege,dirigeants,matching_etablissements");
    if (zone.type === "rayon") {
      p.set("lat", String(zone.lat));
      p.set("long", String(zone.lon));
      p.set("radius", String(zone.rayonKm));
      return `${this.#base}/near_point?${p}`;
    }
    if (zone.type === "communes") p.set("code_commune", zone.codes.join(","));
    else p.set("departement", zone.departements.join(","));
    return `${this.#base}/search?${p}`;
  }

  /**
   * Une page de résultats : chaque entreprise donne ses établissements actifs correspondants (dans la zone).
   * Hors du rayon, fermés ou d'un autre code NAF : écartés ici.
   */
  async page(zone: ZoneRecherche, naf: string[], page: number, opts: { signal?: AbortSignal; campagneId?: string | null } = {}): Promise<PageResultat> {
    const url = this.url(zone, naf, page);
    const cle = ApiCache.cle("sirene", url);
    let brut = this.#cache.get<BrutPage>(cle);
    const depuisCache = !!brut;
    if (!brut) {
      const res = await this.#reseau.requete(url, { signal: opts.signal, essais: 6 });
      this.#compteur.noter("sirene", { campagneId: opts.campagneId, statut: res.status });
      if (!res.ok) {
        const corps = await res.text().catch(() => "");
        throw new HubError(`API Recherche d'entreprises : réponse ${res.status} ${corps.slice(0, 160)}`, 502);
      }
      brut = (await res.json()) as BrutPage;
      this.#cache.set(cle, "sirene", brut, DUREE_CACHE);
    }
    const out: EtablissementSirene[] = [];
    for (const e of brut.results ?? []) {
      const etabs = e.matching_etablissements?.length ? e.matching_etablissements : e.siege ? [e.siege] : [];
      for (const et of etabs) {
        if (et.etat_administratif !== "A") continue;
        if (et.activite_principale && !naf.includes(et.activite_principale)) continue;
        out.push(versEtablissement(e, et));
      }
    }
    return { etablissements: out, total: brut.total_results ?? 0, pages: brut.total_pages ?? 0, depuisCache };
  }
}
