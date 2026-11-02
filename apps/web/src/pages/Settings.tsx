import { useEffect, useState } from "react";
import { api, type Demo, type EtatHebergement, type PointHebergement, type Settings } from "../api.ts";
import { useApi } from "../live.tsx";
import { usePrefs } from "../prefs.ts";
import { Icon } from "../ui/Icon.tsx";
import { ErrorNote, formatDate, PageHeader, Skeleton } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { ReglagesProspection } from "./prospection/ReglagesProspection.tsx";

/** Moteur des agents (brief F, ADR-16) : l'abonnement Claude Code, DeepSeek, ou le repli automatique. */
const MOTEUR: Record<Settings["settings"]["agents.moteur"], { label: string; desc: string }> = {
  abonnement: { label: "Abonnement", desc: "Tous les appels passent par Claude Code et votre abonnement Max." },
  deepseek: {
    label: "DeepSeek",
    desc: "Les appels passent par DeepSeek (facturé à l'usage). La vision reste sur l'abonnement : DeepSeek ne lit pas les images.",
  },
  automatique: {
    label: "Automatique",
    desc: "L'abonnement d'abord ; s'il répond « limite atteinte », l'appel repart aussitôt sur DeepSeek. La vision reste sur l'abonnement (DeepSeek ne lit pas les images).",
  },
};

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
                <div className="setting-title">Moteur des agents</div>
                <div className="setting-desc">{MOTEUR[s["agents.moteur"]].desc}</div>
              </div>
              <div className="segmented">
                {(Object.keys(MOTEUR) as (keyof typeof MOTEUR)[]).map((t) => (
                  <button key={t} className={s["agents.moteur"] === t ? "on" : ""} onClick={() => save({ "agents.moteur": t })}>
                    {MOTEUR[t].label}
                  </button>
                ))}
              </div>
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
                  Facultatif. Sert de moteur aux agents (secours ou principal, voir « Moteur » ci-dessus) et à l'audit des prospects. Se saisit dans la section Prospection
                  ci-dessous (ou variable <code>DEEPSEEK_API_KEY</code>).
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

          <HebergementDemos />

          <ReglagesProspection />
        </>
      )}
    </div>
  );
}

// ── Hébergement des démos (brief F) ─────────────────────────────────────

