import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Company, type Source } from "../api.ts";
import { useApi, useLive } from "../live.tsx";
import type { Campagne, EntreeFile, EtatProspection, FicheProspect, LigneProspect, StatutSite } from "../prospection-api.ts";
import { Link, navigate, usePath } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Drawer, Empty, ErrorNote, formatDate, PageHeader, Skeleton, timeAgo } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { Badge, SourceTag, STATUT, StatutBadge } from "./labels.tsx";
import { CampagneForm } from "./prospection/CampagneForm.tsx";
import { GrilleEditor, MaquettesFile, RgpdPanel } from "./prospection/Onglets.tsx";
import "./prospection/prospection.css";

export const SITE: Record<StatutSite, { label: string; tone: string; groupe: "sans" | "defaillant" | "correct" | "inconnu" }> = {
  aucun: { label: "Aucun site", tone: "green", groupe: "sans" },
  annuaire_seulement: { label: "Annuaire seulement", tone: "green", groupe: "sans" },
  injoignable: { label: "Site injoignable", tone: "green", groupe: "sans" },
  sans_https: { label: "Sans HTTPS", tone: "amber", groupe: "defaillant" },
  non_mobile: { label: "Non mobile", tone: "amber", groupe: "defaillant" },
  date: { label: "Site daté", tone: "amber", groupe: "defaillant" },
  correct: { label: "Site correct", tone: "muted", groupe: "correct" },
  inconnu: { label: "Non audité", tone: "neutral", groupe: "inconnu" },
};

export function SiteBadgeProspect({ statut }: { statut: StatutSite | null }) {
  if (!statut) return <span className="muted">—</span>;
  return <Badge tone={SITE[statut].tone}>{SITE[statut].label}</Badge>;
}

const ONGLETS = [
  { id: "prospects", label: "Prospects", icon: "companies" },
  { id: "maquettes", label: "File des maquettes", icon: "wand" },
  { id: "grille", label: "Grille de score", icon: "gauge" },
  { id: "rgpd", label: "RGPD", icon: "shield-check" },
] as const;
type Onglet = (typeof ONGLETS)[number]["id"];

export const copier = async (texte: string, toast: ReturnType<typeof useToast>, quoi = "Numéro copié") => {
  try {
    await navigator.clipboard.writeText(texte);
    toast.ok(`${quoi} : ${texte}`);
  } catch {
    toast.error("Copie impossible : sélectionnez le texte à la main");
  }
};

