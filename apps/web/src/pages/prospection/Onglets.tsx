import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { useApi } from "../../live.tsx";
import type { EntreeFile, EtatProspection, Grille, Regle } from "../../prospection-api.ts";
import { Link } from "../../router.tsx";
import { Icon } from "../../ui/Icon.tsx";
import { Empty, ErrorNote, Markdown, Skeleton, timeAgo } from "../../ui/common.tsx";
import { useToast } from "../../ui/toasts.tsx";
import { Badge } from "../labels.tsx";

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

// ── File des maquettes ──────────────────────────────────────────────────────

const ETAT_FILE: Record<EntreeFile["etat"], { label: string; tone: string }> = {
  en_attente: { label: "En attente", tone: "amber" },
  lancee: { label: "Lancée", tone: "green" },
  annulee: { label: "Retirée", tone: "muted" },
  refusee: { label: "Refusée", tone: "red" },
};

export function MaquettesFile({ data, reload }: { data: { file: EntreeFile[]; enFabrication: number; parallele: number } | null; reload: () => void }) {
  const toast = useToast();
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => setCap(data?.parallele ?? null), [data?.parallele]);
  if (!data) return <Skeleton rows={4} />;
  const changer = async (v: number) => {
    setCap(v);
    try {
      await api.patch("/api/settings", { "prospection.maquettes.parallele": v });
      toast.ok(`Fabrications simultanées : ${v}`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const retirer = async (id: string) => {
    try {
      await api.post(`/api/prospection/maquettes/${id}/annuler`);
      toast.ok("Retirée de la file");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const attente = data.file.filter((f) => f.etat === "en_attente").length;
  return (
    <div className="stack">
      <div className="panel file-head">
        <div>
          <div className="setting-title">Fabrications simultanées</div>
          <div className="setting-desc">
            {data.enFabrication} en fabrication maintenant · {attente} en attente. Chaque maquette mobilise plusieurs agents Claude pendant 10 à 40 minutes : 1 est prudent.
          </div>
        </div>
        <Stepper value={cap ?? data.parallele} min={1} max={4} onChange={changer} />
      </div>
      {data.file.length === 0 ? (
        <Empty icon="wand" title="File vide">
          « Créer la maquette » sur un prospect, ou sur une sélection, l'ajoute ici. Elles partent une par une, dans l'ordre.
        </Empty>
      ) : (
        <div className="list file-list">
          {data.file.map((f, i) => (
            <div key={f.id} className="list-row static file-row" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              <div className="file-main">
                <div className="row-title">
                  <Link to={`/prospection/${f.companyId}?onglet=maquettes`} className="inline-link plain">
                    {f.companyName}
                  </Link>
                </div>
                <div className="row-sub">
                  {f.etat === "refusee" ? <span className="text-danger">{f.message}</span> : f.etat === "en_attente" ? `Ajoutée ${timeAgo(f.createdAt)}` : `${ETAT_FILE[f.etat].label} ${timeAgo(f.updatedAt)}`}
                </div>
              </div>
              <Badge tone={ETAT_FILE[f.etat].tone} dot>
                {ETAT_FILE[f.etat].label}
              </Badge>
              {f.etat === "lancee" && f.siteId && (
                <Link to={`/sites/${f.siteId}`} className="btn btn-ghost btn-sm">
                  Suivre <Icon name="arrow" size={13} />
                </Link>
              )}
              {f.etat === "en_attente" && (
                <button className="btn btn-ghost btn-sm" onClick={() => retirer(f.id)}>
                  Retirer
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grille de score ─────────────────────────────────────────────────────────

const PARAMS: Record<string, { label: string; step: number; min: number; max: number; suffix?: string }[]> = {
  copyright_ancien: [{ label: "Année", step: 1, min: 2000, max: 2030 }],
  avis: [
    { label: "Avis", step: 1, min: 0, max: 1000 },
    { label: "Note", step: 0.1, min: 0, max: 5 },
  ],
  anciennete: [{ label: "Ans", step: 1, min: 0, max: 50 }],
};

export function GrilleEditor() {
  const toast = useToast();
  const { data, error, reload } = useApi<{ grille: Grille; defaut: Grille; libelles: Record<string, string> }>("/api/prospection/grille", ["settings"]);
  const [g, setG] = useState<Grille | null>(null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    if (data) setG(structuredClone(data.grille));
  }, [data]);
  if (error) return <ErrorNote text={error} onRetry={reload} />;
  if (!g || !data) return <Skeleton rows={7} />;
  const maj = (id: string, patch: Partial<Regle>) => setG({ ...g, regles: g.regles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const modifie = JSON.stringify(g) !== JSON.stringify(data.grille);
  const enregistrer = async () => {
    setEnvoi(true);
    try {
      const r = await api.put<{ recalcules: number; qualifies: number }>("/api/prospection/grille", { grille: g });
      toast.ok(`Grille enregistrée : ${r.recalcules} prospect(s) recalculé(s), ${r.qualifies} qualifié(s)`);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  };
  const max = g.regles.filter((r) => r.actif && r.points > 0).reduce((s, r) => s + r.points, 0);
  return (
    <div className="grille">
      <div className="panel grille-panel">
        <div className="grille-rows">
          {g.regles.map((r, i) => (
            <div key={r.id} className={`grille-row${r.actif ? "" : " off"}`} style={{ animationDelay: `${i * 30}ms` }}>
              <button role="switch" aria-checked={r.actif} aria-label={`Activer : ${data.libelles[r.id]}`} className={`toggle${r.actif ? " on" : ""}`} onClick={() => maj(r.id, { actif: !r.actif })}>
                <span className="toggle-knob" />
              </button>
              <div className="grille-label">
                <span>{r.id === "franchise" ? "Franchise ou réseau national" : libelle(r)}</span>
                {PARAMS[r.id] && (
                  <span className="grille-params">
                    {PARAMS[r.id]!.map((p, k) => {
                      const cle = k === 0 ? "param" : "param2";
                      return (
                        <label key={cle}>
                          <span className="muted small">{p.label}</span>
                          <input type="number" step={p.step} min={p.min} max={p.max} value={r[cle] ?? ""} onChange={(e) => maj(r.id, { [cle]: e.target.value === "" ? undefined : Number(e.target.value) })} disabled={!r.actif} />
                        </label>
                      );
                    })}
                  </span>
                )}
              </div>
              {r.id === "franchise" ? (
                <span className="grille-excl">exclu</span>
              ) : (
                <label className="grille-pts">
                  <input type="number" step={5} min={-100} max={100} value={r.points} onChange={(e) => maj(r.id, { points: Number(e.target.value) })} disabled={!r.actif} aria-label="Points" />
                  <span className="muted small">pts</span>
                </label>
              )}
            </div>
          ))}
        </div>
        <div className="grille-seuil">
          <div>
            <div className="setting-title">Seuil de qualification</div>
            <div className="setting-desc">Une entreprise à ce score ou plus passe « Qualifiée ». Maximum possible avec cette grille : {max} points.</div>
          </div>
          <span className="grille-pts">
            <input type="number" min={0} max={200} step={5} value={g.seuil} onChange={(e) => setG({ ...g, seuil: Number(e.target.value) })} aria-label="Seuil" />
            <span className="muted small">pts</span>
          </span>
        </div>
      </div>
      <div className="grille-foot">
        <button className="btn btn-ghost" onClick={() => setG(structuredClone(data.defaut))}>
          <Icon name="undo" size={15} /> Grille du plan
        </button>
        <span className="foot-spacer" />
        {modifie && <span className="muted small">Modifications non enregistrées</span>}
        <button className="btn btn-primary" disabled={!modifie || envoi} onClick={enregistrer}>
          <Icon name={envoi ? "spinner" : "check"} size={15} className={envoi ? "spin" : undefined} /> Enregistrer et recalculer
        </button>
      </div>
      <p className="muted small grille-note">
        Le score est calculé par le code, jamais par un agent. Les règles qui dépendent d'une donnée inconnue (avis sans Google Places, « aucun site » sans Places) sont marquées « à vérifier »
        sur la fiche.
      </p>
    </div>
  );
}

function libelle(r: Regle): string {
  switch (r.id) {
    case "aucun_site":
      return "Aucun site web";
    case "site_defaillant":
      return "Site sans HTTPS ou non adapté au mobile";
    case "copyright_ancien":
      return `Copyright ou dernière mise à jour avant ${r.param ?? 2021}`;
    case "avis":
      return `${r.param ?? 10} avis Google ou plus, note ≥ ${(r.param2 ?? 4.3).toLocaleString("fr-FR")}`;
    case "anciennete":
      return `Entreprise créée depuis plus de ${r.param ?? 2} ans`;
    case "site_correct":
      return "Site récent et correct";
    default:
      return r.id;
  }
}

// ── RGPD : registre, opposition, purge ──────────────────────────────────────

export function RgpdPanel({ etat }: { etat: EtatProspection | null }) {
  const toast = useToast();
  const registre = useApi<{ markdown: string }>("/api/prospection/registre", ["prospection", "settings"]);
  const opposition = useApi<{ total: number; parType: Record<string, number>; dernieres: { type: string; motif: string | null; le: string }[] }>("/api/prospection/opposition", ["prospection"]);
  const [v, setV] = useState({ siren: "", telephone: "", email: "", motif: "" });
  const [verif, setVerif] = useState<string | null>(null);
  const [mois, setMois] = useState<number | null>(null);
  useEffect(() => setMois(etat?.purgeMois ?? null), [etat?.purgeMois]);

  const ajouter = async () => {
    try {
      const r = await api.post<{ ajoutees: number }>("/api/prospection/opposition", { ...Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim())) });
      toast.ok(r.ajoutees ? `${r.ajoutees} entrée(s) ajoutée(s) à la liste d'opposition` : "Déjà sur la liste");
      setV({ siren: "", telephone: "", email: "", motif: "" });
      opposition.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const verifier = async () => {
    try {
      const r = await api.post<{ opposee: boolean }>("/api/prospection/opposition/verifier", Object.fromEntries(Object.entries(v).filter(([k, x]) => k !== "motif" && x.trim())));
      setVerif(r.opposee ? "Sur la liste d'opposition : ne jamais contacter." : "Absent de la liste d'opposition.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const changerMois = async (m: number) => {
    setMois(m);
    try {
      await api.patch("/api/settings", { "prospection.purge.mois": m });
      toast.ok(`Purge après ${m} mois`);
      registre.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const purger = async () => {
    try {
      const r = await api.post<{ supprimees: number; cacheExpire: number }>("/api/prospection/purge");
      toast.ok(`${r.supprimees} prospect(s) supprimé(s), ${r.cacheExpire} réponse(s) d'API expirée(s) effacée(s)`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const copierRegistre = async () => {
    if (!registre.data) return;
    await navigator.clipboard.writeText(registre.data.markdown).catch(() => {});
    toast.ok("Registre copié (Markdown)");
  };

  return (
    <div className="rgpd">
      <section className="panel rgpd-registre">
        <div className="panel-head">
          <h2 className="section-title">Registre de traitement</h2>
          <button className="btn btn-ghost btn-sm" onClick={copierRegistre}>
            <Icon name="file" size={14} /> Copier
          </button>
        </div>
        {registre.data ? <Markdown source={registre.data.markdown} /> : <Skeleton rows={8} />}
      </section>
      <div className="stack">
        <section className="panel">
          <h2 className="section-title">Liste d'opposition</h2>
          <p className="muted small">
            À vie. Une entreprise inscrite n'est plus jamais sourcée ni contactée. Seules des empreintes sont gardées : la liste ne permet pas de retrouver qui y figure.
          </p>
          <div className="oppo-count">
            <b>{opposition.data?.total ?? "—"}</b> entrée(s)
            {opposition.data && Object.keys(opposition.data.parType).length > 0 && <span className="muted"> · {Object.entries(opposition.data.parType).map(([t, n]) => `${n} ${t}`).join(", ")}</span>}
          </div>
          <div className="form oppo-form">
            <div className="grid-2">
              <label className="field">
                <span className="field-label">SIREN</span>
                <input value={v.siren} onChange={(e) => setV({ ...v, siren: e.target.value })} inputMode="numeric" placeholder="123 456 789" />
              </label>
              <label className="field">
                <span className="field-label">Téléphone</span>
                <input value={v.telephone} onChange={(e) => setV({ ...v, telephone: e.target.value })} placeholder="04 72 00 00 00" />
              </label>
              <label className="field wide">
                <span className="field-label">Email</span>
                <input value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="contact@exemple.fr" />
              </label>
              <label className="field wide">
                <span className="field-label">Motif</span>
                <input value={v.motif} onChange={(e) => setV({ ...v, motif: e.target.value })} placeholder="Réponse STOP du 2 novembre" />
              </label>
            </div>
            <div className="oppo-actions">
              {verif && <span className="small">{verif}</span>}
              <span className="foot-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={verifier} disabled={!v.siren && !v.telephone && !v.email}>
                Vérifier
              </button>
              <button className="btn btn-primary btn-sm" onClick={ajouter} disabled={!v.siren && !v.telephone && !v.email}>
                Ajouter à la liste
              </button>
            </div>
          </div>
        </section>
        <section className="panel">
          <h2 className="section-title">Conservation</h2>
          <div className="setting">
            <div>
              <div className="setting-title">Purge des prospects non convertis</div>
              <div className="setting-desc">Sans activité depuis ce délai : fiche supprimée automatiquement (jamais une cliente, ni une fiche qui a une maquette ou créée à la main).</div>
            </div>
            <Stepper value={mois ?? 6} min={1} max={36} onChange={changerMois} suffix="mois" />
          </div>
          <div className="oppo-actions">
            <span className="muted small">Vérifiée au démarrage du hub puis toutes les 12 heures.</span>
            <span className="foot-spacer" />
            <button className="btn btn-ghost btn-sm" onClick={purger}>
              <Icon name="trash" size={14} /> Purger maintenant
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
