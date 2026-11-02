/** Types et accès à l'API du hub. Les messages d'erreur du hub sont déjà en français : on les remonte tels quels. */

export type Statut = "prospect" | "qualifie" | "maquette" | "contacte" | "client" | "perdu" | "exclu";
export type Source = "saisie" | "sirene" | "places" | "osm" | "audit";
export type Jour = "lundi" | "mardi" | "mercredi" | "jeudi" | "vendredi" | "samedi" | "dimanche";

export type Company = {
  id: string;
  raisonSociale: string;
  nomCommercial: string | null;
  siren: string | null;
  naf: string | null;
  metier: string | null;
  dateCreation: string | null;
  dirigeant: string | null;
  telephone: string | null;
  email: string | null;
  siteActuel: string | null;
  adresse: { ligne: string | null; codePostal: string | null; commune: string | null };
  horaires: Partial<Record<Jour, string>>;
  google: { valeur: number | null; nombre: number | null; url: string | null } | null;
  zone: { commune: string | null; voisines: string[] };
  statut: Statut;
  score: number | null;
  notes: string | null;
  sources: Partial<Record<string, Source>>;
  createdAt: string;
  updatedAt: string;
};

export type SiteStatut = "brouillon" | "en_fabrication" | "a_valider" | "a_revoir" | "demo_prete" | "demo_en_ligne" | "livre" | "archive";
export type Site = {
  id: string;
  companyId: string;
  companyName: string;
  recette: string;
  statut: SiteStatut;
  dossier: string;
  qualiteNote: number | null;
  urlDemo: string | null;
  urlProd: string | null;
  createdAt: string;
  updatedAt: string;
  /** Liste des sites : une vignette (capture) existe. */
  vignette?: boolean;
};

/** Atelier : fabrication d'un site par une recette (machine à états du hub). */
export type EtatFabrication = "en_cours" | "a_valider" | "validee" | "arretee";
export type EtatPasse = "en_file" | "en_cours" | "ok" | "echec" | "sautee" | "renvoi" | "erreur" | "arret" | "annulee";
export type Consigne = { origine: string; texte: string };
export type Passe = { n: number; etape: string; tour: number; etat: EtatPasse; jobId: string; creeLe: string; debut: string | null; fin: string | null; resume: string | null; sortie?: unknown };
export type Tour = { n: number; origine: "auto" | "demande"; consignes: Consigne[]; fichier: string; debut: string; fin: string | null; resultat: "ok" | "echec" | null };
export type Fabrication = {
  id: string;
  siteId: string;
  recette: string;
  etat: EtatFabrication;
  etape: string | null;
  jobId: string | null;
  tour: number;
  motif: string | null;
  motifType: "controle" | "technique" | "schema" | "annulee" | null;
  exigences: string[];
  passes: Passe[];
  tours: Tour[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  companyName?: string;
  companyId?: string;
};
export type EtapeMeta = { id: string; label: string; detail: string; agent: string | null; groupe: "fabrication" | "controle" | "correction" };
export type RecetteAtelier = { id: string; nom: string; sequence: string[]; correction: { etape: string; retour: string; toursMax: number }; refaire: string; seuils: Record<string, number>; etapes: EtapeMeta[] };
export type SiteDetail = {
  site: Site;
  fabrication: Fabrication | null;
  fichiers: { apercu: boolean; vignette: boolean; captures: string[]; pleinePage: string[] };
  jobs: Job[];
  activite: HubEvent[];
  /** Dernière mesure d'unicité du site (registre des sites), null si jamais mesurée. */
  unicite: Unicite | null;
};
export type Unicite = {
  ok: boolean;
  mesureLe: string;
  plusProche: { site: string; commune: string; origine: string; km: number | null; distance: number; seuil: number | null } | null;
  texteMax: { site: string; commune: string; similarite: number; seuil: number } | null;
  conflits: number;
  comparaisons: number;
};

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobLogLine = { at: string; kind: "info" | "tool" | "text" | "error"; text: string };
export type Job = {
  id: string;
  type: string;
  subject: string | null;
  label: string;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  input: unknown;
  output: unknown;
  progress: { label: string | null; pct: number | null; lines: JobLogLine[] };
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type HubEvent = { seq: number; at: string; type: string; subject: string | null; message: string; data: Record<string, unknown> | null };

export type Agent = {
  id: string;
  nom: string;
  resume: string;
  role: string;
  provider: "claude" | "deepseek";
  modele: string;
  modeleDefaut: string;
  modes: string[];
  couleur: string;
  icone: string;
  skills: { path: string; name: string; description: string }[];
  skillsManquants: string[];
  cout7j: number;
  appels7j: number;
};

export type AgentCall = {
  id: number;
  at: string;
  agent: string;
  model: string;
  provider: string;
  mode: string;
  durationMs: number;
  costUsd: number | null;
  ok: boolean;
  jobId: string | null;
  summary: string | null;
  error: string | null;
};

export type SkillInfo = { path: string; name: string; description: string; category: string; agents: string[] };
export type Skill = SkillInfo & { body: string };

export type Meta = {
  statuts: { id: Statut; label: string }[];
  sources: Source[];
  champsSources: string[];
  jours: Jour[];
  siteStatuts: { id: SiteStatut; label: string }[];
  recettes: { id: string; nom: string }[];
  recettesAtelier: RecetteAtelier[];
  apercuPort: number | null;
  agents: { id: string; nom: string; couleur: string; icone: string }[];
};

export type Overview = {
  entreprises: { total: number; parStatut: Record<Statut, number> };
  aValider: Site[];
  enCours: Job[];
  echecs: Job[];
  activite: HubEvent[];
};

export type Settings = {
  settings: { "jobs.parallel": number; "agents.parallel": number; "agents.models": Record<string, string>; "atelier.timeoutMinutes": number };
  deepseek: boolean;
  dataDir: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly issues: { path: string; message: string }[];
  constructor(message: string, status: number, issues: { path: string; message: string }[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Le hub ne répond pas. Est-il lancé ?", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
  if (!res.ok) throw new ApiError(data.error ?? `Erreur ${res.status}`, res.status, data.issues ?? []);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};
