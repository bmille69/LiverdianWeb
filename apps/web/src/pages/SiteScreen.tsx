import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type EtapeMeta, type Fabrication, type Passe, type RecetteAtelier, type SiteDetail, type Tour, type Unicite } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import { Link } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Drawer, ErrorNote, PageHeader, Skeleton } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { RECETTE_LABEL, SiteBadge } from "./labels.tsx";
import { ActivityFeed } from "./Today.tsx";

// ── Petits utilitaires ──────────────────────────────────────────────────────

export function duree(ms: number | null): string {
  if (ms == null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Re-rendu chaque seconde (chronomètres en direct). */
function useTick(active: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}

const PASSE: Record<Passe["etat"], { label: string; tone: string; icon: string }> = {
  en_file: { label: "En file", tone: "neutral", icon: "clock" },
  en_cours: { label: "En cours", tone: "blue", icon: "spinner" },
  ok: { label: "Réussi", tone: "green", icon: "check" },
  echec: { label: "Échec", tone: "red", icon: "x" },
  sautee: { label: "Sans objet", tone: "muted", icon: "skip" },
  renvoi: { label: "Renvoyé", tone: "amber", icon: "undo" },
  erreur: { label: "Erreur", tone: "red", icon: "alert" },
  arret: { label: "Arrêt", tone: "red", icon: "cancel" },
  annulee: { label: "Annulé", tone: "muted", icon: "cancel" },
};

const ETAT_FAB: Record<Fabrication["etat"], { label: string; tone: string }> = {
  en_cours: { label: "En fabrication", tone: "blue" },
  a_valider: { label: "À valider", tone: "amber" },
  validee: { label: "Validée", tone: "green" },
  arretee: { label: "Arrêtée — à revoir", tone: "red" },
};

const dureePasse = (p: Passe, now: number) => (p.debut ? (p.fin ? new Date(p.fin).getTime() : now) - new Date(p.debut).getTime() : null);

// ── Écran ───────────────────────────────────────────────────────────────────

export function SiteScreen({ id }: { id: string }) {
  const { meta, jobs } = useLive();
  const { data, error, loading, reload } = useApi<SiteDetail>(`/api/sites/${id}`, ["sites", "jobs"]);
  const s = data?.site;
  const f = data?.fabrication ?? null;
  const recette = meta?.recettesAtelier.find((r) => r.id === s?.recette) ?? null;
  const live = f?.jobId ? jobs.get(f.jobId) : undefined;
  useTick(f?.etat === "en_cours");
  // L'aperçu se recharge quand la fabrication avance (nouveau build).
  const version = f ? `${f.passes.length}-${f.passes.at(-1)?.etat}` : "0";

  return (
    <div className="page page-wide">
      <Link to="/sites" className="back-link">
        <Icon name="chevron" size={14} className="flip" /> Sites
      </Link>
      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading || !s || !data ? (
        <Skeleton rows={6} />
      ) : (
        <>
          <PageHeader
            title={s.companyName}
            subtitle={
              <span className="inline-meta">
                {RECETTE_LABEL[s.recette] ?? s.recette} · <SiteBadge statut={s.statut} /> · <Link to={`/entreprises/${s.companyId}`}>fiche entreprise</Link>
              </span>
            }
            actions={f && <Actions siteId={s.id} f={f} onDone={reload} />}
          />
          {!f ? (
            <div className="panel">
              <p className="muted">Ce site n'a pas encore été fabriqué. Lancez « Créer la maquette » depuis sa fiche entreprise.</p>
            </div>
          ) : (
            <>
              <Bandeau f={f} recette={recette} liveLabel={live?.progress.label ?? null} liveLine={live?.progress.lines.at(-1)?.text ?? null} />
              {data.unicite && <LigneUnicite u={data.unicite} />}
              <div className="fab-grid">
                <section className="panel fab-frise">
                  <header className="panel-head">
                    <h2>
                      <Icon name="layers" size={16} /> Étapes
                    </h2>
                    <span className="muted small push">{duree((f.finishedAt ? new Date(f.finishedAt).getTime() : Date.now()) - new Date(f.createdAt).getTime())}</span>
                  </header>
                  {recette && <Frise f={f} recette={recette} />}
                </section>
                <div className="fab-main">
                  <Apercu siteId={s.id} disponible={data.fichiers.apercu} version={version} port={meta?.apercuPort ?? null} />
                  <Controles f={f} recette={recette} />
                  <Captures siteId={s.id} captures={data.fichiers.captures} pleinePage={data.fichiers.pleinePage} version={version} />
                  <Intention f={f} />
                  <Tours f={f} recette={recette} />
                  <section className="panel">
                    <header className="panel-head">
                      <h2>
                        <Icon name="activity" size={16} /> Journal
                      </h2>
                    </header>
                    <ActivityFeed events={data.activite} limit={14} />
                  </section>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Bandeau d'état ──────────────────────────────────────────────────────────

function Bandeau({ f, recette, liveLabel, liveLine }: { f: Fabrication; recette: RecetteAtelier | null; liveLabel: string | null; liveLine: string | null }) {
  const etape = recette?.etapes.find((e) => e.id === f.etape);
  const total = (f.finishedAt ? new Date(f.finishedAt).getTime() : Date.now()) - new Date(f.createdAt).getTime();
  const auto = f.tours.filter((t) => t.origine === "auto").length;
  return (
    <div className={`fab-banner tone-${ETAT_FAB[f.etat].tone}`} role="status">
      <span className="fab-banner-icon">
        <Icon name={f.etat === "en_cours" ? "spinner" : f.etat === "arretee" ? "alert" : f.etat === "validee" ? "check-circle" : "inbox"} size={18} className={f.etat === "en_cours" ? "spin" : undefined} />
      </span>
      <div className="fab-banner-body">
        <div className="fab-banner-title">
          {f.etat === "en_cours" && <>{etape?.label ?? "…"}{f.tour > 0 && <span className="muted"> · tour de correction {f.tour}</span>}</>}
          {f.etat === "a_valider" && "Tous les contrôles passent : la maquette attend votre décision"}
          {f.etat === "validee" && "Maquette validée : démo prête pour la mise en ligne"}
          {f.etat === "arretee" && "Fabrication arrêtée — à revoir"}
        </div>
        <div className="fab-banner-sub">
          {f.etat === "en_cours" && (liveLabel || liveLine ? <span className="ellipsis">{liveLine ?? liveLabel}</span> : <span>En attente d'une place dans la file…</span>)}
          {f.etat === "arretee" && <span>{f.motif}</span>}
          {(f.etat === "a_valider" || f.etat === "validee") && (
            <span>
              {duree(total)} de fabrication · {auto === 0 ? "aucun tour de correction" : `${auto} tour${auto > 1 ? "s" : ""} de correction`}
              {f.exigences.length > 0 && ` · ${f.exigences.length} demande${f.exigences.length > 1 ? "s" : ""} de modification appliquée${f.exigences.length > 1 ? "s" : ""}`}
            </span>
          )}
        </div>
      </div>
      {f.etat === "en_cours" && <div className="fab-banner-time mono">{duree(total)}</div>}
    </div>
  );
}

// ── Unicité ─────────────────────────────────────────────────────────────────

const virgule = (n: number, d: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** « Unicité : site le plus proche = X, distance d, similarité texte s » (dernière mesure du registre). */
function LigneUnicite({ u }: { u: Unicite }) {
  const pp = u.plusProche;
  const tm = u.texteMax;
  return (
    <p className={`fab-unicite ${u.ok ? "ok" : "ko"}`} title={`Mesuré le ${new Date(u.mesureLe).toLocaleString("fr-FR")} contre ${u.comparaisons} site(s) du registre`}>
      <Icon name={u.ok ? "check-circle" : "alert"} size={14} />
      <span>
        <strong>Unicité</strong>
        {pp ? (
          <>
            {" "}: site le plus proche = {pp.site} ({pp.commune}{pp.km !== null ? `, ${virgule(pp.km, 1)} km` : ""}), distance {virgule(pp.distance, 2)}
            {pp.seuil !== null && <span className="muted"> (min. {virgule(pp.seuil, 2)})</span>}, similarité texte {tm ? virgule(tm.similarite, 3) : "0"}
            {tm && tm.similarite > 0 && <span className="muted"> ({tm.site}, max. {virgule(tm.seuil, 2)})</span>}
            {!u.ok && <> · {u.conflits} conflit{u.conflits > 1 ? "s" : ""}</>}
          </>
        ) : (
          " : aucun autre site au registre"
        )}
      </span>
    </p>
  );
}

// ── Actions humaines ────────────────────────────────────────────────────────

function Actions({ siteId, f, onDone }: { siteId: string; f: Fabrication; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [modif, setModif] = useState(false);
  const [confirmRefaire, setConfirmRefaire] = useState(false);
  const [texte, setTexte] = useState("");
  const act = async (what: "valider" | "refaire" | "reprendre" | "modifications", body?: unknown) => {
    setBusy(true);
    try {
      await api.post(`/api/sites/${siteId}/${what}`, body);
      toast.ok(
        what === "valider" ? "Maquette validée : démo prête" : what === "refaire" ? "On repart de la direction artistique" : what === "reprendre" ? "Fabrication reprise" : "Demande envoyée : tour de correction lancé",
      );
      setModif(false);
      setConfirmRefaire(false);
      setTexte("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const peutModifier = f.etat !== "en_cours" && f.passes.some((p) => p.etape === "controles");
  return (
    <>
      {f.etat === "arretee" && (f.motifType === "technique" || f.motifType === "annulee") && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => act("reprendre")}>
          <Icon name="play" size={15} /> Reprendre
        </button>
      )}
      {confirmRefaire ? (
        <span className="confirm-inline">
          <span className="muted small">Repartir de la direction artistique ?</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmRefaire(false)}>
            Non
          </button>
          <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act("refaire")}>
            Refaire
          </button>
        </span>
      ) : (
        <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmRefaire(true)} title="Nouveau design depuis l'étape 2 (le brief est gardé)">
          <Icon name="redo" size={15} /> Refaire
        </button>
      )}
      {peutModifier && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => setModif(true)}>
          <Icon name="message" size={15} /> Demander des modifications
        </button>
      )}
      {f.etat === "a_valider" && (
        <button className="btn btn-primary" disabled={busy} onClick={() => act("valider")}>
          <Icon name="check" size={15} /> Valider
        </button>
      )}
      <Drawer
        open={modif}
        onClose={() => setModif(false)}
        title="Demander des modifications"
        footer={
          <>
            <span className="foot-hint">Votre texte est transmis mot pour mot à l'Intégrateur, puis tous les contrôles repassent.</span>
            <button className="btn btn-primary" disabled={busy || texte.trim().length < 5} onClick={() => act("modifications", { texte })}>
              <Icon name="wand" size={15} /> Lancer la correction
            </button>
          </>
        }
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">Ce qu'il faut changer</span>
            <textarea
              className="textarea"
              rows={8}
              autoFocus
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              placeholder="Ex. : le hero est trop sombre, prenez une photo plus lumineuse ; retirez la section réalisations."
            />
          </label>
          {f.exigences.length > 0 && (
            <div>
              <div className="section-label">Demandes précédentes (toujours exigées)</div>
              <ul className="bullets">
                {f.exigences.map((e, i) => (
                  <li key={i}>« {e} »</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Drawer>
    </>
  );
}

// ── Frise des étapes ────────────────────────────────────────────────────────

type Ligne = { etape: EtapeMeta; passe: Passe | null };

/** Groupes : la fabrication (suite de la recette), puis chaque tour de correction. */
function grouper(f: Fabrication, recette: RecetteAtelier): { titre: string; tour: Tour | null; lignes: Ligne[] }[] {
  const meta = (id: string) => recette.etapes.find((e) => e.id === id) ?? { id, label: id, detail: "", agent: null, groupe: "fabrication" as const };
  const groupes: { titre: string; tour: Tour | null; lignes: Ligne[] }[] = [{ titre: "Fabrication", tour: null, lignes: [] }];
  let courant = groupes[0]!;
  let iTour = 0;
  for (const p of f.passes) {
    if (p.etape === recette.correction.etape) {
      const tour = f.tours[iTour++] ?? null;
      courant = { titre: tour?.origine === "demande" ? "Modifications demandées" : `Tour de correction ${tour ? f.tours.filter((t, i) => t.origine === "auto" && i <= f.tours.indexOf(tour)).length : ""}`, tour, lignes: [] };
      groupes.push(courant);
    } else if (p.etape === recette.refaire && courant.lignes.some((l) => l.etape.id === p.etape && l.passe?.etat !== "renvoi") && !courant.lignes.some((l) => l.passe?.etat === "renvoi")) {
      courant = { titre: "Refaire", tour: null, lignes: [] };
      groupes.push(courant);
    }
    courant.lignes.push({ etape: meta(p.etape), passe: p });
  }
  // Étapes à venir du groupe en cours (grisées).
  if (f.etat === "en_cours") {
    const dernier = f.passes.at(-1);
    const seq = courant.tour ? [recette.correction.etape, ...recette.sequence.slice(recette.sequence.indexOf(recette.correction.retour))] : recette.sequence;
    const idx = dernier ? seq.lastIndexOf(dernier.etape) : -1;
    for (const id of seq.slice(idx + 1)) courant.lignes.push({ etape: meta(id), passe: null });
  } else if (!f.passes.length) {
    for (const id of recette.sequence) courant.lignes.push({ etape: meta(id), passe: null });
  }
  return groupes;
}

function Frise({ f, recette }: { f: Fabrication; recette: RecetteAtelier }) {
  const { meta } = useLive();
  const groupes = useMemo(() => grouper(f, recette), [f, recette]);
  const now = Date.now();
  const agent = (id: string | null) => (id ? meta?.agents.find((a) => a.id === id) : undefined);
  return (
    <div className="frise">
      {groupes.map((g, gi) => (
        <div key={gi} className="frise-groupe">
          <div className="frise-titre">
            {g.titre}
            {g.tour?.resultat && <span className={`badge tone-${g.tour.resultat === "ok" ? "green" : "red"}`}>{g.tour.resultat === "ok" ? "réussi" : "encore en échec"}</span>}
          </div>
          <ol className="steps">
            {g.lignes.map((l, i) => {
              const st = l.passe ? PASSE[l.passe.etat] : null;
              const a = agent(l.etape.agent);
              return (
                <li key={`${l.etape.id}-${l.passe?.n ?? `a${i}`}`} className={`step ${l.passe ? `is-${l.passe.etat}` : "pending"}`}>
                  <span className={`step-dot ${st ? `tone-${st.tone}` : ""}`} style={a && !l.passe ? { borderColor: a.couleur } : undefined}>
                    {st ? <Icon name={st.icon} size={12} className={l.passe?.etat === "en_cours" ? "spin" : undefined} /> : null}
                  </span>
                  <div className="step-body">
                    <div className="step-top">
                      <span className="step-label">{l.etape.label}</span>
                      {l.passe && (l.passe.debut || l.passe.etat === "en_cours") && <span className="step-time mono">{duree(dureePasse(l.passe, now))}</span>}
                    </div>
                    <div className="step-agent">
                      {a ? (
                        <span className="agent-chip" style={{ ["--agent" as string]: a.couleur }}>
                          <span className="agent-dot" /> {a.nom}
                        </span>
                      ) : (
                        <span className="agent-chip hub">Code du hub</span>
                      )}
                    </div>
                    {l.passe?.resume ? <SortiePasse passe={l.passe} /> : !l.passe ? <div className="step-detail">{l.etape.detail}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** Résumé d'une étape, et sa sortie complète repliée. */
function SortiePasse({ passe }: { passe: Passe }) {
  const sortie = passe.sortie as Record<string, unknown> | undefined;
  return (
    <details className="step-out">
      <summary>
        <span className={`step-resume${passe.etat === "echec" || passe.etat === "erreur" ? " bad" : ""}`}>{passe.resume}</span>
      </summary>
      {sortie ? <SortieDetail etape={passe.etape} sortie={sortie} /> : <p className="muted small">Pas de détail pour cette étape.</p>}
    </details>
  );
}

function SortieDetail({ etape, sortie }: { etape: string; sortie: Record<string, unknown> }) {
  const texte = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));
  if (typeof sortie.compteRendu === "string") return <pre className="out-pre">{sortie.compteRendu}</pre>;
  if (etape === "da" && Array.isArray(sortie.intention)) {
    return (
      <div className="out">
        <ul className="bullets">{(sortie.intention as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
        <p className="small"><strong>Teinte :</strong> {texte(sortie.ajustements)}</p>
        <p className="small"><strong>Composition :</strong> {(sortie.sections as string[]).join(" → ")}</p>
        {Array.isArray(sortie.refus) && <ul className="bullets bad">{(sortie.refus as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>
    );
  }
  if (Array.isArray(sortie.refus)) {
    return <ul className="bullets bad">{(sortie.refus as { message?: string }[]).map((r, i) => <li key={i}>{r.message ?? texte(r)}</li>)}</ul>;
  }
  return <pre className="out-pre">{texte(sortie)}</pre>;
}

// ── Aperçu ──────────────────────────────────────────────────────────────────

type Support = "mobile" | "tablette" | "bureau";
const TAILLES: Record<Support, { w: number; h: number; label: string; icon: string }> = {
  mobile: { w: 390, h: 844, label: "Mobile", icon: "smartphone" },
  tablette: { w: 820, h: 1180, label: "Tablette", icon: "layers" },
  bureau: { w: 1440, h: 900, label: "Ordinateur", icon: "monitor" },
};

/** Iframe à la taille réelle du support, réduite à la largeur disponible (rendu identique au vrai appareil). */
function Ecran({ src, support, maxH, titre }: { src: string; support: Support; maxH?: number; titre: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    // On mesure le conteneur, pas l'écran lui-même : sa largeur dépend de l'échelle (plein écran), elle bouclerait.
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const t = TAILLES[support];
  // Jamais agrandi au-delà de la taille réelle ; en plein écran, réduit aussi pour tenir en hauteur.
  let scale = w ? Math.min(1, w / t.w) : 0;
  if (maxH && scale * t.h > maxH) scale = maxH / t.h;
  return (
    // Le cadre prend la taille exacte de l'écran simulé : pas de bande vide à côté.
    <div ref={ref} className="ecran" style={{ height: scale ? t.h * scale : undefined, width: scale ? t.w * scale : undefined }}>
      {scale > 0 && <iframe title={titre} src={src} loading="lazy" style={{ width: t.w, height: t.h, transform: `scale(${scale})` }} />}
    </div>
  );
}

function Apercu({ siteId, disponible, version, port }: { siteId: string; disponible: boolean; version: string; port: number | null }) {
  const [plein, setPlein] = useState<Support | null>(null);
  const url = port ? `http://${siteId}.localhost:${port}/` : null;
  const src = url ? `${url}?v=${encodeURIComponent(version)}` : "";
  useEffect(() => {
    if (!plein) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlein(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plein]);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="eye" size={16} /> Aperçu
        </h2>
        {disponible && url && (
          <div className="push head-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setPlein("bureau")}>
              <Icon name="maximize" size={14} /> Plein écran
            </button>
            <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> Ouvrir dans un onglet
            </a>
          </div>
        )}
      </header>
      {!disponible || !url ? (
        <div className="preview">
          <div className="device phone">
            <div className="device-screen">
              <span>Mobile</span>
            </div>
          </div>
          <div className="device desktop">
            <div className="device-screen">
              <span>Le site apparaîtra ici après son premier build</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="preview live">
          <figure className="frame frame-phone">
            <div className="frame-notch" />
            <Ecran src={src} support="mobile" titre="Aperçu mobile" />
            <figcaption>Mobile · 390 px</figcaption>
          </figure>
          <figure className="frame frame-desktop">
            <div className="frame-bar">
              <span />
              <span />
              <span />
              <div className="frame-url mono">{url.replace(/^http:\/\//, "")}</div>
            </div>
            <Ecran src={src} support="bureau" titre="Aperçu ordinateur" />
            <figcaption>Ordinateur · 1440 px</figcaption>
          </figure>
        </div>
      )}
      {plein &&
        url &&
        createPortal(
          <div className="fullscreen" role="dialog" aria-modal="true" aria-label="Aperçu plein écran">
            <div className="fullscreen-bar">
              <div className="seg" role="radiogroup" aria-label="Support">
                {(Object.keys(TAILLES) as Support[]).map((k) => (
                  <button key={k} role="radio" aria-checked={plein === k} className={plein === k ? "on" : ""} onClick={() => setPlein(k)}>
                    <Icon name={TAILLES[k].icon} size={14} /> {TAILLES[k].label}
                  </button>
                ))}
              </div>
              <span className="muted small mono">{TAILLES[plein].w} × {TAILLES[plein].h}</span>
              <a className="btn btn-ghost btn-sm push" href={url} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> Onglet
              </a>
              <button className="icon-btn" onClick={() => setPlein(null)} aria-label="Fermer le plein écran">
                <Icon name="minimize" size={16} />
              </button>
            </div>
            <div className={`fullscreen-stage stage-${plein}`}>
              <Ecran key={plein} src={src} support={plein} maxH={window.innerHeight - 96} titre={`Aperçu ${TAILLES[plein].label}`} />
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

// ── Contrôles ───────────────────────────────────────────────────────────────

const derniere = (f: Fabrication, etape: string) => [...f.passes].reverse().find((p) => p.etape === etape && (p.etat === "ok" || p.etat === "echec"));

function Jauge({ label, value, seuil, note }: { label: string; value: number | null; seuil?: number; note?: string }) {
  const ok = value != null && (seuil == null || value >= seuil);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className={`jauge ${value == null ? "na" : ok ? "ok" : "ko"}`} title={note}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="jauge-fond" />
        <circle cx="28" cy="28" r={r} className="jauge-val" strokeDasharray={`${((value ?? 0) / 100) * c} ${c}`} />
      </svg>
      <span className="jauge-n">{value ?? "—"}</span>
      <span className="jauge-l">{label}</span>
    </div>
  );
}

const CRITERES: [string, string][] = [
  ["hierarchie", "Hiérarchie"],
  ["espacement", "Espacement et rythme"],
  ["typographie", "Typographie"],
  ["couleur_images", "Couleur et images"],
  ["finition", "Finition"],
  ["mobile", "Mobile"],
];

function Controles({ f, recette }: { f: Fabrication; recette: RecetteAtelier | null }) {
  const c = derniere(f, "controles");
  const fa = derniere(f, "faits");
  const vi = derniere(f, "visuel");
  const ux = derniere(f, "ux");
  const cs = c?.sortie as { lighthouse: { performance: number; accessibilite: number; bonnesPratiques: number; seo: number; metriques?: Record<string, number> } | null; axe: { graves: number; violations: { id: string; impact: string; aide: string }[] } | null; echecs: string[] } | undefined;
  const fs = fa?.sortie as { verifies: number; problemes: { phrase: string; section: string; statut: string; correction?: string }[] } | undefined;
  const vs = vi?.sortie as { moyenne: number; min: number; scores: Record<string, number>; justifications: Record<string, string>; blocking: { capture: string; probleme: string }[] } | undefined;
  const us = ux?.sortie as { problemes: { gravite: string; parcours: string; constat: string; consigne: string }[] } | undefined;
  const seuil = recette?.seuils.lighthouse ?? 95;
  const tag = (p: Passe | undefined) => (p ? <span className={`badge tone-${p.etat === "ok" ? "green" : "red"}`}>{p.etat === "ok" ? "passe" : "échec"}</span> : <span className="badge tone-neutral">à venir</span>);
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="gauge" size={16} /> Contrôles
        </h2>
        <span className="muted small push">Un contrôle raté renvoie en correction, {recette?.correction.toursMax ?? 3} tours au plus.</span>
      </header>
      <div className="ctrl-grid">
        <div className="ctrl">
          <div className="ctrl-head">Lighthouse mobile {tag(c)}</div>
          <div className="jauges">
            <Jauge label="Performance" value={cs?.lighthouse?.performance ?? null} seuil={seuil} />
            <Jauge label="Accessibilité" value={cs?.lighthouse?.accessibilite ?? null} seuil={seuil} />
            <Jauge label="Bonnes pratiques" value={cs?.lighthouse?.bonnesPratiques ?? null} seuil={seuil} />
            <Jauge label="SEO" value={cs?.lighthouse?.seo ?? null} note="Démo : noindex voulu, hors seuil" />
          </div>
          <div className="ctrl-foot">
            <span>axe : <strong>{cs?.axe ? `${cs.axe.graves} grave${cs.axe.graves > 1 ? "s" : ""}` : "—"}</strong>{cs?.axe && cs.axe.violations.length > cs.axe.graves && <span className="muted"> · {cs.axe.violations.length - cs.axe.graves} mineure(s)</span>}</span>
            {cs?.lighthouse?.metriques && <span className="muted mono">LCP {duree(cs.lighthouse.metriques.lcpMs ?? null)} · CLS {cs.lighthouse.metriques.cls}</span>}
          </div>
          {cs && cs.echecs.length > 0 && <ul className="bullets bad small">{cs.echecs.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>

        <div className="ctrl">
          <div className="ctrl-head">Revue visuelle {tag(vi)}</div>
          {vs ? (
            <>
              <div className="moyenne">
                <span className="moyenne-n">{vs.moyenne.toLocaleString("fr-FR")}</span>
                <span className="muted">/5 de moyenne · minimum {vs.min}/5 · seuil {recette?.seuils.visuelMoyenne ?? 4} et {recette?.seuils.visuelMin ?? 3}</span>
              </div>
              <ul className="crit-notes">
                {CRITERES.map(([k, l]) => (
                  <li key={k} title={vs.justifications[k]}>
                    <span className="note-l">{l}</span>
                    <span className="note-bar">
                      <span style={{ width: `${((vs.scores[k] ?? 0) / 5) * 100}%` }} className={`n${vs.scores[k]}`} />
                    </span>
                    <span className="note-n mono">{vs.scores[k]}</span>
                  </li>
                ))}
              </ul>
              {vs.blocking.length > 0 && <ul className="bullets bad small">{vs.blocking.map((b, i) => <li key={i}>[{b.capture}] {b.probleme}</li>)}</ul>}
            </>
          ) : (
            <p className="muted small">Notes par critère après la relecture des captures.</p>
          )}
        </div>

        <div className="ctrl">
          <div className="ctrl-head">Faits {tag(fa)}</div>
          {fs ? (
            fs.problemes.length === 0 ? (
              <p className="small"><Icon name="check" size={13} /> {fs.verifies} affirmations comparées au brief, toutes sourcées.</p>
            ) : (
              <ul className="bullets bad small">{fs.problemes.map((p, i) => <li key={i}>« {p.phrase} » ({p.section}) : {p.statut.replace("_", " ")}</li>)}</ul>
            )
          ) : (
            <p className="muted small">Texte rendu comparé au brief.</p>
          )}
        </div>

        <div className="ctrl">
          <div className="ctrl-head">Relecture UX {tag(ux)}</div>
          {us ? (
            us.problemes.length === 0 ? (
              <p className="small">Aucun problème relevé.</p>
            ) : (
              <ul className="ux-list">
                {us.problemes.map((p, i) => (
                  <li key={i}>
                    <span className={`badge tone-${p.gravite === "bloquant" ? "red" : p.gravite === "majeur" ? "amber" : "neutral"}`}>{p.gravite}</span>
                    <span className="small">{p.constat}</span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="muted small">Parcours mobile, conversion, finitions.</p>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Captures ────────────────────────────────────────────────────────────────

function Captures({ siteId, captures, pleinePage, version }: { siteId: string; captures: string[]; pleinePage: string[]; version: string }) {
  const [ouverte, setOuverte] = useState<string | null>(null);
  const base = `/files/sites/${siteId}`;
  const libelle = (f: string) => f.replace(/^\d+-/, "").replace(/\.png$/, "").replace("ecran-initial", "écran initial").replace(/-/g, " ");
  useEffect(() => {
    if (!ouverte) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOuverte(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ouverte]);
  if (!captures.length) return null;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="image" size={16} /> Captures relues par les agents
        </h2>
        <span className="muted small push">
          Pleine page :{" "}
          {pleinePage.map((f, i) => (
            <span key={f}>
              {i > 0 && " · "}
              <a href={`${base}/.check/${f}?v=${version}`} target="_blank" rel="noreferrer">
                {f.replace("capture-", "").replace(".png", " px")}
              </a>
            </span>
          ))}
        </span>
      </header>
      <div className="captures">
        {captures.map((c) => (
          <button key={c} className={`capture ${c.includes("bureau") ? "wide" : ""}`} onClick={() => setOuverte(c)}>
            <img src={`${base}/.atelier/revue/${c}?v=${version}`} alt={`Capture ${libelle(c)}`} loading="lazy" />
            <span>{libelle(c)}</span>
          </button>
        ))}
      </div>
      {ouverte &&
        createPortal(
          <div className="lightbox" role="dialog" aria-modal="true" aria-label={libelle(ouverte)} onClick={() => setOuverte(null)}>
            <img src={`${base}/.atelier/revue/${ouverte}?v=${version}`} alt={`Capture ${libelle(ouverte)}`} />
            <button className="icon-btn lightbox-close" aria-label="Fermer">
              <Icon name="x" size={16} />
            </button>
          </div>,
          document.body,
        )}
    </section>
  );
}

// ── Intention du DA ─────────────────────────────────────────────────────────

function Intention({ f }: { f: Fabrication }) {
  const da = [...f.passes].reverse().find((p) => p.etape === "da" && p.etat === "ok");
  const red = [...f.passes].reverse().find((p) => p.etape === "redaction" && p.etat === "ok");
  if (!da?.sortie) return null;
  const s = da.sortie as { intention: string[]; theme: { preset: string; couleurs?: Record<string, string>; polices?: { titres?: string; corps?: string }; signature?: string }; ajustements: string; signature: { element: string; description: string }; sections: string[]; images: { cle: string; fichier: string; justification: string }[] };
  const r = red?.sortie as { titre?: string; seo?: { description: string }; laisseDeCote?: string[] } | undefined;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="palette" size={16} /> Intention du Directeur artistique
        </h2>
      </header>
      <div className="intention">
        <ol className="intention-phrases">
          {s.intention.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
        <div className="intention-side">
          <div className="swatches" aria-label="Teintes surchargées">
            {Object.entries(s.theme.couleurs ?? {}).map(([k, v]) => (
              <span key={k} className="swatch" title={`${k} ${v}`}>
                <span style={{ background: v }} />
                <span className="mono">{k}</span>
              </span>
            ))}
          </div>
          <dl className="kv small">
            <dt>Préréglage</dt>
            <dd>{s.theme.preset}{s.theme.polices?.titres && ` · titres ${s.theme.polices.titres}`}{s.theme.polices?.corps && ` · corps ${s.theme.polices.corps}`}{s.theme.signature && ` · signature ${s.theme.signature}`}</dd>
            <dt>Élément signature</dt>
            <dd>{s.signature.element} — <span className="muted">{s.signature.description}</span></dd>
            <dt>Composition</dt>
            <dd>{s.sections.join(" → ")}</dd>
            {r?.titre && (
              <>
                <dt>Titre (H1)</dt>
                <dd>« {r.titre} »</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <details className="fold">
        <summary>Photos choisies et pourquoi ({s.images.length})</summary>
        <ul className="bullets small">
          {s.images.map((im) => (
            <li key={im.cle}>
              <span className="mono">{im.fichier.replace("stock/", "")}</span> — {im.justification}
            </li>
          ))}
        </ul>
      </details>
      {r?.laisseDeCote && r.laisseDeCote.length > 0 && (
        <details className="fold">
          <summary>Laissé de côté par le Rédacteur, faute de source ({r.laisseDeCote.length})</summary>
          <ul className="bullets small">{r.laisseDeCote.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </details>
      )}
    </section>
  );
}

// ── Tours de correction ─────────────────────────────────────────────────────

function Tours({ f, recette }: { f: Fabrication; recette: RecetteAtelier | null }) {
  if (!f.tours.length && !f.exigences.length) return null;
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="retry" size={16} /> Tours de correction
        </h2>
        <span className="muted small push">{f.tours.filter((t) => t.origine === "auto").length} automatique(s) · {recette?.correction.toursMax ?? 3} au plus par passage</span>
      </header>
      <ol className="tours">
        {f.tours.map((t) => (
          <li key={t.n} className="tour">
            <details>
              <summary>
                <span className="tour-n">{t.n}</span>
                <span className="tour-title">{t.origine === "demande" ? "Demande du propriétaire" : "Correction automatique"}</span>
                <span className="muted small">{t.consignes.length} consigne{t.consignes.length > 1 ? "s" : ""}</span>
                {t.resultat ? <span className={`badge tone-${t.resultat === "ok" ? "green" : "red"} push`}>{t.resultat === "ok" ? "contrôles réussis" : "encore en échec"}</span> : <span className="badge tone-blue push">en cours</span>}
              </summary>
              <Consignes consignes={t.consignes} />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Consignes({ consignes }: { consignes: { origine: string; texte: string }[] }): ReactNode {
  const groupes = new Map<string, string[]>();
  for (const c of consignes) groupes.set(c.origine, [...(groupes.get(c.origine) ?? []), c.texte]);
  return (
    <div className="consignes">
      {[...groupes].map(([o, l]) => (
        <div key={o}>
          <div className="section-label">{o}</div>
          <ul className="bullets small">{l.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
