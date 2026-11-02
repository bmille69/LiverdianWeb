import type { Demo, JobState, SiteStatut, Source, Statut } from "../api.ts";
import { Icon } from "../ui/Icon.tsx";
import { timeAgo } from "../ui/common.tsx";

export const STATUT: Record<Statut, { label: string; tone: string }> = {
  prospect: { label: "Prospect", tone: "neutral" },
  qualifie: { label: "Qualifié", tone: "blue" },
  maquette: { label: "Maquette", tone: "violet" },
  contacte: { label: "Contacté", tone: "amber" },
  client: { label: "Client", tone: "green" },
  perdu: { label: "Perdu", tone: "red" },
  exclu: { label: "Exclu", tone: "muted" },
};

export const SITE_STATUT: Record<SiteStatut, { label: string; tone: string }> = {
  brouillon: { label: "Brouillon", tone: "neutral" },
  en_fabrication: { label: "En fabrication", tone: "blue" },
  a_valider: { label: "À valider", tone: "amber" },
  a_revoir: { label: "À revoir", tone: "red" },
  demo_prete: { label: "Démo prête", tone: "green" },
  demo_en_ligne: { label: "Démo en ligne", tone: "violet" },
  livre: { label: "Livré", tone: "green" },
  archive: { label: "Archivé", tone: "muted" },
};

export const JOB_STATE: Record<JobState, { label: string; tone: string }> = {
  queued: { label: "En file", tone: "neutral" },
  running: { label: "En cours", tone: "blue" },
  done: { label: "Terminé", tone: "green" },
  failed: { label: "Échec", tone: "red" },
  cancelled: { label: "Annulé", tone: "muted" },
};

export const SOURCE_LABEL: Record<Source, string> = {
  saisie: "Saisie",
  sirene: "Sirene",
  places: "Google Places",
  osm: "OpenStreetMap",
  audit: "Audit du site",
};

export const RECETTE_LABEL: Record<string, string> = {
  "vitrine-artisan": "Vitrine artisan 1 page",
  "vitrine-pro": "Vitrine Pro 5 pages",
};

export function Badge({ tone, children, dot }: { tone: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`badge tone-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
}

export function StatutBadge({ statut }: { statut: Statut }) {
  return (
    <Badge tone={STATUT[statut].tone} dot>
      {STATUT[statut].label}
    </Badge>
  );
}

export function SiteBadge({ statut }: { statut: SiteStatut }) {
  return (
    <Badge tone={SITE_STATUT[statut].tone} dot>
      {SITE_STATUT[statut].label}
    </Badge>
  );
}

export function JobBadge({ state }: { state: JobState }) {
  return (
    <Badge tone={JOB_STATE[state].tone}>
      {state === "running" && <Icon name="spinner" size={12} className="spin" />}
      {JOB_STATE[state].label}
    </Badge>
  );
}

export function SourceTag({ source }: { source: Source | undefined }) {
  if (!source) return null;
  return (
    <span className={`source-tag src-${source}`} title={`Source : ${SOURCE_LABEL[source]}`}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

// ── Démo en ligne (brief F) ──────────────────────────────────────────────

/** « hier à 18 h 42 » pour une visite récente, « le 3 novembre » au-delà d'une semaine. */
export function derniereVisiteLabel(iso: string): string {
  const t = new Date(iso);
  const s = (t.getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return "à l'instant";
  if (abs < 86400 * 7) return `${timeAgo(iso)} à ${t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  return `le ${t.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

/** « Ouverte 3 fois, dernière visite hier à 18 h 42 » — compteur relevé depuis le Worker. */
export function visitesLabel(d: Demo): string {
  if (d.visites === 0) return "Pas encore ouverte";
  return `Ouverte ${d.visites} fois${d.derniereVisite ? ` · dernière visite ${derniereVisiteLabel(d.derniereVisite)}` : ""}`;
}
