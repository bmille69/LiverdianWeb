import { useEffect, useState } from "react";
import { api, type Settings } from "../api.ts";
import { useApi } from "../live.tsx";
import { usePrefs } from "../prefs.ts";
import { Icon } from "../ui/Icon.tsx";
import { ErrorNote, PageHeader, Skeleton } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { ReglagesProspection } from "./prospection/ReglagesProspection.tsx";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span className="toggle-knob" />
    </button>
  );
}

function Stepper({ value, min, max, onChange, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="stepper">
      <button className="icon-btn sm" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Moins">
        −
      </button>
      <span className="stepper-value">
        {value}
        {suffix && <span className="muted"> {suffix}</span>}
      </span>
      <button className="icon-btn sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Plus">
        +
      </button>
    </div>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const [prefs, setPrefs] = usePrefs();
  const { data, error, loading, reload } = useApi<Settings>("/api/settings", ["settings"]);
  const [s, setS] = useState<Settings["settings"] | null>(null);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);

  const save = async (patch: Partial<Settings["settings"]>) => {
    setS((x) => (x ? { ...x, ...patch } : x));
    try {
      await api.patch("/api/settings", patch);
      toast.ok("Réglage enregistré");
    } catch (e) {
      toast.error((e as Error).message);
      reload();
    }
  };

  return (
    <div className="page narrow">
      <PageHeader title="Réglages" />
      <section className="settings-group">
        <h2>Affichage</h2>
        <div className="setting">
          <div>
            <div className="setting-title">Thème</div>
            <div className="setting-desc">Sombre par défaut. Gardé sur ce poste.</div>
          </div>
          <div className="segmented">
            {(["dark", "light"] as const).map((t) => (
              <button key={t} className={prefs.theme === t ? "on" : ""} onClick={() => setPrefs({ theme: t })}>
                <Icon name={t === "dark" ? "moon" : "sun"} size={14} /> {t === "dark" ? "Sombre" : "Clair"}
              </button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div>
            <div className="setting-title">Réduire les animations</div>
            <div className="setting-desc">Coupe les transitions et apparitions. Suit par défaut le réglage de Windows.</div>
          </div>
          <Toggle on={prefs.motion === "reduced"} onChange={(v) => setPrefs({ motion: v ? "reduced" : "full" })} label="Réduire les animations" />
        </div>
      </section>

      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading || !s || !data ? (
        <Skeleton rows={4} />
      ) : (
        <>
          <section className="settings-group">
            <h2>Travaux et agents</h2>
            <div className="setting">
              <div>
                <div className="setting-title">Travaux en parallèle</div>
                <div className="setting-desc">Nombre de travaux exécutés en même temps, tous types confondus.</div>
              </div>
              <Stepper value={s["jobs.parallel"]} min={1} max={8} onChange={(v) => save({ "jobs.parallel": v })} />
            </div>
            <div className="setting">
              <div>
                <div className="setting-title">Appels Claude simultanés</div>
                <div className="setting-desc">Chaque appel consomme du quota de l'abonnement Max. 2 est un bon équilibre.</div>
              </div>
              <Stepper value={s["agents.parallel"]} min={1} max={6} onChange={(v) => save({ "agents.parallel": v })} />
            </div>
            <div className="setting">
              <div>
                <div className="setting-title">Durée maximale d'un travail d'atelier</div>
                <div className="setting-desc">Au-delà, Claude Code est arrêté proprement et le travail échoue.</div>
              </div>
              <Stepper value={s["atelier.timeoutMinutes"]} min={5} max={180} onChange={(v) => save({ "atelier.timeoutMinutes": v })} suffix="min" />
            </div>
          </section>

          <section className="settings-group">
            <h2>Connexions</h2>
            <div className="setting">
              <div>
                <div className="setting-title">Claude Code</div>
                <div className="setting-desc">Les agents passent par le CLI « claude » et votre abonnement Max, jamais par une clé d'API.</div>
              </div>
              <span className="badge tone-green">
                <Icon name="check" size={12} /> Abonnement
              </span>
            </div>
            <div className="setting">
              <div>
                <div className="setting-title">DeepSeek</div>
                <div className="setting-desc">
                  Facultatif, sert à l'audit des prospects. Se saisit dans la section Prospection ci-dessous (ou variable <code>DEEPSEEK_API_KEY</code>).
                </div>
              </div>
              <span className={`badge ${data.deepseek ? "tone-green" : "tone-muted"}`}>{data.deepseek ? "Configuré" : "Non configuré"}</span>
            </div>
            <div className="setting">
              <div>
                <div className="setting-title">Dossier des données</div>
                <div className="setting-desc mono">{data.dataDir}</div>
              </div>
            </div>
          </section>

          <ReglagesProspection />
        </>
      )}
    </div>
  );
}
