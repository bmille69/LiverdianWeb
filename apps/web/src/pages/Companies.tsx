import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Company, type HubEvent, type Job, type Site, type Source, type Statut } from "../api.ts";
import { useApi } from "../live.tsx";
import { Link, navigate, usePath } from "../router.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Drawer, Empty, ErrorNote, formatDate, PageHeader, Skeleton, timeAgo } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { CompanyForm } from "./CompanyForm.tsx";
import { ActivityFeed } from "./Today.tsx";
import { RECETTE_LABEL, SiteBadge, SourceTag, STATUT, StatutBadge } from "./labels.tsx";

const name = (c: Company) => c.nomCommercial ?? c.raisonSociale;

export function CompaniesPage() {
  const path = usePath();
  const selectedId = path.startsWith("/entreprises/") ? path.slice("/entreprises/".length) : null;
  const params = new URLSearchParams(location.search);
  const [q, setQ] = useState("");
  const [statut, setStatut] = useState<Statut | "">((params.get("statut") as Statut) ?? "");
  const [formFor, setFormFor] = useState<Company | null | "new">(params.get("nouvelle") ? "new" : null);
  const { data, error, loading, reload } = useApi<{ companies: Company[] }>("/api/companies", ["companies"]);

  // « Nouvelle entreprise » depuis la palette : ouvre le formulaire puis nettoie l'adresse.
  useEffect(() => {
    if (params.get("nouvelle")) {
      setFormFor("new");
      navigate("/entreprises", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const all = data?.companies ?? [];
  const counts = useMemo(() => {
    const m: Partial<Record<Statut, number>> = {};
    for (const c of all) m[c.statut] = (m[c.statut] ?? 0) + 1;
    return m;
  }, [all]);
  const rows = useMemo(() => {
    const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = n(q.trim());
    return all.filter(
      (c) =>
        (!statut || c.statut === statut) &&
        (!needle || n([c.raisonSociale, c.nomCommercial, c.metier, c.adresse.commune, c.siren, c.telephone].filter(Boolean).join(" ")).includes(needle)),
    );
  }, [all, q, statut]);

  return (
    <div className="page">
      <PageHeader
        title="Entreprises"
        subtitle="Une seule fiche par entreprise, de prospect à client."
        actions={
          <button className="btn btn-primary" onClick={() => setFormFor("new")}>
            <Icon name="plus" size={15} /> Nouvelle entreprise
          </button>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, métier, commune, SIREN, téléphone…" aria-label="Filtrer les entreprises" />
          {q && (
            <button className="icon-btn sm" onClick={() => setQ("")} aria-label="Effacer">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
        <div className="chips" role="tablist" aria-label="Statut">
          <button className={`chip${statut === "" ? " on" : ""}`} onClick={() => setStatut("")}>
            Toutes <span className="chip-n">{all.length}</span>
          </button>
          {(Object.keys(STATUT) as Statut[]).map((s) => (
            <button key={s} className={`chip${statut === s ? " on" : ""}`} onClick={() => setStatut(statut === s ? "" : s)}>
              <span className={`dot tone-${STATUT[s].tone}`} />
              {STATUT[s].label}
              {counts[s] ? <span className="chip-n">{counts[s]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNote text={error} onRetry={reload} />}
      {loading ? (
        <Skeleton rows={6} />
      ) : all.length === 0 ? (
        <Empty
          icon="companies"
          title="Aucune entreprise pour l'instant"
          action={
            <button className="btn btn-primary" onClick={() => setFormFor("new")}>
              <Icon name="plus" size={15} /> Créer la première fiche
            </button>
          }
        >
          Saisissez une entreprise à la main pour commencer. La prospection automatique les ajoutera plus tard.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty icon="search" title="Aucun résultat">
          Aucune entreprise ne correspond à ces filtres.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Entreprise</th>
                <th>Métier</th>
                <th>Commune</th>
                <th>Avis Google</th>
                <th>Statut</th>
                <th className="num">Score</th>
                <th>Mise à jour</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={selectedId === c.id ? "selected" : ""} onClick={() => navigate(`/entreprises/${c.id}`)}>
                  <td>
                    <div className="cell-title">{name(c)}</div>
                    {c.nomCommercial && <div className="cell-sub">{c.raisonSociale}</div>}
                  </td>
                  <td>{c.metier ?? <span className="muted">—</span>}</td>
                  <td>{c.adresse.commune ?? <span className="muted">—</span>}</td>
                  <td>
                    {c.google?.valeur != null ? (
                      <span className="rating">
                        <Icon name="star" size={13} /> {c.google.valeur.toLocaleString("fr-FR")}
                        <span className="muted"> ({c.google.nombre ?? 0})</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <StatutBadge statut={c.statut} />
                  </td>
                  <td className="num">{c.score ?? <span className="muted">—</span>}</td>
                  <td className="muted">{timeAgo(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CompanyDetail id={selectedId} onClose={() => navigate("/entreprises")} onEdit={(c) => setFormFor(c)} />
      <CompanyForm
        open={formFor !== null}
        company={formFor === "new" ? null : formFor}
        onClose={() => setFormFor(null)}
        onSaved={(c) => {
          setFormFor(null);
          reload();
          navigate(`/entreprises/${c.id}`);
        }}
      />
    </div>
  );
}

function Row({ label, value, source, children }: { label: string; value?: ReactNode; source?: Source; children?: ReactNode }) {
  const v = children ?? value;
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{v === null || v === undefined || v === "" ? <span className="muted">—</span> : v}</span>
      <SourceTag source={source} />
    </div>
  );
}

function CompanyDetail({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (c: Company) => void }) {
  const toast = useToast();
  const { data, error } = useApi<{ company: Company; maquette: { possible: boolean; manques: string[] }; sites: Site[]; jobs: Job[]; activite: HubEvent[] }>(id ? `/api/companies/${id}` : null, ["companies", "sites"]);
  const [lancement, setLancement] = useState(false);
  const c = data?.company.id === id ? data.company : null;
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setConfirmDelete(false), [id]);

  const setStatut = async (s: Statut) => {
    if (!c) return;
    try {
      await api.patch(`/api/companies/${c.id}`, { statut: s });
      toast.ok(`Statut : ${STATUT[s].label}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const createMaquette = async () => {
    if (!c) return;
    setLancement(true);
    try {
      const r = await api.post<{ site: Site }>(`/api/companies/${c.id}/maquette`, { recette: "vitrine-artisan" });
      toast.ok("Maquette lancée : l'atelier s'en occupe");
      navigate(`/sites/${r.site.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLancement(false);
    }
  };
  const remove = async () => {
    if (!c) return;
    try {
      await api.del(`/api/companies/${c.id}`);
      toast.ok("Fiche supprimée");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const hours = c ? Object.entries(c.horaires).filter(([, v]) => v) : [];
  const enCours = !!data?.sites.some((s) => s.statut === "en_fabrication");
  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width={560}
      title={
        c ? (
          <div>
            <div className="drawer-name">{name(c)}</div>
            <div className="drawer-sub">{[c.metier, c.adresse.commune].filter(Boolean).join(" · ") || c.raisonSociale}</div>
          </div>
        ) : (
          "Entreprise"
        )
      }
      footer={
        c && (
          <>
            {confirmDelete ? (
              <>
                <span className="foot-hint text-danger">Supprimer définitivement cette fiche et ses sites ?</span>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Non
                </button>
                <button className="btn btn-danger" onClick={remove}>
                  Supprimer
                </button>
              </>
            ) : (
              <>
                <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Supprimer la fiche" title="Supprimer">
                  <Icon name="trash" size={15} />
                </button>
                <span className="foot-spacer" />
                <button className="btn btn-ghost" onClick={() => onEdit(c)}>
                  <Icon name="edit" size={15} /> Modifier
                </button>
                <span className="tip-wrap" title={data?.maquette.possible ? undefined : `Il manque ${data?.maquette.manques.join(", ")}`}>
                  <button className="btn btn-primary" disabled={!data?.maquette.possible || lancement || enCours} onClick={createMaquette} aria-describedby={data?.maquette.possible ? undefined : "maquette-manques"}>
                    <Icon name={lancement ? "spinner" : "wand"} size={15} className={lancement ? "spin" : undefined} /> Créer la maquette
                  </button>
                </span>
              </>
            )}
          </>
        )
      }
    >
      {error && <ErrorNote text={error} />}
      {!c && !error && <Skeleton rows={6} />}
      {c && data && (
        <div className="stack">
          <div className="status-picker" role="radiogroup" aria-label="Statut commercial">
            {(Object.keys(STATUT) as Statut[]).map((s) => (
              <button key={s} role="radio" aria-checked={c.statut === s} className={`status-opt tone-${STATUT[s].tone}${c.statut === s ? " on" : ""}`} onClick={() => setStatut(s)}>
                {STATUT[s].label}
              </button>
            ))}
          </div>

          {!data.maquette.possible ? (
            <div className="hint-box" id="maquette-manques" role="note">
              <Icon name="info" size={15} />
              <span>
                « Créer la maquette » demande {data.maquette.manques.join(", ")}. <button className="inline-link" onClick={() => onEdit(c)}>Compléter la fiche</button>
              </span>
            </div>
          ) : enCours ? (
            <div className="hint-box" role="note">
              <Icon name="spinner" size={15} className="spin" />
              <span>Une maquette est en fabrication pour cette entreprise.</span>
            </div>
          ) : null}

          <div className="quick-actions">
            {c.telephone && (
              <a className="quick" href={`tel:${c.telephone.replace(/\s/g, "")}`}>
                <Icon name="phone" size={15} /> {c.telephone}
              </a>
            )}
            {c.email && (
              <a className="quick" href={`mailto:${c.email}`}>
                <Icon name="mail" size={15} /> {c.email}
              </a>
            )}
            {c.siteActuel && (
              <a className="quick" href={/^https?:/.test(c.siteActuel) ? c.siteActuel : `https://${c.siteActuel}`} target="_blank" rel="noreferrer">
                <Icon name="external" size={15} /> Site actuel
              </a>
            )}
          </div>

          <section className="detail-group">
            <h3>Identité</h3>
            <Row label="Raison sociale" value={c.raisonSociale} source={c.sources.raisonSociale} />
            <Row label="Nom commercial" value={c.nomCommercial} source={c.sources.nomCommercial} />
            <Row label="SIREN" value={c.siren && <span className="mono">{c.siren.replace(/(\d{3})(?=\d)/g, "$1 ")}</span>} source={c.sources.siren} />
            <Row label="NAF" value={c.naf && <span className="mono">{c.naf}</span>} source={c.sources.naf} />
            <Row label="Métier" value={c.metier} source={c.sources.metier} />
            <Row label="Création" value={c.dateCreation && formatDate(c.dateCreation)} source={c.sources.dateCreation} />
            <Row label="Dirigeant" value={c.dirigeant} source={c.sources.dirigeant} />
          </section>

          <section className="detail-group">
            <h3>Contact et lieu</h3>
            <Row label="Téléphone" value={c.telephone} source={c.sources.telephone} />
            <Row label="Email" value={c.email} source={c.sources.email} />
            <Row label="Site actuel" value={c.siteActuel} source={c.sources.siteActuel} />
            <Row label="Adresse" value={[c.adresse.ligne, [c.adresse.codePostal, c.adresse.commune].filter(Boolean).join(" ")].filter(Boolean).join(", ")} source={c.sources.adresse} />
            <Row label="Zone" source={c.sources.zone}>
              {c.zone.commune || c.zone.voisines.length ? (
                <span>
                  {c.zone.commune}
                  {c.zone.voisines.length > 0 && <span className="muted"> + {c.zone.voisines.join(", ")}</span>}
                </span>
              ) : null}
            </Row>
            <Row label="Avis Google" source={c.sources.google}>
              {c.google?.valeur != null ? (
                <span className="rating">
                  <Icon name="star" size={13} /> {c.google.valeur.toLocaleString("fr-FR")} <span className="muted">· {c.google.nombre ?? 0} avis</span>
                  {c.google.url && (
                    <a href={c.google.url} target="_blank" rel="noreferrer" className="inline-link">
                      voir
                    </a>
                  )}
                </span>
              ) : null}
            </Row>
            <Row label="Horaires" source={c.sources.horaires}>
              {hours.length ? (
                <span className="hours-view">
                  {hours.map(([j, v]) => (
                    <span key={j}>
                      <span className="capitalize muted">{j.slice(0, 3)}.</span> {v}
                    </span>
                  ))}
                </span>
              ) : null}
            </Row>
          </section>

          {c.notes && (
            <section className="detail-group">
              <h3>Notes</h3>
              <p className="notes">{c.notes}</p>
            </section>
          )}

          <section className="detail-group">
            <h3>Sites</h3>
            {data.sites.length === 0 ? (
              <p className="muted">Aucun site. « Créer la maquette » lance la chaîne de l'atelier : brief, direction artistique, textes, contrôles.</p>
            ) : (
              <div className="list">
                {data.sites.map((s) => (
                  <Link key={s.id} to={`/sites/${s.id}`} className="list-row">
                    <div>
                      <div className="row-title">{RECETTE_LABEL[s.recette] ?? s.recette}</div>
                      <div className="row-sub">Créé {timeAgo(s.createdAt)}</div>
                    </div>
                    <SiteBadge statut={s.statut} />
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="detail-group">
            <h3>Historique</h3>
            <ActivityFeed events={data.activite} limit={10} />
          </section>
        </div>
      )}
    </Drawer>
  );
}
