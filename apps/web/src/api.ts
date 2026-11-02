/** Types et accès à l'API du hub. Les messages d'erreur du hub sont déjà en français : on les remonte tels quels. */

export type Statut = "prospect" | "qualifie" | "maquette" | "contacte" | "client" | "perdu" | "exclu";
export type Source = "saisie" | "sirene" | "places" | "audit";
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

export type SiteStatut = "brouillon" | "en_fabrication" | "a_valider" | "demo_en_ligne" | "livre" | "archive";
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
