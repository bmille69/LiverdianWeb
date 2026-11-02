import { useState } from "react";
import { api, type Agent, type AgentCall, type Job, type Skill } from "../api.ts";
import { useApi } from "../live.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Drawer, Empty, ErrorNote, Markdown, PageHeader, Skeleton, timeAgo, usd } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { JobDrawer } from "./jobs.tsx";

const MODELS = ["opus", "sonnet", "haiku", "fable"];
const MODE_LABEL: Record<string, string> = { chat: "Conversation", structured: "Réponse structurée", vision: "Vision", atelier: "Atelier (Claude Code)" };

export function TeamPage() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<{ agents: Agent[] }>("/api/agents", ["agents", "jobs"]);
  const calls = useApi<{ calls: AgentCall[] }>("/api/agents/calls?limit=40", ["agents", "jobs"]);
  const [skillPath, setSkillPath] = useState<string | null>(null);
  const [testing, setTesting] = useState<Agent | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  const agents = data?.agents ?? [];
  const names = Object.fromEntries(agents.map((a) => [a.id, a]));
  const total7 = agents.reduce((s, a) => s + a.cout7j, 0);

  const setModel = async (a: Agent, model: string) => {
    try {
      const r = await api.put<{ agents: Agent[] }>(`/api/agents/${a.id}/model`, { model: model === a.modeleDefaut ? null : model });
      setData(r);
      toast.ok(`${a.nom} utilise maintenant ${model}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Équipe" subtitle="Les agents de l'agence, leur modèle et les skills qu'ils héritent." />
      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading ? (
        <Skeleton rows={4} />
      ) : (
        <div className="agent-grid">
          {agents.map((a, i) => (
            <article key={a.id} className="agent-card" style={{ ["--agent" as string]: a.couleur, animationDelay: `${i * 45}ms` }}>
              <header className="agent-head">
                <span className="agent-avatar">
                  <Icon name={a.icone} size={18} />
                </span>
                <div className="agent-id">
                  <h3>{a.nom}</h3>
                  <p>{a.resume}</p>
                </div>
              </header>
              <div className="agent-meta">
                <label className="model-pick" title="Modèle utilisé par cet agent">
                  <Icon name="sparkles" size={13} />
                  <select value={a.modele} onChange={(e) => setModel(a, e.target.value)} aria-label={`Modèle de ${a.nom}`}>
                    {[...new Set([...MODELS, a.modele])].map((m) => (
                      <option key={m} value={m}>
                        {m}
                        {m === a.modeleDefaut ? " (défaut)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="agent-modes">{a.modes.map((m) => MODE_LABEL[m] ?? m).join(" · ")}</span>
              </div>
              <div className="agent-skills">
                {a.skills.map((s) => (
                  <button key={s.path} className={`skill-chip${s.path.startsWith("_shared") ? " shared" : ""}`} onClick={() => setSkillPath(s.path)} title={s.description}>
                    <Icon name="file" size={12} />
                    {s.name}
                  </button>
                ))}
                {a.skillsManquants.map((p) => (
                  <span key={p} className="skill-chip missing" title="Déclaré dans skills/agents.json mais introuvable">
                    <Icon name="alert" size={12} /> {p}
                  </span>
                ))}
              </div>
              <footer className="agent-foot">
                <span className="muted small">
                  7 jours : {a.appels7j} appel{a.appels7j > 1 ? "s" : ""} · {usd(a.cout7j)}
                </span>
                {a.modes.some((m) => m === "chat" || m === "structured" || m === "vision") && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setTesting(a)}>
                    <Icon name="zap" size={14} /> Essayer
                  </button>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Appels récents</h2>
          <span className="muted small">Coût indicatif sur 7 jours : {usd(total7)} (l'abonnement Max couvre les appels Claude)</span>
        </div>
        {!calls.data?.calls.length ? (
          <Empty icon="bot" title="Aucun appel pour l'instant">
            Chaque appel à un agent (durée, modèle, coût indicatif) sera listé ici.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Quand</th>
                  <th>Agent</th>
                  <th>Modèle</th>
                  <th>Mode</th>
                  <th>Objet</th>
                  <th className="num">Durée</th>
                  <th className="num">Coût</th>
                </tr>
              </thead>
              <tbody>
                {calls.data.calls.map((c) => (
                  <tr key={c.id} className={c.jobId ? "" : "static"} onClick={() => c.jobId && setOpenJob(c.jobId)}>
                    <td className="muted">{timeAgo(c.at)}</td>
                    <td>
                      <span className="agent-dot" style={{ background: names[c.agent]?.couleur }} />
                      {names[c.agent]?.nom ?? c.agent}
                    </td>
                    <td className="mono">{c.model}</td>
                    <td>{MODE_LABEL[c.mode] ?? c.mode}</td>
                    <td className="ellipsis" title={c.error ?? c.summary ?? ""}>
                      {!c.ok && <Icon name="alert" size={13} className="text-danger" />} {c.summary}
                    </td>
                    <td className="num">{(c.durationMs / 1000).toFixed(1)} s</td>
                    <td className="num">{usd(c.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <SkillDrawer path={skillPath} onClose={() => setSkillPath(null)} />
      <TryAgent
        agent={testing}
        onClose={() => setTesting(null)}
        onStarted={(job) => {
          setTesting(null);
          setOpenJob(job.id);
        }}
      />
      <JobDrawer id={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}

function SkillDrawer({ path, onClose }: { path: string | null; onClose: () => void }) {
  const { data, error } = useApi<{ skill: Skill }>(path ? `/api/skills/${path}` : null);
  const skill = data?.skill.path === path ? data.skill : null;
  return (
    <Drawer
      open={!!path}
      onClose={onClose}
      width={720}
      title={
        <div>
          <div className="drawer-name">{skill?.name ?? "Skill"}</div>
          <div className="drawer-sub mono">skills/{path}/SKILL.md</div>
        </div>
      }
    >
      {error && <ErrorNote text={error} />}
      {!skill && !error && <Skeleton rows={8} />}
      {skill && (
        <>
          <p className="skill-desc">{skill.description}</p>
          <Markdown source={skill.body} />
        </>
      )}
    </Drawer>
  );
}

function TryAgent({ agent, onClose, onStarted }: { agent: Agent | null; onClose: () => void; onStarted: (j: Job) => void }) {
  const toast = useToast();
  const [question, setQuestion] = useState("Présente-toi en deux phrases : ton rôle dans l'agence et la règle que tu ne transgresses jamais.");
  const [model, setModel] = useState("haiku");
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (!agent) return;
    setBusy(true);
    try {
      const r = await api.post<{ job: Job }>(`/api/agents/${agent.id}/essai`, { question, model });
      toast.info(`Question envoyée à ${agent.nom}`);
      onStarted(r.job);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={!!agent}
      onClose={onClose}
      title={agent ? `Essayer · ${agent.nom}` : "Essayer"}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={start} disabled={busy || question.trim().length < 3}>
            <Icon name="zap" size={15} /> Envoyer
          </button>
        </>
      }
    >
      <div className="form">
        <p className="muted small">L'essai passe par la file de travaux : vous suivez la réponse en direct. Il utilise votre abonnement Claude.</p>
        <label className="field wide">
          <span className="field-label">Question</span>
          <textarea rows={5} value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Modèle pour cet essai</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
                {m === "haiku" ? " (rapide, économe)" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Drawer>
  );
}
