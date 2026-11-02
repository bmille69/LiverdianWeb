import { useMemo, useState } from "react";
import type { HubEvent, Overview } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import { Link } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Empty, ErrorNote, PageHeader, Skeleton, timeAgo } from "../ui/common.tsx";
import { JobDrawer, JobRow } from "./jobs.tsx";
import { RECETTE_LABEL, SiteBadge, STATUT } from "./labels.tsx";

function greeting(): string {
  const h = new Date().getHours();
  return h < 6 ? "Bonne nuit" : h < 18 ? "Bonjour" : "Bonsoir";
}

const EVENT_ICON: [RegExp, string][] = [
  [/^company\./, "companies"],
  [/^site\./, "sites"],
  [/^job\.failed/, "alert"],
  [/^job\.done/, "check"],
  [/^job/, "atelier"],
  [/^agent\./, "bot"],
  [/^settings\./, "settings"],
  [/^hub\./, "zap"],
];

const STAT_LABEL: Record<"prospect" | "qualifie" | "contacte" | "client", [string, string]> = {
  prospect: ["prospect", "prospects"],
  qualifie: ["qualifié", "qualifiés"],
  contacte: ["contacté", "contactés"],
  client: ["client", "clients"],
};
const plural = (n: number, [one, many]: [string, string]) => (n > 1 ? many : one);

export function ActivityFeed({ events, limit = 30 }: { events: HubEvent[]; limit?: number }) {
  if (!events.length) return <Empty icon="activity" title="Rien pour l'instant">Le fil se remplit à mesure que l'agence travaille.</Empty>;
  return (
    <ol className="feed">
      {events.slice(0, limit).map((e) => (
        <li key={e.seq} className={`feed-item${e.type.endsWith("failed") || e.type === "server.error" ? " bad" : ""}`}>
          <span className="feed-icon">
            <Icon name={EVENT_ICON.find(([re]) => re.test(e.type))?.[1] ?? "info"} size={14} />
          </span>
          <span className="feed-msg">{e.message}</span>
          <time className="feed-time" dateTime={e.at} title={new Date(e.at).toLocaleString("fr-FR")}>
            {timeAgo(e.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

export function TodayPage() {
  const { jobs, events } = useLive();
  const { data, error, loading, reload } = useApi<Overview>("/api/overview", ["companies", "sites", "jobs"]);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const live = useMemo(
    () => [...jobs.values()].filter((j) => j.state === "running" || j.state === "queued").sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [jobs],
  );
  const raw = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const date = raw.charAt(0).toUpperCase() + raw.slice(1);

  return (
    <div className="page">
      <PageHeader title={`${greeting()}, Bat`} subtitle={date} />
      {error && <ErrorNote text={error} onRetry={reload} />}

      <div className="stat-row">
        {loading || !data ? (
          <Skeleton rows={1} />
        ) : (
          <>
            <Link to="/entreprises" className="stat">
              <span className="stat-value">{data.entreprises.total}</span>
              <span className="stat-label">{plural(data.entreprises.total, ["entreprise", "entreprises"])}</span>
            </Link>
            {(["prospect", "qualifie", "contacte", "client"] as const).map((s) => (
              <Link key={s} to={`/entreprises?statut=${s}`} className="stat">
                <span className="stat-value">{data.entreprises.parStatut[s] ?? 0}</span>
                <span className="stat-label">{plural(data.entreprises.parStatut[s] ?? 0, STAT_LABEL[s])}</span>
              </Link>
            ))}
            <Link to="/atelier" className="stat">
              <span className="stat-value">{live.length}</span>
              <span className="stat-label">{plural(live.length, ["travail en cours", "travaux en cours"])}</span>
            </Link>
          </>
        )}
      </div>

      <div className="today-grid">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="inbox" size={16} /> À valider
            </h2>
            {data && data.aValider.length > 0 && <span className="count">{data.aValider.length}</span>}
          </header>
          {loading ? (
            <Skeleton rows={2} />
          ) : !data?.aValider.length ? (
            <Empty icon="check" title="Rien à valider">
              Les maquettes, emails et mises en ligne qui attendent votre accord arriveront ici.
            </Empty>
          ) : (
            <div className="list">
              {data.aValider.map((s) => (
                <Link key={s.id} to={`/sites/${s.id}`} className="list-row">
                  <div>
                    <div className="row-title">{s.companyName}</div>
                    <div className="row-sub">{RECETTE_LABEL[s.recette] ?? s.recette}</div>
                  </div>
                  <SiteBadge statut={s.statut} />
                  <Icon name="chevron" size={16} className="row-chevron" />
                </Link>
              ))}
            </div>
          )}

          <header className="panel-head spaced">
            <h2>
              <Icon name="atelier" size={16} /> Travaux en cours
            </h2>
            {live.length > 0 && <span className="count live">{live.length}</span>}
          </header>
          {live.length === 0 ? (
            <Empty icon="atelier" title="Aucun travail en cours">
              Les fabrications de sites, audits et envois apparaîtront ici avec leur progression en direct.
            </Empty>
          ) : (
            <div className="list">
              {live.map((j) => (
                <JobRow key={j.id} job={j} onOpen={setOpenJob} />
              ))}
            </div>
          )}
          {data && data.echecs.length > 0 && (
            <>
              <header className="panel-head spaced">
                <h2>
                  <Icon name="alert" size={16} /> Échecs récents
                </h2>
              </header>
              <div className="list">
                {data.echecs.map((j) => (
                  <JobRow key={j.id} job={jobs.get(j.id) ?? j} onOpen={setOpenJob} />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="activity" size={16} /> Activité
            </h2>
          </header>
          <ActivityFeed events={events} />
        </section>
      </div>
      <JobDrawer id={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
