import { useMemo, useState } from "react";
import type { Fabrication, Job, JobState, Site, SiteStatut } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import { Link, usePath } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Empty, ErrorNote, PageHeader, Skeleton, timeAgo } from "../ui/common.tsx";
import { JobDrawer, JobRow } from "./jobs.tsx";
import { JOB_STATE, RECETTE_LABEL, SITE_STATUT, SiteBadge, visitesLabel } from "./labels.tsx";
import { duree, SiteScreen } from "./SiteScreen.tsx";

/** Atelier : les fabrications (en cours, à valider, arrêtées), puis la file de travaux en direct. */
export function AtelierPage() {
  const { jobs: live, meta } = useLive();
  const [filter, setFilter] = useState<JobState | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ jobs: Job[] }>("/api/jobs?limit=100", ["jobs"]);
  const fabs = useApi<{ fabrications: Fabrication[] }>("/api/fabrications", ["sites", "jobs"]);
  const jobs = useMemo(() => {
    const m = new Map((data?.jobs ?? []).map((j) => [j.id, j]));
    for (const j of live.values()) m.set(j.id, j);
    return [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, live]);
  const recette = meta?.recettesAtelier[0];
  const all = fabs.data?.fabrications ?? [];
  const groupes: [Fabrication["etat"], string, string][] = [
    ["en_cours", "En fabrication", "Aucune maquette en fabrication. Lancez « Créer la maquette » depuis une fiche entreprise."],
    ["en_attente", "En attente du quota Claude", ""],
    ["a_valider", "À valider", "Rien n'attend votre validation."],
    ["arretee", "Arrêtées — à revoir", ""],
  ];
  const actifs = jobs.filter((j) => j.state === "running" || j.state === "queued");
  const shown = jobs.filter((j) => (filter ? j.state === filter : !(j.state === "running" || j.state === "queued")));

  return (
    <div className="page">
      <PageHeader title="Atelier" subtitle="La fabrication des maquettes : une chaîne d'agents contrôlée, étape par étape, reprise après un redémarrage." />
      {(error || fabs.error) && <ErrorNote text={error ?? fabs.error ?? ""} onRetry={reload} />}

      {recette && (
        <div className="atelier-intro panel">
          <div className="pipeline" aria-label={`Chaîne de la recette ${recette.nom}`}>
            {recette.sequence.map((id, i) => {
              const e = recette.etapes.find((x) => x.id === id)!;
              const a = meta?.agents.find((x) => x.id === e.agent);
              return (
                <div key={id} className="pipe-step" title={e.detail}>
                  <span className="pipe-n" style={a ? { background: a.couleur, color: "#0b0d0f" } : undefined}>
                    {i + 1}
                  </span>
                  <span>{e.label}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            {recette.nom} · Lighthouse mobile ≥ {recette.seuils.lighthouse}, axe sans violation grave, revue visuelle ≥ {recette.seuils.visuelMoyenne}/5 (aucun critère &lt; {recette.seuils.visuelMin}), aucun fait sans source, aucun
            problème UX majeur. Un contrôle raté renvoie en correction, {recette.correction.toursMax} tours au plus.
          </p>
        </div>
      )}

      {groupes.map(([etat, titre, vide]) => {
        const liste = all.filter((f) => f.etat === etat);
        if (!liste.length && !vide) return null;
        return (
          <section key={etat} className="section">
            <h2 className="section-title">
              {titre} {liste.length > 0 && <span className={`count${etat === "en_cours" ? " live" : ""}`}>{liste.length}</span>}
            </h2>
            {fabs.loading ? (
              <Skeleton rows={2} />
            ) : liste.length === 0 ? (
              <p className="muted">{vide}</p>
            ) : (
              <div className="list">
                {liste.map((f) => (
                  <FabricationRow key={f.id} f={f} job={f.jobId ? live.get(f.jobId) : undefined} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">
            Travaux {actifs.length > 0 && <span className="count live">{actifs.length}</span>}
          </h2>
          <div className="chips">
            {(["", "done", "failed", "cancelled"] as const).map((s) => (
              <button key={s} className={`chip${filter === s ? " on" : ""}`} onClick={() => setFilter(s)}>
                {s === "" ? "Tous" : JOB_STATE[s].label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <Skeleton rows={2} />
        ) : (
          <>
            {actifs.length > 0 && !filter && (
              <div className="list spaced-b">
                {actifs.map((j) => (
                  <JobRow key={j.id} job={j} onOpen={setOpen} />
                ))}
              </div>
            )}
            {shown.length === 0 ? (
              <Empty icon="atelier" title="Aucun travail terminé">
                Chaque étape d'une fabrication est un travail, avec son journal.
              </Empty>
            ) : (
              <div className="list">
                {shown.slice(0, 50).map((j) => (
                  <JobRow key={j.id} job={j} onOpen={setOpen} />
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <JobDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function FabricationRow({ f, job }: { f: Fabrication; job: Job | undefined }) {
  const { meta } = useLive();
  const recette = meta?.recettesAtelier.find((r) => r.id === f.recette);
  const etape = recette?.etapes.find((e) => e.id === f.etape);
  const faites = new Set(f.passes.filter((p) => p.tour === 0 && (p.etat === "ok" || p.etat === "sautee")).map((p) => p.etape)).size;
  const total = recette?.sequence.length ?? 1;
  const fin = f.finishedAt ? new Date(f.finishedAt).getTime() : Date.now();
  return (
    <Link to={`/sites/${f.siteId}`} className="list-row fab-row">
      <div className="fab-row-main">
        <div className="row-title">
          {f.companyName}
          {f.tour > 0 && <span className="badge tone-amber">tour {f.tour}</span>}
        </div>
        <div className="row-sub ellipsis">
          {f.etat === "en_cours" ? (
            <>
              <strong>{etape?.label ?? "…"}</strong> · {job?.progress.lines.at(-1)?.text ?? job?.progress.label ?? "en attente"}
            </>
          ) : f.etat === "arretee" ? (
            <span className="text-danger">{f.motif}</span>
          ) : f.etat === "en_attente" ? (
            <span className="text-amber">{f.motif}</span>
          ) : (
            <>Tous les contrôles passent</>
          )}
        </div>
        {f.etat === "en_cours" && (
          <div className="progress">
            <div className="progress-bar" style={{ width: `${Math.min(100, (faites / total) * 100)}%` }} />
          </div>
        )}
      </div>
      <span className="muted small mono">{duree(fin - new Date(f.createdAt).getTime())}</span>
      <Icon name="chevron" size={16} className="row-chevron" />
    </Link>
  );
}

/** Sites : la liste, et l'écran d'un site (/sites/:id). */
export function SitesPage() {
  const path = usePath();
  const id = path.startsWith("/sites/") ? path.slice("/sites/".length) : null;
  if (id) return <SiteScreen id={id} />;
  return <SitesList />;
}

function SitesList() {
  const [statut, setStatut] = useState<SiteStatut | "">("");
  const { data, error, loading, reload } = useApi<{ sites: Site[] }>("/api/sites", ["sites"]);
  const all = data?.sites ?? [];
  const rows = all.filter((s) => !statut || s.statut === statut);
  return (
    <div className="page">
      <PageHeader title="Sites" subtitle="Tous les sites, des brouillons aux sites livrés." />
      <div className="toolbar">
        <div className="chips">
          <button className={`chip${statut === "" ? " on" : ""}`} onClick={() => setStatut("")}>
            Tous <span className="chip-n">{all.length}</span>
          </button>
          {(Object.keys(SITE_STATUT) as SiteStatut[]).map((s) => {
            const n = all.filter((x) => x.statut === s).length;
            return (
              <button key={s} className={`chip${statut === s ? " on" : ""}`} onClick={() => setStatut(statut === s ? "" : s)}>
                <span className={`dot tone-${SITE_STATUT[s].tone}`} />
                {SITE_STATUT[s].label}
                {n > 0 && <span className="chip-n">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading ? (
        <Skeleton rows={4} />
      ) : all.length === 0 ? (
        <Empty
          icon="sites"
          title="Aucun site"
          action={
            <Link to="/entreprises" className="btn btn-ghost">
              Ouvrir les entreprises <Icon name="arrow" size={15} />
            </Link>
          }
        >
          Un site naît d'une fiche entreprise : « Créer la maquette » lance sa fabrication.
        </Empty>
      ) : (
        <div className="site-cards">
          {rows.map((s) => (
            <Link key={s.id} to={`/sites/${s.id}`} className="site-card">
              <div className="site-thumb">
                {s.vignette ? (
                  <img src={`/files/sites/${s.id}/.atelier/vignette.jpg?v=${encodeURIComponent(s.updatedAt)}`} alt={`Aperçu du site de ${s.companyName}`} loading="lazy" />
                ) : (
                  <span className="site-thumb-empty">
                    <Icon name="sites" size={22} />
                  </span>
                )}
              </div>
              <div className="site-card-body">
                <div className="site-card-top">
                  <span className="row-title ellipsis">{s.companyName}</span>
                  <SiteBadge statut={s.statut} />
                </div>
                <div className="row-sub">
                  {RECETTE_LABEL[s.recette] ?? s.recette}
                  {s.qualiteNote != null && <> · qualité {s.qualiteNote}</>} · {timeAgo(s.updatedAt)}
                </div>
                {s.demo?.etat === "en_ligne" && (
                  <div className="site-card-demo">
                    <Icon name="external" size={13} />
                    <a href={s.demo.url} target="_blank" rel="noreferrer" className="mono" onClick={(e) => e.stopPropagation()}>
                      {s.demo.url.replace(/^https:\/\//, "")}
                    </a>
                    <span className="muted"> · {visitesLabel(s.demo)}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