/** Réglages › Hébergement : domaine, secrets Cloudflare, et un test qui dit précisément ce qui manque. */
function HebergementDemos() {
  const toast = useToast();
  const heb = useApi<EtatHebergement>("/api/hebergement", ["settings"]);
  const [domaine, setDomaine] = useState("");
  const [points, setPoints] = useState<PointHebergement[] | null>(null);
  const [testEnCours, setTestEnCours] = useState(false);
  useEffect(() => {
    if (heb.data) setDomaine(heb.data.domaine);
  }, [heb.data?.domaine]);

  const enregistrerDomaine = async () => {
    if (domaine.trim() === heb.data?.domaine) return;
    try {
      await api.patch("/api/settings", { "hebergement.domaine": domaine.trim() });
      toast.ok("Domaine enregistré");
      heb.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const tester = async () => {
    setTestEnCours(true);
    try {
      const r = await api.post<{ ok: boolean; points: PointHebergement[] }>("/api/hebergement/tester");
      setPoints(r.points);
      toast.ok(r.ok ? "Connexion Cloudflare en ordre" : "Des points restent à corriger (voir la liste ci-dessous)");
      heb.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTestEnCours(false);
    }
  };

  const enLigne = heb.data?.demos.filter((d) => d.etat === "en_ligne") ?? [];
  const prochaine = enLigne.reduce<Demo | null>((min, d) => (!min || !min.expireLe || (d.expireLe && d.expireLe < min.expireLe) ? d : min), null);

  return (
    <section className="settings-group">
      <h2>Hébergement des démos</h2>
      <div className="setting">
        <div>
          <div className="setting-title">Domaine</div>
          <div className="setting-desc">
            Chaque maquette validée se publie en un clic sur <code>&lt;nom&gt;.demo.{domaine.trim() || "votre-domaine.fr"}</code>, retirée automatiquement après 30 jours. Le hub
            crée lui-même la route Cloudflare à la première publication.
          </div>
        </div>
        <span className="cle-saisie">
          <input value={domaine} onChange={(e) => setDomaine(e.target.value)} onBlur={enregistrerDomaine} placeholder="mondomaine.fr" aria-label="Domaine" spellCheck={false} />
          <button className="btn btn-ghost btn-sm" onClick={enregistrerDomaine} disabled={domaine.trim() === heb.data?.domaine}>
            Enregistrer
          </button>
        </span>
      </div>
      <SecretCloudflare nom="CLOUDFLARE_ACCOUNT_ID" libelle="Compte Cloudflare (identifiant)" present={heb.data?.comptePresent} onSaved={heb.reload}>
        L'identifiant du compte qui possède le domaine — sur dash.cloudflare.com, « ID du compte » en bas de la page d'accueil.
      </SecretCloudflare>
      <SecretCloudflare nom="CLOUDFLARE_API_TOKEN" libelle="Jeton Cloudflare" present={heb.data?.jetonPresent} onSaved={heb.reload}>
        Jeton d'API à créer sur dash.cloudflare.com (« Mon profil › Jetons API › Créer un jeton › Personnalisé ») avec les permissions : Zone › DNS › Edit, Zone › Zone › Read,
        Compte › Workers Routes › Edit, Compte › Workers KV Storage › Edit, Compte › Workers Scripts › Edit. Le test ci-dessous dit précisément ce qui manque.
      </SecretCloudflare>
      <div className="setting">
        <div>
          <div className="setting-title">Tester la connexion</div>
          <div className="setting-desc">
            Vérifie le jeton, le compte, la zone, les permissions, la route, le Worker et le compteur de visites. Le déploiement passe par wrangler, installé avec le hub :
            rien d'autre à installer.
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={tester} disabled={testEnCours}>
          {testEnCours ? <Icon name="spinner" size={14} className="spin" /> : <Icon name="zap" size={14} />} Tester la connexion
        </button>
      </div>
      {points && (
        <div className="heberge-points">
          {points.map((p) => (
            <div key={p.titre} className={`heberge-point ${p.niveau}`}>
              <Icon name={p.niveau === "ok" ? "check-circle" : p.niveau === "avertissement" ? "info" : "x-circle"} size={15} />
              <div>
                <strong>{p.titre}</strong> <span className="muted">{p.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {enLigne.length > 0 && (
        <div className="setting">
          <div>
            <div className="setting-title">
              {enLigne.length} démo{enLigne.length > 1 ? "s" : ""} en ligne
            </div>
            <div className="setting-desc">
              {prochaine?.expireLe
                ? `Prochaine échéance : ${prochaine.url.replace(/^https:\/\//, "")} sera retirée le ${formatDate(prochaine.expireLe)} (chaque démo vit 30 jours).`
                : "Chaque démo vit 30 jours, puis est retirée automatiquement."}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** Secret Cloudflare : écrit dans .data/settings/secrets.json, jamais réaffiché (même usage que les clés de la prospection). */
function SecretCloudflare({ nom, libelle, present, onSaved, children }: { nom: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN"; libelle: string; present: boolean | undefined; onSaved: () => void; children: React.ReactNode }) {
  const toast = useToast();
  const [valeur, setValeur] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const save = async (v: string | null) => {
    try {
      await api.post("/api/hebergement/secrets", { nom, valeur: v });
      toast.ok(v ? `${libelle} enregistré` : `${libelle} retiré`);
      setValeur("");
      setOuvert(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="setting">
      <div>
        <div className="setting-title">{libelle}</div>
        <div className="setting-desc">{children}</div>
        {ouvert && (
          <form
            className="cle-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(valeur);
            }}
          >
            <input type="password" autoComplete="off" spellCheck={false} value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder="Collez la valeur ici" aria-label={libelle} autoFocus />
            <button className="btn btn-primary btn-sm" disabled={valeur.trim().length < 20}>
              Enregistrer
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert(false)}>
              Annuler
            </button>
          </form>
        )}
        {ouvert && (
          <div className="setting-desc">
            Rangé dans <code>.data/settings/secrets.json</code>, jamais en base ni dans les journaux, jamais réaffiché.
          </div>
        )}
      </div>
      <span className="cle-saisie">
        <span className={`badge ${present ? "tone-green" : "tone-muted"}`}>
          {present && <Icon name="check" size={12} />}
          {present ? "Enregistré" : "Non renseigné"}
        </span>
        {!ouvert && (
          <button className="btn btn-ghost btn-sm" onClick={() => setOuvert(true)}>
            {present ? "Remplacer" : "Ajouter"}
          </button>
        )}
        {present && !ouvert && (
          <button className="icon-btn sm" onClick={() => save(null)} title={`Retirer ${libelle}`} aria-label={`Retirer ${libelle}`}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
