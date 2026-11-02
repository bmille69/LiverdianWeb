import type { AgentService } from "../agents/agent-service.ts";
import type { Company } from "../domain/companies.ts";
import type { JobContext } from "../jobs/job-queue.ts";
import type { KitRunner } from "./kit.ts";

/**
 * Une recette décrit un type de site (VISION §2.2) : ses étapes, leur ordre, leurs agents, ses contrôles et
 * ses seuils. Le moteur (`moteur.ts`) ne connaît aucune recette en particulier : ajouter un type de site,
 * c'est écrire une nouvelle recette et l'inscrire dans `recettes/index.ts`.
 */

/** Une consigne de correction, transmise mot pour mot à l'Intégrateur. */
export type Consigne = { origine: string; texte: string };

/** Ce qu'une étape rend au moteur, qui décide seul de la suite. */
export type Issue =
  /** Étape faite : on passe à la suivante. */
  | { issue: "suite"; resume: string; sortie?: unknown }
  /** Étape sans objet cette fois-ci (ex. pas de sur-mesure demandé). */
  | { issue: "sautee"; resume: string; sortie?: unknown }
  /**
   * Résultat d'un contrôle. `ok: false` ne coupe pas la chaîne des contrôles (on rassemble tout pour un seul tour
   * de correction), sauf `bloqueLaSuite` (ex. build cassé : plus rien à regarder).
   */
  | { issue: "controle"; ok: boolean; resume: string; sortie?: unknown; consignes: Consigne[]; bloqueLaSuite?: boolean }
  /** Refus renvoyé à l'étape d'un agent, avec le message exact (une seule fois par étape). */
  | { issue: "renvoi"; vers: string; message: string; resume: string; sortie?: unknown; cle?: string }
  /** Arrêt « à revoir » sans correction automatique possible. */
  | { issue: "arret"; motif: string; resume: string; sortie?: unknown };

export type EtapeContexte = {
  fabricationId: string;
  siteId: string;
  siteDir: string;
  sitesDir: string;
  company: Company;
  recette: Recette;
  /** Tour de correction en cours (0 = première fabrication). */
  tour: number;
  /** Message de refus à traiter par cette étape (renvoi), mot pour mot. */
  renvoi: string | null;
  /** Consignes du tour de correction en cours (étape de correction seulement). */
  consignes: Consigne[];
  /** Exigences du propriétaire (« Demander des modifications »), mot pour mot, à respecter et à vérifier. */
  exigences: string[];
  /** Refaire depuis la direction artistique : le design précédent, à ne pas reproduire. */
  refaire: boolean;
  agents: Pick<AgentService, "ask" | "atelier">;
  kit: KitRunner;
  job: JobContext;
  now: () => Date;
};

export type EtapeDef = {
  id: string;
  label: string;
  detail: string;
  /** Agent qui travaille à cette étape (null = code). */
  agent: string | null;
  /** Groupe d'affichage : fabrication, contrôle ou correction. */
  groupe: "fabrication" | "controle" | "correction";
  /** Nombre d'essais du travail en cas d'erreur technique (CLI qui tombe, délai dépassé). */
  essais?: number;
  run(ctx: EtapeContexte): Promise<Issue>;
};

export type Recette = {
  id: string;
  nom: string;
  description: string;
  /** Chaîne principale, dans l'ordre. Arrivé au bout : décision (à valider ou correction). */
  sequence: string[];
  etapes: Record<string, EtapeDef>;
  correction: { etape: string; retour: string; toursMax: number };
  /** Étape de départ de « Refaire ». */
  refaire: string;
  /** Seuils affichés et appliqués par les étapes de contrôle de la recette. */
  seuils: Record<string, number>;
};
