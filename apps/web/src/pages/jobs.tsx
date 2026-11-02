import { useState } from "react";
import { api, type AgentCall, type Job } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Drawer, timeAgo, usd } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { JobBadge } from "./labels.tsx";

/** Une ligne de travail, avec sa progression en direct. */
export function JobRow({ job, onOpen }: { job: Job; onOpen?: (id: string) => void }) {
  const pct = job.progress.pct;
  const last = job.progress.lines.at(-1);
  return (
    <button className={`job-row state-${job.state}`} onClick={() => onOpen?.(job.id)}>
      <div className="job-main">
        <div className="job-top">
          <span className="job-label">{job.label}</span>
          <JobBadge state={job.state} />
        </div>
        <div className="job-sub">
          {job.state === "failed" && job.error ? (
            <span className="text-danger">{job.error}</span>
          ) : (
            <span>{job.progress.label ?? last?.text ?? (job.state === "queued" ? "En attente d'une place libre" : "—")}</span>
          )}
          <span className="job-time">{timeAgo(job.updatedAt)}</span>
        </div>
        {(job.state === "running" || job.state === "queued") && (
          <div className={`progress${pct == null ? " indeterminate" : ""}`}>
            <div className="progress-bar" style={{ width: pct == null ? undefined : `${pct}%` }} />
          </div>
        )}
      </div>
      <Icon name="chevron" size={16} className="row-chevron" />
    </button>
  );
}

export function JobDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { jobs } = useLive();
  const toast = useToast();
  const { data } = useApi<{ job: Job; calls: AgentCall[] }>(id ? `/api/jobs/${id}` : null, ["jobs"]);
  const [busy, setBusy] = useState(false);
  const job = (id && jobs.get(id)) || data?.job || null;
  const act = async (what: "cancel" | "retry") => {
    if (!job) return;
    setBusy(true);
    try {
      await api.post(`/api/jobs/${job.id}/${what}`);
      toast.ok(what === "cancel" ? "Travail annulé" : "Travail relancé");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={job ? job.label : "Travail"}
      footer={
        job && (
          <>
            {(job.state === "running" || job.state === "queued") && (
              <button className="btn btn-danger-ghost" disabled={busy} onClick={() => act("cancel")}>
                <Icon name="cancel" size={15} /> Annuler
              </button>
            )}
            {(job.state === "failed" || job.state === "cancelled") && (
              <button className="btn btn-primary" disabled={busy} onClick={() => act("retry")}>
                <Icon name="retry" size={15} /> Relancer
              </button>
            )}
          </>
        )
      }
    >
      {job && (
        <div className="stack">
          <div className="kv-grid">
            <span>État</span>
            <span>
              <JobBadge state={job.state} />
            </span>
            <span>Type</span>
            <span className="mono">{job.type}</span>
            <span>Tentatives</span>
            <span>
              {job.attempts} / {job.maxAttempts}
            </span>
            <span>Créé</span>
            <span>{timeAgo(job.createdAt)}</span>
            {job.finishedAt && (
              <>
                <span>Fini</span>
                <span>{timeAgo(job.finishedAt)}</span>
              </>
            )}
          </div>
          {job.error && <div className="error-note">{job.error}</div>}
          {job.progress.label && (
            <div>
              <div className="section-label">Étape</div>
              <p>{job.progress.label}</p>
            </div>
          )}
          <div>
            <div className="section-label">Journal</div>
            {job.progress.lines.length === 0 ? (
              <p className="muted">Rien pour l'instant.</p>
            ) : (
              <ol className="log">
                {job.progress.lines.map((l, i) => (
                  <li key={i} className={`log-${l.kind}`}>
                    <span className="log-time">{new Date(l.at).toLocaleTimeString("fr-FR")}</span>
                    <span>{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {job.output != null && (
            <div>
              <div className="section-label">Résultat</div>
              <pre className="code">{JSON.stringify(job.output, null, 2)}</pre>
            </div>
          )}
          {data?.calls && data.calls.length > 0 && (
            <div>
              <div className="section-label">Appels aux agents</div>
              {data.calls.map((c) => (
                <div key={c.id} className="call-line">
                  <span className="mono">{c.agent}</span>
                  <span className="muted">
                    {c.model} · {(c.durationMs / 1000).toFixed(1)} s · {usd(c.costUsd)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