export const urlSite = (s: string) => (/^https?:\/\//i.test(s) ? s : `http://${s}`);

export function ProspectionPage() {
  const path = usePath();
  const params = new URLSearchParams(location.search);
  const ficheId = path.startsWith("/prospection/") ? path.slice("/prospection/".length) : null;
  const onglet = (params.get("onglet") as Onglet) || "prospects";
  const campagneId = params.get("campagne");
  const [form, setForm] = useState<Campagne | "nouvelle" | null>(null);
  const etat = useApi<EtatProspection>("/api/prospection/etat", ["prospection", "settings", "sites"]);
  const campagnes = useApi<{ campagnes: Campagne[] }>("/api/prospection/campagnes", ["prospection", "jobs"]);
  const file = useApi<{ file: EntreeFile[]; enFabrication: number; parallele: number }>("/api/prospection/maquettes", ["prospection", "sites"]);
  const enCours = campagnes.data?.campagnes.some((c) => c.etat === "en_cours");

  // Une campagne tourne : ses compteurs sont relus toutes les 2 s (ils ne passent pas par le journal).
  useEffect(() => {
    if (!enCours) return;
    const t = setInterval(() => campagnes.reload(), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enCours]);

  const aller = (o: { onglet?: Onglet; campagne?: string | null }) => {
    const p = new URLSearchParams(location.search);
    if (o.onglet !== undefined) o.onglet === "prospects" ? p.delete("onglet") : p.set("onglet", o.onglet);
    if (o.campagne !== undefined) o.campagne ? p.set("campagne", o.campagne) : p.delete("campagne");
    const qs = p.toString();
    navigate(`/prospection${qs ? `?${qs}` : ""}`);
  };
  const attente = file.data?.file.filter((f) => f.etat === "en_attente").length ?? 0;

  return (
    <div className="page prosp-page">
      <PageHeader
        title="Prospection"
        subtitle="Trouver les entreprises mal représentées en ligne, vérifier, noter, puis lancer leur maquette."
        actions={
          <button className="btn btn-primary" onClick={() => setForm("nouvelle")}>
            <Icon name="plus" size={15} /> Nouvelle campagne
          </button>
        }
      />
      <div className="prosp-tabs" role="tablist" aria-label="Sections de la prospection">
        {ONGLETS.map((o) => (
          <button key={o.id} role="tab" aria-selected={onglet === o.id} className={`prosp-tab${onglet === o.id ? " on" : ""}`} onClick={() => aller({ onglet: o.id })}>
            <Icon name={o.icon} size={15} />
            {o.label}
            {o.id === "maquettes" && attente > 0 && <span className="chip-n">{attente}</span>}
            {o.id === "prospects" && etat.data && <span className="chip-n">{etat.data.prospects}</span>}
          </button>
        ))}
      </div>

      {etat.data && !etat.data.places.configure && onglet === "prospects" && (
        <div className="hint-box prosp-hint" role="note">
          <Icon name="info" size={15} />
          <span>
            <strong>Google Places n'est pas configuré.</strong> Les campagnes tournent avec Sirene et OpenStreetMap : téléphones et sites viennent seulement d'OSM (peu
            renseigné), les avis Google sont inconnus, et « aucun site » reste à vérifier. Avec la clé, chaque fiche gagne téléphone, site, note, nombre d'avis et horaires.{" "}
            <Link to="/reglages" className="inline-link">
              Ajouter la clé dans Réglages
            </Link>
          </span>
        </div>
      )}

      {onglet === "prospects" && (
        <>
          <CampagnesBande campagnes={campagnes.data?.campagnes ?? null} etat={etat.data} active={campagneId} onSelect={(id) => aller({ campagne: id })} onEdit={(c) => setForm(c)} reload={campagnes.reload} />
          <Prospects campagne={campagnes.data?.campagnes.find((c) => c.id === campagneId) ?? null} campagneId={campagneId} ficheId={ficheId} />
        </>
      )}
      {onglet === "maquettes" && <MaquettesFile data={file.data} reload={file.reload} />}
      {onglet === "grille" && <GrilleEditor />}
      {onglet === "rgpd" && <RgpdPanel etat={etat.data} />}

      <FicheDrawer id={ficheId} onClose={() => navigate(`/prospection${location.search}`)} />
      <CampagneForm
        open={form !== null}
        campagne={form === "nouvelle" ? null : form}
        etat={etat.data}
        onClose={() => setForm(null)}
        onSaved={(c) => {
          setForm(null);
          campagnes.reload();
          aller({ onglet: "prospects", campagne: c.id });
        }}
      />
    </div>
  );
}

// ── Bande des campagnes ─────────────────────────────────────────────────────

const ETAT_CAMPAGNE: Record<Campagne["etat"], { label: string; tone: string }> = {
  brouillon: { label: "Brouillon", tone: "neutral" },
  en_cours: { label: "En cours", tone: "blue" },
  terminee: { label: "Terminée", tone: "green" },
  erreur: { label: "Erreur", tone: "red" },
  annulee: { label: "Annulée", tone: "muted" },
};

export function zoneTexte(c: Campagne["criteres"]["zone"]): string {
  if (c.type === "rayon") return `${c.commune} + ${c.rayonKm} km`;
  if (c.type === "departements") return `Département${c.departements.length > 1 ? "s" : ""} ${c.departements.join(", ")}`;
  return c.communes.length > 3 ? `${c.communes.slice(0, 3).join(", ")} +${c.communes.length - 3}` : c.communes.join(", ");
}

function CampagnesBande({ campagnes, etat, active, onSelect, onEdit, reload }: { campagnes: Campagne[] | null; etat: EtatProspection | null; active: string | null; onSelect: (id: string | null) => void; onEdit: (c: Campagne) => void; reload: () => void }) {
  if (!campagnes) return <Skeleton rows={2} />;
  if (!campagnes.length)
    return (
      <div className="prosp-first">
        <div className="prosp-first-icon">
          <Icon name="prospection" size={24} />
        </div>
        <div>
          <h3>Première campagne</h3>
          <p className="muted">
            Choisissez des métiers et une zone : le hub interroge l'API Recherche d'entreprises (gratuite), complète avec OpenStreetMap et Google Places, visite les sites
            existants, puis note chaque entreprise avec la grille du plan.
          </p>
        </div>
      </div>
    );
  return (
    <div className="camp-strip" role="list" aria-label="Campagnes">
      <button role="listitem" className={`camp-card camp-all${active === null ? " on" : ""}`} onClick={() => onSelect(null)}>
        <span className="camp-name">Tous les prospects</span>
        <span className="camp-zone">{etat ? `${etat.prospects} en base · ${etat.qualifies} qualifiés` : "…"}</span>
      </button>
      {campagnes.map((c, i) => (
        <CampagneCarte key={c.id} c={c} on={active === c.id} onSelect={() => onSelect(c.id)} onEdit={() => onEdit(c)} reload={reload} delai={i} metiers={etat?.metiers ?? []} />
      ))}
    </div>
  );
}

function CampagneCarte({ c, on, onSelect, onEdit, reload, delai, metiers }: { c: Campagne; on: boolean; onSelect: () => void; onEdit: () => void; reload: () => void; delai: number; metiers: EtatProspection["metiers"] }) {
  const toast = useToast();
  const { jobs } = useLive();
  const job = c.jobId ? jobs.get(c.jobId) : undefined;
  const k = c.compteurs;
  const action = async (quoi: "lancer" | "annuler") => {
    try {
      await api.post(`/api/prospection/campagnes/${c.id}/${quoi}`);
      toast.ok(quoi === "lancer" ? "Campagne lancée" : "Campagne annulée");
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const libMetiers = c.criteres.metiers.map((m) => metiers.find((x) => x.id === m)?.libelle ?? m);
  const pct = job?.progress.pct ?? null;
  return (
    <div role="listitem" className={`camp-card${on ? " on" : ""}`} style={{ animationDelay: `${delai * 40}ms` }}>
      <button className="camp-main" onClick={onSelect} aria-pressed={on}>
        <span className="camp-top">
          <span className="camp-name">{c.nom}</span>
          <Badge tone={ETAT_CAMPAGNE[c.etat].tone} dot>
            {ETAT_CAMPAGNE[c.etat].label}
          </Badge>
        </span>
        <span className="camp-zone">
          <Icon name="pin" size={12} /> {zoneTexte(c.criteres.zone)} · {libMetiers.slice(0, 2).join(", ")}
          {libMetiers.length > 2 ? ` +${libMetiers.length - 2}` : ""}
        </span>
        {c.etat === "en_cours" ? (
          <span className="camp-live">
            <span className="camp-phase">{job?.progress.label ?? "En file…"}</span>
            <span className={`progress${pct == null ? " indeterminate" : ""}`}>
              <span className="progress-bar" style={{ width: `${pct ?? 30}%` }} />
            </span>
          </span>
        ) : c.etat === "erreur" ? (
          <span className="camp-err text-danger">{c.erreur}</span>
        ) : null}
        <span className="camp-stats">
          <Stat n={k.sources} label="sourcées" />
          <Stat n={k.avecSite} label="avec site" />
          <Stat n={k.sansSite} label="sans site" />
          <Stat n={k.qualifies} label="qualifiées" accent />
          {k.aVerifier ? <Stat n={k.aVerifier} label="à vérifier" /> : null}
        </span>
      </button>
      <span className="camp-actions">
        {c.etat === "en_cours" ? (
          <button className="icon-btn sm" onClick={() => action("annuler")} title="Annuler la campagne" aria-label="Annuler la campagne">
            <Icon name="cancel" size={14} />
          </button>
        ) : (
          <>
            <button className="icon-btn sm" onClick={() => action("lancer")} title={c.lanceeLe ? "Relancer (fiches mises à jour, jamais dupliquées)" : "Lancer"} aria-label="Lancer la campagne">
              <Icon name={c.lanceeLe ? "retry" : "play"} size={14} />
            </button>
            <button className="icon-btn sm" onClick={onEdit} title="Modifier les critères" aria-label="Modifier les critères">
              <Icon name="edit" size={14} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function Stat({ n, label, accent }: { n: number | undefined; label: string; accent?: boolean }) {
  return (
    <span className={`camp-stat${accent ? " accent" : ""}`}>
      <b>{n ?? "—"}</b> {label}
    </span>
  );
}

// ── Tableau des prospects ───────────────────────────────────────────────────

type Tri = "score" | "nom" | "metier" | "commune" | "distance" | "avis" | "site";
const FILTRES_SITE = [
  { id: "", label: "Tous" },
  { id: "sans", label: "Sans vrai site" },
  { id: "defaillant", label: "Site défaillant" },
  { id: "correct", label: "Site correct" },
  { id: "inconnu", label: "Non audité" },
] as const;
const FILTRES_SCORE = [
  { id: "", label: "Tous les scores" },
  { id: "qualifies", label: "Qualifiés" },
  { id: "verifier", label: "À vérifier" },
] as const;

function Prospects({ campagne, campagneId, ficheId }: { campagne: Campagne | null; campagneId: string | null; ficheId: string | null }) {
  const toast = useToast();
  const url = `/api/prospection/prospects${campagneId ? `?campagne=${campagneId}` : ""}`;
  const { data, error, loading, reload } = useApi<{ prospects: LigneProspect[] }>(url, ["prospection", "companies", "sites"]);
  const [q, setQ] = useState("");
  const [site, setSite] = useState<(typeof FILTRES_SITE)[number]["id"]>("");
  const [qualifies, setQualifies] = useState<(typeof FILTRES_SCORE)[number]["id"]>("");
  const [ecartes, setEcartes] = useState(false);
  const [metier, setMetier] = useState("");
  const [commune, setCommune] = useState("");
  const [tri, setTri] = useState<{ cle: Tri; sens: 1 | -1 }>({ cle: "score", sens: -1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exclusion, setExclusion] = useState<string[] | null>(null);
  const [envoi, setEnvoi] = useState(false);

  // La campagne tourne : le tableau suit.
  useEffect(() => {
    if (campagne?.etat !== "en_cours") return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagne?.etat, url]);
  useEffect(() => setSel(new Set()), [campagneId]);

  const all = data?.prospects ?? [];
  const metiers = useMemo(() => [...new Set(all.map((p) => p.metier).filter((x): x is string => !!x))].sort(), [all]);
  const communes = useMemo(() => [...new Set(all.map((p) => p.commune).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "fr")), [all]);
  const rows = useMemo(() => {
    const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = n(q.trim());
    const out = all.filter(
      (p) =>
        (ecartes || (p.etape !== "ecarte" && p.statut !== "exclu")) &&
        (!qualifies || (qualifies === "qualifies" ? p.qualifie : p.aVerifier)) &&
        (!site || (p.siteStatut ? SITE[p.siteStatut].groupe : "inconnu") === site) &&
        (!metier || p.metier === metier) &&
        (!commune || p.commune === commune) &&
        (!needle || n([p.nom, p.raisonSociale, p.metier, p.commune, p.telephone, p.siteActuel].filter(Boolean).join(" ")).includes(needle)),
    );
    const val = (p: LigneProspect): number | string => {
      switch (tri.cle) {
        case "score":
          // À score égal, les qualifiées passent devant les « à vérifier ».
          return (p.scoreBrut ?? -999) + (p.qualifie ? 0.5 : 0);
        case "nom":
          return n(p.nom);
        case "metier":
          return n(p.metier ?? "~");
        case "commune":
          return n(p.commune ?? "~");
        case "distance":
          return p.distanceKm ?? 9999;
        case "avis":
          return p.google?.nombre ?? -1;
        case "site":
          return p.siteStatut ? Object.keys(SITE).indexOf(p.siteStatut) : 99;
      }
    };
    return out.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * tri.sens;
    });
  }, [all, q, site, qualifies, ecartes, metier, commune, tri]);

  const trier = (cle: Tri) => setTri((t) => (t.cle === cle ? { cle, sens: t.sens === 1 ? -1 : 1 } : { cle, sens: cle === "score" || cle === "avis" ? -1 : 1 }));
  const Th = ({ cle, children, num }: { cle: Tri; children: ReactNode; num?: boolean }) => (
    <th className={num ? "num" : undefined} aria-sort={tri.cle === cle ? (tri.sens === 1 ? "ascending" : "descending") : "none"}>
      <button className={`th-sort${tri.cle === cle ? " on" : ""}`} onClick={() => trier(cle)}>
        {children}
        <Icon name="chevron" size={12} className={`th-arrow${tri.cle === cle && tri.sens === 1 ? " up" : ""}`} />
      </button>
    </th>
  );
  const basculer = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const tousCoches = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const choisis = all.filter((p) => sel.has(p.id));

  const maquettes = async (ids: string[]) => {
    setEnvoi(true);
    try {
      const r = await api.post<{ ajoutees: number; dejaEnFile: number; file: EntreeFile[] }>("/api/prospection/maquettes", { ids, campagneId });
      const refusees = r.file.filter((f) => ids.includes(f.companyId) && f.etat === "refusee" && Date.now() - new Date(f.updatedAt).getTime() < 10_000);
      toast.ok(`${r.ajoutees} maquette(s) dans la file${r.dejaEnFile ? `, ${r.dejaEnFile} déjà en attente` : ""}${refusees.length ? ` — ${refusees.length} refusée(s), voir la file` : ""}`);
      setSel(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  };

  const k = campagne?.compteurs;
  return (
    <>
      {campagne && <CampagneResume c={campagne} />}
      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, métier, commune, téléphone, site…" aria-label="Filtrer les prospects" />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ("")} aria-label="Effacer">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
        <div className="chips" role="group" aria-label="Site actuel">
          {FILTRES_SITE.map((f) => (
            <button key={f.id} className={`chip${site === f.id ? " on" : ""}`} onClick={() => setSite(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <select className="select-sm" value={qualifies} onChange={(e) => setQualifies(e.target.value as typeof qualifies)} aria-label="Score">
          {FILTRES_SCORE.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <select className="select-sm" value={metier} onChange={(e) => setMetier(e.target.value)} aria-label="Métier">
          <option value="">Tous les métiers</option>
          {metiers.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select className="select-sm" value={commune} onChange={(e) => setCommune(e.target.value)} aria-label="Commune">
          <option value="">Toutes les communes</option>
          {communes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <label className="chip-check muted">
          <input type="checkbox" checked={ecartes} onChange={(e) => setEcartes(e.target.checked)} /> Écartés et exclus
        </label>
      </div>

      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading ? (
        <Skeleton rows={8} />
      ) : all.length === 0 ? (
        <Empty icon="prospection" title={campagne ? (campagne.etat === "en_cours" ? "Recherche en cours…" : "Aucun prospect pour cette campagne") : "Aucun prospect pour l'instant"}>
          {campagne ? (k?.sources === 0 ? "Aucune entreprise ne remplit ces critères. Élargissez la zone ou les métiers." : "Les entreprises apparaissent ici au fil de la campagne.") : "Créez une campagne pour sourcer vos premiers prospects."}
        </Empty>
      ) : rows.length === 0 ? (
        <Empty icon="search" title="Aucun résultat">
          Aucun prospect ne correspond à ces filtres.
        </Empty>
      ) : (
        <div className="table-wrap prosp-table-wrap">
          <table className="table prosp-table">
            <thead>
              <tr>
                <th className="col-check">
                  <input type="checkbox" checked={tousCoches} aria-label="Tout sélectionner" onChange={() => setSel(tousCoches ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
                <Th cle="score" num>
                  Score
                </Th>
                <Th cle="nom">Entreprise</Th>
                <Th cle="metier">Métier</Th>
                <Th cle="commune">Commune</Th>
                <Th cle="distance" num>
                  Distance
                </Th>
                <Th cle="site">Site actuel</Th>
                <Th cle="avis">Avis</Th>
                <th>Statut</th>
                <th className="col-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 600).map((p) => (
                <tr key={p.id} className={`${ficheId === p.id ? "selected " : ""}${sel.has(p.id) ? "checked " : ""}${p.etape === "ecarte" || p.statut === "exclu" ? "dim" : ""}`} onClick={() => navigate(`/prospection/${p.id}${location.search}`)}>
                  <td className="col-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(p.id)} onChange={() => basculer(p.id)} aria-label={`Sélectionner ${p.nom}`} />
                  </td>
                  <td className="num">
                    <ScorePastille p={p} />
                  </td>
                  <td>
                    <div className="cell-title">
                      {p.nom}
                      {p.douteux.length > 0 && (
                        <span className="doute" title={`Appariement ${p.douteux.map((d) => (d === "places" ? "Google Places" : "OpenStreetMap")).join(" et ")} à vérifier`}>
                          <Icon name="alert" size={12} />
                        </span>
                      )}
                    </div>
                    {p.nom !== p.raisonSociale && <div className="cell-sub">{p.raisonSociale}</div>}
                    {p.etape === "ecarte" && p.motif && <div className="cell-sub">Écartée : {p.motif}</div>}
                  </td>
                  <td>{p.metier ?? <span className="muted">—</span>}</td>
                  <td className="nowrap">{p.commune ?? <span className="muted">—</span>}</td>
                  <td className="num muted">{p.distanceKm != null ? `${p.distanceKm.toLocaleString("fr-FR")} km` : "—"}</td>
                  <td>
                    <SiteBadgeProspect statut={p.siteStatut} />
                  </td>
                  <td>
                    {p.google?.nombre != null ? (
                      <span className="rating">
                        <Icon name="star" size={13} /> {(p.google.valeur ?? 0).toLocaleString("fr-FR")}
                        <span className="muted"> ({p.google.nombre})</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <StatutBadge statut={p.statut} />
                  </td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    <span className="row-actions">
                      {p.telephone && (
                        <button className="icon-btn sm" title={`Copier le numéro ${p.telephone}`} aria-label={`Copier le numéro de ${p.nom}`} onClick={() => copier(p.telephone!, toast)}>
                          <Icon name="phone" size={14} />
                        </button>
                      )}
                      {p.siteActuel && (
                        <a className="icon-btn sm" href={urlSite(p.siteActuel)} target="_blank" rel="noreferrer" title="Ouvrir le site actuel" aria-label={`Ouvrir le site actuel de ${p.nom}`}>
                          <Icon name="external" size={14} />
                        </a>
                      )}
                      <button className="icon-btn sm" disabled={!p.maquettePossible || envoi} title={p.maquettePossible ? "Créer la maquette" : "Fiche incomplète pour une maquette (ouvrir la fiche pour le détail)"} aria-label={`Créer la maquette de ${p.nom}`} onClick={() => maquettes([p.id])}>
                        <Icon name="wand" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 600 && <div className="table-more muted">600 premières lignes affichées sur {rows.length} : affinez les filtres.</div>}
        </div>
      )}

      {/* Portail : la transition de page fausserait position: fixed (ADR-08). */}
      {sel.size > 0 && createPortal(
        <div className="selection-bar" role="region" aria-label="Actions sur la sélection">
          <span className="selection-n">
            <b>{sel.size}</b> sélectionné{sel.size > 1 ? "s" : ""}
            <span className="muted"> · {choisis.filter((c) => c.maquettePossible).length} prêt(s) pour une maquette</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSel(new Set())}>
            Désélectionner
          </button>
          <button className="btn btn-danger-ghost btn-sm" onClick={() => setExclusion([...sel])}>
            <Icon name="cancel" size={14} /> Exclure
          </button>
          <button className="btn btn-primary btn-sm" disabled={envoi || !choisis.some((c) => c.maquettePossible)} onClick={() => maquettes(choisis.filter((c) => c.maquettePossible).map((c) => c.id))}>
            <Icon name={envoi ? "spinner" : "wand"} size={14} className={envoi ? "spin" : undefined} /> Créer les maquettes
          </button>
        </div>,
        document.body,
      )}
      <ExclusionDialog
        ids={exclusion}
        onClose={() => setExclusion(null)}
        onDone={() => {
          setExclusion(null);
          setSel(new Set());
          reload();
        }}
      />
    </>
  );
}

function ScorePastille({ p }: { p: { scoreBrut: number | null; qualifie: boolean; aVerifier: boolean } }) {
  if (p.scoreBrut == null) return <span className="muted">—</span>;
  return (
    <span className={`score-pill${p.qualifie ? " ok" : p.aVerifier ? " doute" : p.scoreBrut < 0 ? " neg" : ""}`} title={p.qualifie ? "Qualifié" : p.aVerifier ? "Au seuil grâce à des points incertains : à vérifier" : "Sous le seuil"}>
      {p.scoreBrut}
    </span>
  );
}

function CampagneResume({ c }: { c: Campagne }) {
  const k = c.compteurs;
  const ecartes = Object.entries(k.ecartes ?? {}).sort((a, b) => b[1] - a[1]);
  const places = c.couts?.places;
  return (
    <div className="camp-resume">
      <div className="camp-funnel">
        <Etape n={k.trouves} label="trouvées (Sirene)" />
        <Icon name="chevron" size={14} className="muted" />
        <Etape n={k.sources} label="gardées" />
        <Icon name="chevron" size={14} className="muted" />
        <Etape n={k.audites} label="sites audités" />
        <Icon name="chevron" size={14} className="muted" />
        <Etape n={k.qualifies} label="qualifiées" accent />
        {k.aVerifier ? <Etape n={k.aVerifier} label="à vérifier" /> : null}
      </div>
      <div className="camp-notes">
        {k.osm && (
          <span title={k.osm.erreur ?? undefined}>
            OSM : {k.osm.erreur ? <span className="text-danger">indisponible</span> : `${k.osm.apparies} rapprochée(s) sur ${k.osm.lieux} lieux`}
            {k.osm.douteux ? `, ${k.osm.douteux} douteuse(s)` : ""}
          </span>
        )}
        {k.places && <span>Places : {k.places.saute ? <span className="muted">{k.places.saute}</span> : `${k.places.appels} appel(s), ${k.places.cache} en cache${places ? ` · ~${places.coutUsd.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $` : ""}`}</span>}
        {ecartes.length > 0 && (
          <span title={ecartes.map(([m, n]) => `${n} ${m}`).join("\n")}>
            Écartées : {ecartes.slice(0, 3).map(([m, n]) => `${n} ${m}`).join(", ")}
            {ecartes.length > 3 ? "…" : ""}
          </span>
        )}
        {c.finieLe && <span className="muted">Finie {timeAgo(c.finieLe)}</span>}
      </div>
    </div>
  );
}

function Etape({ n, label, accent }: { n: number | undefined; label: string; accent?: boolean }) {
  return (
    <span className={`funnel-step${accent ? " accent" : ""}`}>
      <b>{n ?? "—"}</b>
      <span>{label}</span>
    </span>
  );
}

// ── Exclusion ───────────────────────────────────────────────────────────────

const MOTIFS = ["Franchise ou réseau", "A déjà un bon site", "Hors cible", "Ne répond plus / fermée", "Opposition (STOP)"];

export function ExclusionDialog({ ids, onClose, onDone }: { ids: string[] | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [motif, setMotif] = useState(MOTIFS[0]!);
  const [autre, setAutre] = useState("");
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => {
    setMotif(MOTIFS[0]!);
    setAutre("");
  }, [ids]);
  const texte = motif === "Autre" ? autre.trim() : motif;
  const opposition = motif.startsWith("Opposition");
  const go = async () => {
    if (!ids) return;
    setEnvoi(true);
    try {
      const r = await api.post<{ exclues: number; supprimees: number }>("/api/prospection/exclure", { ids, motif: texte });
      toast.ok(r.supprimees ? `${r.supprimees} fiche(s) supprimée(s), opposition enregistrée à vie` : `${r.exclues} prospect(s) exclu(s)`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnvoi(false);
    }
  };
  return (
    <Drawer
      open={!!ids}
      onClose={onClose}
      width={440}
      title={<div className="drawer-name">Exclure {ids && ids.length > 1 ? `${ids.length} prospects` : "ce prospect"}</div>}
      footer={
        <>
          <span className="foot-spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className={`btn ${opposition ? "btn-danger" : "btn-primary"}`} disabled={envoi || texte.length < 2} onClick={go}>
            {opposition ? "Enregistrer l'opposition" : "Exclure"}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="motifs" role="radiogroup" aria-label="Motif">
          {[...MOTIFS, "Autre"].map((m) => (
            <button key={m} role="radio" aria-checked={motif === m} className={`motif${motif === m ? " on" : ""}`} onClick={() => setMotif(m)}>
              {m}
            </button>
          ))}
        </div>
        {motif === "Autre" && (
          <label className="field">
            <span className="field-label">Motif</span>
            <input value={autre} onChange={(e) => setAutre(e.target.value)} placeholder="Pourquoi l'exclure ?" autoFocus maxLength={300} />
          </label>
        )}
        {opposition ? (
          <div className="hint-box warn" role="note">
            <Icon name="alert" size={15} />
            <span>
              L'entreprise a demandé à ne plus être contactée : sa fiche est <strong>supprimée</strong> (sauf cliente ou maquette existante) et son SIREN, son téléphone et son
              email rejoignent la liste d'opposition à vie, sous forme d'empreintes. Elle ne sera plus jamais sourcée.
            </span>
          </div>
        ) : (
          <p className="muted small">La fiche passe au statut « Exclu » avec ce motif ; les prochaines campagnes l'écarteront.</p>
        )}
      </div>
    </Drawer>
  );
}

// ── Fiche prospect ──────────────────────────────────────────────────────────

function Ligne({ label, children, source }: { label: string; children?: ReactNode; source?: Source }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children === null || children === undefined || children === "" ? <span className="muted">—</span> : children}</span>
      <SourceTag source={source} />
    </div>
  );
}

const oui = (v: boolean | null, o = "Oui", n = "Non") => (v == null ? <span className="muted">inconnu</span> : v ? <span className="ok-text">{o}</span> : <span className="text-danger">{n}</span>);

function FicheDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const toast = useToast();
  const { data, error, reload } = useApi<FicheProspect>(id ? `/api/prospection/prospects/${id}` : null, ["prospection", "companies", "sites"]);
  const [exclusion, setExclusion] = useState<string[] | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const f = data?.company.id === id ? data : null;
  const c = f?.company;
  const p = f?.prospect;

  const maquette = async () => {
    if (!c) return;
    setEnvoi(true);
    try {
      const r = await api.post<{ file: EntreeFile[] }>("/api/prospection/maquettes", { ids: [c.id] });
      const e = r.file.find((x) => x.companyId === c.id);
      if (e?.etat === "lancee" && e.siteId) {
        toast.ok("Maquette lancée : l'atelier s'en occupe");
        navigate(`/sites/${e.siteId}`);
      } else if (e?.etat === "refusee") toast.error(e.message ?? "Maquette refusée");
      else toast.ok("Maquette ajoutée à la file : elle partira quand une fabrication se libère");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  };
  const decider = async (source: "places" | "osm", decision: "acceptee" | "refusee") => {
    if (!c) return;
    try {
      await api.post(`/api/prospection/prospects/${c.id}/appariement`, { source, decision });
      toast.ok(decision === "acceptee" ? "Appariement accepté : données reprises, score recalculé" : "Appariement refusé");
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const enFile = f?.file.find((x) => x.etat === "en_attente");
  return (
    <>
      <Drawer
        open={!!id}
        onClose={onClose}
        width={600}
        title={
          c ? (
            <div>
              <div className="drawer-name">{c.nomCommercial ?? c.raisonSociale}</div>
              <div className="drawer-sub">{[c.metier, c.adresse.commune, c.siren && `SIREN ${c.siren.replace(/(\d{3})(?=\d)/g, "$1 ")}`].filter(Boolean).join(" · ")}</div>
            </div>
          ) : (
            "Prospect"
          )
        }
        footer={
          c && (
            <>
              <button className="btn btn-danger-ghost" onClick={() => setExclusion([c.id])} disabled={c.statut === "exclu"}>
                <Icon name="cancel" size={15} /> Exclure
              </button>
              <span className="foot-spacer" />
              <Link to={`/entreprises/${c.id}`} className="btn btn-ghost">
                Fiche entreprise
              </Link>
              <span className="tip-wrap" title={f?.maquette.possible ? undefined : `Il manque ${f?.maquette.manques.join(", ")}`}>
                <button className="btn btn-primary" disabled={!f?.maquette.possible || envoi || !!enFile} onClick={maquette}>
                  <Icon name={envoi ? "spinner" : "wand"} size={15} className={envoi ? "spin" : undefined} /> {enFile ? "En file" : "Créer la maquette"}
                </button>
              </span>
            </>
          )
        }
      >
        {error && <ErrorNote text={error} />}
        {!f && !error && <Skeleton rows={8} />}
        {f && c && p && (
          <div className="stack">
            <ScoreBloc f={f} />
            {!f.maquette.possible && (
              <div className="hint-box" role="note">
                <Icon name="info" size={15} />
                <span>« Créer la maquette » demande {f.maquette.manques.join(", ")}.</span>
              </div>
            )}
            <div className="quick-actions">
              {c.telephone ? (
                <button className="quick" onClick={() => copier(c.telephone!, toast)}>
                  <Icon name="phone" size={15} /> Copier le numéro <span className="mono">{c.telephone}</span>
                </button>
              ) : (
                <span className="quick disabled">
                  <Icon name="phone" size={15} /> Pas de numéro connu
                </span>
              )}
              {c.siteActuel && (
                <a className="quick" href={urlSite(c.siteActuel)} target="_blank" rel="noreferrer">
                  <Icon name="external" size={15} /> Ouvrir le site actuel
                </a>
              )}
              {c.email && (
                <button className="quick" onClick={() => copier(c.email!, toast, "Email copié")}>
                  <Icon name="mail" size={15} /> {c.email}
                </button>
              )}
            </div>
            {p.exclusion && (
              <div className="hint-box warn" role="note">
                <Icon name="cancel" size={15} />
                <span>
                  Exclue le {formatDate(p.exclusion.le)} : {p.exclusion.motif}
                </span>
              </div>
            )}
            <AuditBloc audit={p.audit} statut={p.siteStatut} site={c.siteActuel} />
            <AppariementsBloc p={p} onDecide={decider} />
            <DonneesBloc c={c} p={p} />
            {f.campagnes.length > 0 && (
              <section className="detail-group">
                <h3>Campagnes</h3>
                <div className="list">
                  {f.campagnes.map((x) => (
                    <div key={x.id} className="list-row static">
                      <div>
                        <div className="row-title">{x.nom}</div>
                        <div className="row-sub">
                          {x.etape === "ecarte" ? `Écartée : ${x.motif ?? ""}` : x.etape === "note" ? "Notée" : `Étape : ${x.etape}`}
                          {x.distanceKm != null ? ` · ${x.distanceKm.toLocaleString("fr-FR")} km du centre` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {f.sites.length > 0 && (
              <section className="detail-group">
                <h3>Maquettes</h3>
                <div className="list">
                  {f.sites.map((s) => (
                    <Link key={s.id} to={`/sites/${s.id}`} className="list-row">
                      <div className="row-title">Maquette du {formatDate(s.createdAt)}</div>
                      <Icon name="chevron" size={14} className="row-chevron" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <p className="muted small">
              Sourcée le {formatDate(p.sourceLe)}
              {p.auditeLe ? ` · auditée ${timeAgo(p.auditeLe)}` : ""}. Les données saisies à la main ne sont jamais écrasées par une source.
            </p>
          </div>
        )}
      </Drawer>
      <ExclusionDialog
        ids={exclusion}
        onClose={() => setExclusion(null)}
        onDone={() => {
          setExclusion(null);
          reload();
        }}
      />
    </>
  );
}

function ScoreBloc({ f }: { f: FicheProspect }) {
  const s = f.prospect.score;
  if (!s) return <div className="hint-box">Score pas encore calculé : la campagne est en cours.</div>;
  return (
    <section className="score-card">
      <div className="score-head">
        <span className={`score-big${s.qualifie ? " ok" : s.total < 0 ? " neg" : ""}`}>{s.total}</span>
        <span className="score-meta">
          <span>
            {s.exclu ? <Badge tone="red">Exclu : {s.exclu}</Badge> : s.qualifie ? <Badge tone="green" dot>Qualifié</Badge> : s.aVerifier ? <Badge tone="amber" dot>À vérifier</Badge> : <Badge tone="neutral">Sous le seuil</Badge>}
          </span>
          <span className="muted small">{s.aVerifier ? "Au seuil seulement grâce à des points « à vérifier »" : `Seuil de qualification : ${s.seuil} points`}</span>
        </span>
        <span className="score-gauge" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, (s.total / Math.max(s.seuil * 1.6, 1)) * 100))}%` }} />
          <i style={{ left: `${(s.seuil / Math.max(s.seuil * 1.6, 1)) * 100}%` }} />
        </span>
      </div>
      <ul className="score-lines">
        {s.lignes.map((l) => (
          <li key={l.regle} className={l.applique ? (l.points < 0 ? "neg" : "on") : ""}>
            <span className="score-pts">{l.applique && l.points ? (l.points > 0 ? `+${l.points}` : l.points) : "·"}</span>
            <span className="score-rule">
              <span>{l.libelle}</span>
              <span className="muted small">
                {l.raison}
                {l.incertain && <span className="tag-incertain">à vérifier</span>}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditBloc({ audit, statut, site }: { audit: FicheProspect["prospect"]["audit"]; statut: StatutSite | null; site: string | null }) {
  return (
    <section className="detail-group">
      <h3>
        Site actuel <SiteBadgeProspect statut={statut} />
      </h3>
      {!site && !audit ? (
        <p className="muted">Aucun site connu (sources consultées : voir « Rapprochements » ci-dessous).</p>
      ) : !audit ? (
        <p className="muted">{site} — pas encore audité.</p>
      ) : (
        <>
          <div className="audit-grid">
            <span>HTTPS</span>
            <span>
              {oui(audit.https)}
              {audit.certificat === "invalide" && <span className="text-danger"> · certificat invalide</span>}
            </span>
            <span>Mobile</span>
            <span>{oui(audit.mobile, "Adapté", "Non adapté")}</span>
            <span>Copyright</span>
            <span>{audit.anneeCopyright ?? <span className="muted">aucune année</span>}</span>
            <span>Technologie</span>
            <span>{audit.technologies.join(", ") || <span className="muted">non reconnue</span>}{audit.techDatee && !audit.technologies.some((t) => audit.techDatee!.includes(t)) && <span className="text-warn"> · {audit.techDatee}</span>}</span>
            <span>Email</span>
            <span>{audit.email ?? (audit.emailsTrouves.length ? <span className="muted">{audit.emailsTrouves.join(", ")} (non retenu)</span> : <span className="muted">aucun visible</span>)}</span>
            <span>Lighthouse</span>
            <span>
              {audit.lighthouse && "performance" in audit.lighthouse ? (
                <span className="lh">
                  <LhScore v={audit.lighthouse.performance} /> performance <LhScore v={audit.lighthouse.accessibilite} /> accessibilité
                </span>
              ) : audit.lighthouse && "erreur" in audit.lighthouse ? (
                <span className="muted" title={audit.lighthouse.erreur}>
                  mesure impossible
                </span>
              ) : (
                <span className="muted">non mesuré</span>
              )}
            </span>
            <span>Franchise</span>
            <span>{audit.franchise ? (audit.franchise.oui ? <span className="text-danger">{audit.franchise.raison}</span> : "Non") : <span className="muted">inconnu</span>}</span>
          </div>
          <details className="preuves" open>
            <summary>
              Preuves ({audit.preuves.length}) · {audit.pagesVisitees.length} page(s) visitée(s) le {formatDate(audit.le)}
              {audit.flou && "fournisseur" in audit.flou ? ` · flou tranché par ${audit.flou.fournisseur} (${audit.flou.modele})` : ""}
            </summary>
            <ul>
              {audit.preuves.map((x, i) => (
                <li key={i}>
                  <span>{x.constat}</span>
                  {x.url && (
                    <a href={x.url} target="_blank" rel="noreferrer" className="inline-link" title={x.url}>
                      voir
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function LhScore({ v }: { v: number }) {
  return <b className={`lh-n ${v >= 90 ? "good" : v >= 50 ? "mid" : "bad"}`}>{v}</b>;
}

function AppariementsBloc({ p, onDecide }: { p: FicheProspect["prospect"]; onDecide: (s: "places" | "osm", d: "acceptee" | "refusee") => void }) {
  const items: { source: "places" | "osm"; nom: string; quoi: ReactNode; a: FicheProspect["prospect"]["places"] | FicheProspect["prospect"]["osm"] }[] = [];
  items.push({
    source: "places",
    nom: "Google Places",
    a: p.places,
    quoi: p.places?.fiche ? (
      <>
        {p.places.fiche.nom}
        <span className="muted"> · {[p.places.fiche.adresse, p.places.fiche.telephone, p.places.fiche.note != null ? `${p.places.fiche.note.toLocaleString("fr-FR")}/5 (${p.places.fiche.avis ?? 0} avis)` : null].filter(Boolean).join(" · ")}</span>
        {p.places.fiche.url && (
          <a href={p.places.fiche.url} target="_blank" rel="noreferrer" className="inline-link">
            fiche
          </a>
        )}
      </>
    ) : null,
  });
  items.push({
    source: "osm",
    nom: "OpenStreetMap",
    a: p.osm,
    quoi: p.osm?.lieu ? (
      <>
        {p.osm.lieu.nom}
        <span className="muted"> · {[p.osm.lieu.site, p.osm.lieu.telephone].filter(Boolean).join(" · ") || "sans site ni téléphone"}</span>
        <a href={`https://www.openstreetmap.org/${p.osm.lieu.id}`} target="_blank" rel="noreferrer" className="inline-link">
          carte
        </a>
      </>
    ) : null,
  });
  return (
    <section className="detail-group">
      <h3>Rapprochements</h3>
      <div className="match-list">
        {items.map((it) => {
          const ap = it.a?.appariement;
          const decision = it.a?.decision;
          return (
            <div key={it.source} className={`match ${ap ? (decision === "refusee" ? "refuse" : decision === "acceptee" ? "fusionne" : ap.statut) : "vide"}`}>
              <div className="match-head">
                <span className={`source-tag src-${it.source}`}>{it.nom}</span>
                {!it.a ? (
                  <span className="muted small">non consulté</span>
                ) : !ap ? (
                  <span className="muted small">aucune fiche correspondante</span>
                ) : (
                  <>
                    <span className="match-score" title={`Nom ${Math.round(ap.detail.nom * 100)} %, adresse ${ap.detail.adresse != null ? `${Math.round(ap.detail.adresse * 100)} %` : "—"}, distance ${ap.detail.distanceM != null ? `${ap.detail.distanceM} m` : "—"}`}>
                      {Math.round(ap.score * 100)} %
                    </span>
                    <span className="small">{decision === "acceptee" ? "accepté par vous" : decision === "refusee" ? "refusé par vous" : ap.statut === "fusionne" ? "fusionné" : "douteux : à vérifier"}</span>
                  </>
                )}
              </div>
              {it.quoi && <div className="match-body">{it.quoi}</div>}
              {ap && !decision && ap.statut === "douteux" && (
                <div className="match-actions">
                  <span className="muted small">Est-ce bien la même entreprise ? Rien n'est repris sans votre accord.</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => onDecide(it.source, "refusee")}>
                    Non
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => onDecide(it.source, "acceptee")}>
                    Oui, reprendre
                  </button>
                </div>
              )}
              {ap && !decision && ap.statut === "fusionne" && (
                <div className="match-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => onDecide(it.source, "refusee")}>
                    Ce n'est pas elle
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DonneesBloc({ c, p }: { c: Company; p: FicheProspect["prospect"] }) {
  const hours = Object.entries(c.horaires).filter(([, v]) => v);
  return (
    <section className="detail-group">
      <h3>Données et sources</h3>
      <Ligne label="Raison sociale" source={c.sources.raisonSociale}>
        {c.raisonSociale}
      </Ligne>
      <Ligne label="Nom commercial" source={c.sources.nomCommercial}>
        {c.nomCommercial}
      </Ligne>
      <Ligne label="SIRET" source={c.sources.siren}>
        {p.siret && <span className="mono">{p.siret.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, "$1 $2 $3 $4")}</span>}
      </Ligne>
      <Ligne label="NAF" source={c.sources.naf}>
        {c.naf && <span className="mono">{c.naf}</span>}
      </Ligne>
      <Ligne label="Création" source={c.sources.dateCreation}>
        {c.dateCreation && formatDate(c.dateCreation)}
      </Ligne>
      <Ligne label="Dirigeant" source={c.sources.dirigeant}>
        {c.dirigeant}
      </Ligne>
      <Ligne label="Taille" source={p.sirene ? "sirene" : undefined}>
        {p.sirene && [p.sirene.categorie, p.sirene.effectif && `tranche ${p.sirene.effectif}`, p.sirene.etablissementsOuverts != null && `${p.sirene.etablissementsOuverts} établissement(s)`].filter(Boolean).join(" · ")}
      </Ligne>
      <Ligne label="Adresse" source={c.sources.adresse}>
        {[c.adresse.ligne, [c.adresse.codePostal, c.adresse.commune].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
      </Ligne>
      <Ligne label="Téléphone" source={c.sources.telephone}>
        {c.telephone}
      </Ligne>
      <Ligne label="Email" source={c.sources.email}>
        {c.email}
      </Ligne>
      <Ligne label="Site" source={c.sources.siteActuel}>
        {c.siteActuel && (
          <a href={urlSite(c.siteActuel)} target="_blank" rel="noreferrer" className="inline-link">
            {c.siteActuel}
          </a>
        )}
      </Ligne>
      <Ligne label="Avis Google" source={c.sources.google}>
        {c.google?.valeur != null && (
          <span className="rating">
            <Icon name="star" size={13} /> {c.google.valeur.toLocaleString("fr-FR")} <span className="muted">· {c.google.nombre ?? 0} avis</span>
          </span>
        )}
      </Ligne>
      <Ligne label="Horaires" source={c.sources.horaires}>
        {hours.length ? (
          <span className="hours-view">
            {hours.map(([j, v]) => (
              <span key={j}>
                <span className="capitalize muted">{j.slice(0, 3)}.</span> {v}
              </span>
            ))}
          </span>
        ) : null}
      </Ligne>
      <Ligne label="Statut">
        <span className="statut-inline">
          <StatutBadge statut={c.statut} />
          <span className="muted small">{STATUT[c.statut].label === "Qualifié" ? "au-dessus du seuil de la grille" : ""}</span>
        </span>
      </Ligne>
    </section>
  );
}
