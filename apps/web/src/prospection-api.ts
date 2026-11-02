/** Types de l'API de la prospection (/api/prospection/…). */
import type { Company } from "./api.ts";

export type StatutSite = "aucun" | "annuaire_seulement" | "injoignable" | "sans_https" | "non_mobile" | "date" | "correct" | "inconnu";
export type SiteCritere = "peu_importe" | "aucun" | "aucun_ou_defaillant" | "defaillant";

export type Zone = { type: "rayon"; commune: string; rayonKm: number } | { type: "departements"; departements: string[] } | { type: "communes"; communes: string[] };

export type Criteres = {
  metiers: string[];
  nafLibres: string[];
  zone: Zone;
  site: SiteCritere;
  ancienneteMinAns: number | null;
  avisMin: number | null;
  noteMin: number | null;
  artisansSeulement: boolean;
  siegeSeulement: boolean;
  exclusions: { franchises: boolean; dejaContactes: boolean; clients: boolean };
  limite: number;
  places: boolean;
  osm: boolean;
  audit: boolean;
  lighthouse: boolean;
};

export type Compteurs = {
  trouves?: number;
  pagesLues?: number;
  pagesTotal?: number;
  etablissements?: number;
  ecartes?: Record<string, number>;
  sources?: number;
  nouvelles?: number;
  enrichis?: number;
  osm?: { lieux: number; apparies: number; douteux: number; erreur?: string | null };
  places?: { appels: number; cache: number; apparies: number; douteux: number; saute?: string | null };
  avecSite?: number;
  sansSite?: number;
  audites?: number;
  qualifies?: number;
  aVerifier?: number;
  notes?: number;
  nettoyes?: number;
  aTraiter?: number;
  traites?: number;
};

export type Phase = "sourcing" | "enrichissement" | "audit" | "score" | "nettoyage";
export type Campagne = {
  id: string;
  nom: string;
  criteres: Criteres;
  etat: "brouillon" | "en_cours" | "terminee" | "erreur" | "annulee";
  phase: Phase | null;
  jobId: string | null;
  compteurs: Compteurs;
  erreur: string | null;
  lanceeLe: string | null;
  finieLe: string | null;
  createdAt: string;
  updatedAt: string;
  couts?: Record<string, { appels: number; coutUsd: number }>;
};

export type EtatProspection = {
  places: { configure: boolean; appels: number; coutUsd: number; plafond: number; restants: number; coutParAppelUsd: number; quotaGratuit: number; parEnvironnement: boolean };
  deepseek: { configure: boolean; parEnvironnement: boolean };
  lighthouse: boolean;
  purgeMois: number;
  maquettesParallele: number;
  enFabrication: number;
  prospects: number;
  qualifies: number;
  exclus: number;
  oppositions: number;
  metiers: { id: string; libelle: string; groupe: "batiment" | "services"; naf: string[] }[];
  siteCriteres: Record<SiteCritere, string>;
  phases: Record<Phase, string>;
  effectifs: Record<string, string>;
};

export type LigneProspect = {
  id: string;
  nom: string;
  raisonSociale: string;
  metier: string | null;
  naf: string | null;
  commune: string | null;
  codePostal: string | null;
  telephone: string | null;
  email: string | null;
  siteActuel: string | null;
  google: { valeur: number | null; nombre: number | null } | null;
  dateCreation: string | null;
  statut: Company["statut"];
  score: number | null;
  scoreBrut: number | null;
  qualifie: boolean;
  aVerifier: boolean;
  siteStatut: StatutSite | null;
  distanceKm: number | null;
  etape: string | null;
  motif: string | null;
  douteux: ("places" | "osm")[];
  maquettePossible: boolean;
  updatedAt: string;
};

export type Appariement = { score: number; statut: "fusionne" | "douteux" | "aucun"; detail: { nom: number; adresse: number | null; distanceM: number | null } };
export type LigneScore = { regle: string; libelle: string; points: number; applique: boolean; raison: string; incertain?: boolean };
export type Score = { total: number; seuil: number; qualifie: boolean; aVerifier: boolean; exclu: string | null; lignes: LigneScore[] };
export type Audit = {
  le: string;
  url: string;
  urlFinale: string | null;
  statutSite: StatutSite;
  https: boolean | null;
  certificat: "valide" | "invalide" | null;
  redirections: string[];
  mobile: boolean | null;
  anneeCopyright: number | null;
  derniereModif: string | null;
  technologies: string[];
  techDatee: string | null;
  email: string | null;
  emailsTrouves: string[];
  robots: "permis" | "interdit" | "absent";
  lighthouse: { performance: number; accessibilite: number; lcpMs: number | null } | { erreur: string } | null;
  franchise: { oui: boolean; raison: string } | null;
  vraiSite: string | null;
  flou: { fournisseur: string; modele: string } | { erreur: string } | null;
  pagesVisitees: string[];
  preuves: { constat: string; url: string | null }[];
};

export type FichePlaces = { id: string; nom: string; adresse: string | null; telephone: string | null; site: string | null; note: number | null; avis: number | null; url: string | null; statut: string | null };
export type LieuOsm = { id: string; nom: string; site: string | null; telephone: string | null; etiquette: string };

export type FicheProspect = {
  company: Company;
  prospect: {
    siret: string | null;
    sirene: { enseignes?: string[]; effectif?: string | null; categorie?: string | null; etablissementsOuverts?: number | null; estSiege?: boolean } | null;
    places: { fiche: FichePlaces | null; appariement: Appariement | null; le: string; decision?: "acceptee" | "refusee" } | null;
    osm: { lieu: LieuOsm | null; appariement: Appariement | null; le: string; decision?: "acceptee" | "refusee" } | null;
    audit: Audit | null;
    score: Score | null;
    exclusion: { motif: string; le: string } | null;
    siteStatut: StatutSite | null;
    qualifie: boolean;
    sourceLe: string;
    auditeLe: string | null;
  };
  campagnes: { id: string; nom: string; etape: string; motif: string | null; distanceKm: number | null }[];
  maquette: { possible: boolean; manques: string[] };
  file: EntreeFile[];
  sites: { id: string; statut: string; createdAt: string }[];
};

export type EntreeFile = { id: string; companyId: string; companyName: string; campagneId: string | null; etat: "en_attente" | "lancee" | "annulee" | "refusee"; siteId: string | null; message: string | null; createdAt: string; updatedAt: string };

export type Regle = { id: string; actif: boolean; points: number; param?: number; param2?: number };
export type Grille = { seuil: number; regles: Regle[] };
