import { useMemo, useState } from "react";
import { api, type HubEvent, type Job, type JobState, type Site, type SiteStatut } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import { Link, navigate, usePath } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Empty, ErrorNote, PageHeader, Skeleton, timeAgo } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { JobDrawer, JobRow } from "./jobs.tsx";
import { JOB_STATE, RECETTE_LABEL, SITE_STATUT, SiteBadge } from "./labels.tsx";
import { ActivityFeed } from "./Today.tsx";

/** Atelier : la file de travaux (fabrications, essais d'agents), en direct. */
export function AtelierPage() {
  const { jobs: live } = useLive();
  const [filter, setFilter] = useState<JobState | "">("");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ jobs: Job[] }>("/api/jobs?limit=100", ["jobs"]);
  const sites = useApi<{ sites: Site[] }>("/api/sites?statut=en_fabrication", ["sites"]);
  const jobs = useMemo(() => {
    const m = new Map((data?.jobs ?? []).map((j) => [j.id, j]));
    for (const j of live.values()) m.set(j.id, j);
    return [...m.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [data, live]);
  const active = jobs.filter((j) => j.state === "running" || j.state === "queued");
  const shown = jobs.filter((j) => (filter ? j.state === filter : !(j.state === "running" || j.state === "queued")));

  return (
    <div className="page">
      <PageHeader title="Atelier" subtitle="La fabrication des sites : chaque étape est un travail suivi, repris après un redémarrage." />
      {error && <ErrorNote text={error} onRetry={reload} />}

      <div className="atelier-intro panel">
        <div className="pipeline" aria-label="Chaîne de fabrication d'une maquette">
          {["Brief", "Direction artistique", "Rédaction", "Intégration", "Contrôles", "Relecture UX", "Aperçu"].map((s, i) => (
            <div key={s} className="pipe-step">
              <span className="pipe-n">{i + 1}</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
        <p className="muted small">La chaîne complète arrive avec la recette « Vitrine artisan ». En attendant, l'atelier montre la file de travaux et ses essais.</p>
      </div>

      <section className="section">
        <h2 className="section-title">
          En cours {active.length > 0 && <span className="count live">{active.length}</span>}
        </h2>
        {loading ? (
          <Skeleton rows={2} />
        ) : active.length === 0 ? (
          <Empty icon="atelier" title="L'atelier est calme">
            Aucun travail en cours. Essayez un agent depuis <Link to="/equipe">Équipe</Link> pour voir la file s'animer.
          </Empty>
        ) : (
          <div className="list">
            {active.map((j) => (
              <JobRow key={j.id} job={j} onOpen={setOpen} />
            ))}
          </div>
        )}
      </section>

      {sites.data && sites.data.sites.length > 0 && (
        <section className="section">
          <h2 className="section-title">Sites en fabrication</h2>
          <div className="list">
            {sites.data.sites.map((s) => (
              <Link key={s.id} to={`/sites/${s.id}`} className="list-row">
                <div>
                  <div className="row-title">{s.companyName}</div>
                  <div className="row-sub">{RECETTE_LABEL[s.recette] ?? s.recette}</div>
                </div>
                <SiteBadge statut={s.statut} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Historique</h2>
          <div className="chips">
            {(["", "done", "failed", "cancelled"] as const).map((s) => (
              <button key={s} className={`chip${filter === s ? " on" : ""}`} onClick={() => setFilter(s)}>
                {s === "" ? "Tous" : JOB_STATE[s].label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="muted">Aucun travail terminé pour l'instant.</p>
        ) : (
          <div className="list">
            {shown.slice(0, 50).map((j) => (
              <JobRow key={j.id} job={j} onOpen={setOpen} />
            ))}
          </div>
        )}
      </section>
      <JobDrawer id={open} onClose={() => setOpen(null)} />
    </div>
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
          Un site se crée depuis la fiche d'une entreprise (« Créer un site »).
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Type</th>
                <th>Statut</th>
                <th className="num">Qualité</th>
                <th>Adresse</th>
                <th>Mise à jour</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} onClick={() => navigate(`/sites/${s.id}`)}>
                  <td className="cell-title">{s.companyName}</td>
                  <td>{RECETTE_LABEL[s.recette] ?? s.recette}</td>
                  <td>
                    <SiteBadge statut={s.statut} />
                  </td>
                  <td className="num">{s.qualiteNote ?? <span className="muted">—</span>}</td>
                  <td className="muted">{s.urlProd ?? s.urlDemo ?? "—"}</td>
                  <td className="muted">{timeAgo(s.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const STEPS = [
  { id: "brief", label: "Brief", detail: "Données de la fiche, sources citées", agent: null },
  { id: "da", label: "Direction artistique", detail: "Thème, variantes, images", agent: "directeur-artistique" },
  { id: "texte", label: "Rédaction", detail: "Textes locaux, SEO, mentions", agent: "redacteur" },
  { id: "integration", label: "Intégration", detail: "Projet Astro construit", agent: "integrateur" },
  { id: "controles", label: "Contrôles", detail: "Faits, Lighthouse, accessibilité, captures", agent: "controleur-qa" },
  { id: "ux", label: "Relecture UX", detail: "Parcours mobile, conversion", agent: "relecteur-ux" },
  { id: "apercu", label: "Aperçu et validation", detail: "Mobile et bureau côte à côte", agent: null },
];

const CHECKS = ["Faits identiques aux sources", "Anti-gabarit (texte propre au site)", "Build, Lighthouse mobile ≥ 95, axe", "Captures 375 / 768 / 1440 relues", "Bandeau maquette + noindex", "Note de design et d'UX"];

/** Écran d'un site : emplacement des étapes, de l'aperçu et des contrôles (la chaîne arrive au brief suivant). */
function SiteScreen({ id }: { id: string }) {
  const toast = useToast();
  const { meta } = useLive();
  const { data, error, loading } = useApi<{ site: Site; jobs: Job[]; activite: HubEvent[] }>(`/api/sites/${id}`, ["sites", "jobs"]);
  const s = data?.site;
  const setStatut = async (statut: SiteStatut) => {
    try {
      await api.patch(`/api/sites/${id}`, { statut });
      toast.ok(`Statut : ${SITE_STATUT[statut].label}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const agentColor = (aid: string | null) => meta?.agents.find((a) => a.id === aid)?.couleur;
  return (
    <div className="page">
      <Link to="/sites" className="back-link">
        <Icon name="chevron" size={14} className="flip" /> Sites
      </Link>
      {error && <ErrorNote text={error} />}
      {loading || !s ? (
        <Skeleton rows={5} />
      ) : (
        <>
          <PageHeader
            title={s.companyName}
            subtitle={
              <span className="inline-meta">
                {RECETTE_LABEL[s.recette] ?? s.recette} · <SiteBadge statut={s.statut} /> · <Link to={`/entreprises/${s.companyId}`}>fiche entreprise</Link>
              </span>
            }
            actions={
              <select className="select-sm" value={s.statut} onChange={(e) => setStatut(e.target.value as SiteStatut)} aria-label="Statut du site">
                {(Object.keys(SITE_STATUT) as SiteStatut[]).map((k) => (
                  <option key={k} value={k}>
                    {SITE_STATUT[k].label}
                  </option>
                ))}
              </select>
            }
          />
          <div className="site-grid">
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="layers" size={16} /> Étapes
                </h2>
              </header>
              <ol className="steps">
                {STEPS.map((st, i) => (
                  <li key={st.id} className="step pending">
                    <span className="step-dot" style={st.agent ? { borderColor: agentColor(st.agent) } : undefined}>
                      {i + 1}
                    </span>
                    <div>
                      <div className="step-label">{st.label}</div>
                      <div className="step-detail">{st.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="eye" size={16} /> Aperçu
                </h2>
              </header>
              <div className="preview">
                <div className="device phone">
                  <div className="device-screen">
                    <span>Mobile · 375 px</span>
                  </div>
                </div>
                <div className="device desktop">
                  <div className="device-screen">
                    <span>Bureau · 1440 px</span>
                  </div>
                </div>
              </div>
              <p className="muted small">Les captures apparaîtront ici après la première fabrication.</p>
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="gauge" size={16} /> Contrôles
                </h2>
              </header>
              <ul className="checks">
                {CHECKS.map((c) => (
                  <li key={c}>
                    <span className="check-dot" />
                    {c}
                  </li>
                ))}
              </ul>
              <p className="muted small">Bloquants : un contrôle raté renvoie en correction.</p>
            </section>
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="activity" size={16} /> Historique
                </h2>
              </header>
              <ActivityFeed events={data.activite} limit={10} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
