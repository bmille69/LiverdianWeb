import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../../api.ts";
import type { Campagne, Criteres, EtatProspection, SiteCritere, Zone } from "../../prospection-api.ts";
import { Icon } from "../../ui/Icon.tsx";
import { Drawer } from "../../ui/common.tsx";
import { useToast } from "../../ui/toasts.tsx";

const DEFAUT: Criteres = {
  metiers: ["electricien", "plombier"],
  nafLibres: [],
  zone: { type: "rayon", commune: "", rayonKm: 10 },
  site: "peu_importe",
  ancienneteMinAns: null,
  avisMin: null,
  noteMin: null,
  artisansSeulement: true,
  siegeSeulement: true,
  exclusions: { franchises: true, dejaContactes: true, clients: true },
  limite: 300,
  places: true,
  osm: true,
  audit: true,
  lighthouse: true,
};

type Draft = { nom: string; c: Criteres; departements: string; communes: string; nafLibres: string; anciennete: string; avisMin: string; noteMin: string };

function versDraft(c: Campagne | null): Draft {
  const cr = c?.criteres ?? DEFAUT;
  return {
    nom: c?.nom ?? "",
    c: cr,
    departements: cr.zone.type === "departements" ? cr.zone.departements.join(", ") : "69",
    communes: cr.zone.type === "communes" ? cr.zone.communes.join(", ") : "",
    nafLibres: cr.nafLibres.join(", "),
    anciennete: cr.ancienneteMinAns != null ? String(cr.ancienneteMinAns) : "",
    avisMin: cr.avisMin != null ? String(cr.avisMin) : "",
    noteMin: cr.noteMin != null ? String(cr.noteMin).replace(".", ",") : "",
  };
}

const liste = (s: string) =>
  s
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const nombre = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span className="toggle-knob" />
    </button>
  );
}

function Option({ titre, desc, on, onChange, disabled }: { titre: string; desc?: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`opt-row${disabled ? " disabled" : ""}`}>
      <div>
        <div className="opt-title">{titre}</div>
        {desc && <div className="opt-desc">{desc}</div>}
      </div>
      <Toggle on={on && !disabled} onChange={(v) => !disabled && onChange(v)} label={titre} />
    </div>
  );
}

export function CampagneForm({ open, campagne, etat, onClose, onSaved }: { open: boolean; campagne: Campagne | null; etat: EtatProspection | null; onClose: () => void; onSaved: (c: Campagne) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(versDraft(campagne));
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [envoi, setEnvoi] = useState<"" | "save" | "launch">("");
  useEffect(() => {
    if (open) {
      setD(versDraft(campagne));
      setErreurs({});
    }
  }, [open, campagne]);

  const set = (patch: Partial<Criteres>) => setD((x) => ({ ...x, c: { ...x.c, ...patch } }));
  const setZone = (z: Zone) => set({ zone: z });
  const zone = d.c.zone;
  const basculerMetier = (id: string) => set({ metiers: d.c.metiers.includes(id) ? d.c.metiers.filter((m) => m !== id) : [...d.c.metiers, id] });

  const criteres = (): Criteres => ({
    ...d.c,
    zone: zone.type === "rayon" ? { type: "rayon", commune: zone.commune.trim(), rayonKm: zone.rayonKm } : zone.type === "departements" ? { type: "departements", departements: liste(d.departements) } : { type: "communes", communes: liste(d.communes) },
    nafLibres: liste(d.nafLibres),
    ancienneteMinAns: nombre(d.anciennete),
    avisMin: nombre(d.avisMin),
    noteMin: nombre(d.noteMin),
  });

  const save = async (lancer: boolean) => {
    setEnvoi(lancer ? "launch" : "save");
    setErreurs({});
    try {
      const body = { nom: d.nom, criteres: criteres() };
      let c: Campagne;
      if (campagne) {
        c = (await api.put<{ campagne: Campagne }>(`/api/prospection/campagnes/${campagne.id}`, body)).campagne;
        if (lancer) c = (await api.post<{ campagne: Campagne }>(`/api/prospection/campagnes/${c.id}/lancer`)).campagne;
      } else c = (await api.post<{ campagne: Campagne }>("/api/prospection/campagnes", { ...body, lancer })).campagne;
      toast.ok(lancer ? "Campagne lancée : suivez-la en direct" : "Campagne enregistrée");
      onSaved(c);
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) setErreurs(Object.fromEntries(e.issues.map((i) => [i.path.replace(/^criteres\./, ""), i.message])));
      toast.error((e as Error).message);
    } finally {
      setEnvoi("");
    }
  };
  const err = (k: string) => erreurs[k] ?? Object.entries(erreurs).find(([p]) => p.startsWith(`${k}.`))?.[1];
  const groupes = [
    { id: "batiment", titre: "Bâtiment" },
    { id: "services", titre: "Services courants" },
  ] as const;
  const sites: SiteCritere[] = ["peu_importe", "aucun", "aucun_ou_defaillant", "defaillant"];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={620}
      title={<div className="drawer-name">{campagne ? "Modifier la campagne" : "Nouvelle campagne"}</div>}
      footer={
        <>
          <span className="foot-hint muted">Enregistrée, elle se relance quand vous voulez.</span>
          <span className="foot-spacer" />
          <button className="btn btn-ghost" onClick={() => save(false)} disabled={!!envoi}>
            Enregistrer
          </button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={!!envoi}>
            <Icon name={envoi === "launch" ? "spinner" : "play"} size={15} className={envoi === "launch" ? "spin" : undefined} /> Enregistrer et lancer
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label className={`field${err("nom") ? " invalid" : ""}`}>
          <span className="field-label">Nom de la campagne</span>
          <input value={d.nom} onChange={(e) => setD({ ...d, nom: e.target.value })} placeholder="Électriciens et plombiers, Bron + 10 km" autoFocus />
          {err("nom") && <span className="field-error">{err("nom")}</span>}
        </label>

        <fieldset>
          <legend>Métiers</legend>
          {groupes.map((g) => (
            <div key={g.id} className="metier-groupe">
              <span className="metier-titre">{g.titre}</span>
              <div className="metier-chips">
                {(etat?.metiers ?? [])
                  .filter((m) => m.groupe === g.id)
                  .map((m) => (
                    <button type="button" key={m.id} className={`metier${d.c.metiers.includes(m.id) ? " on" : ""}`} aria-pressed={d.c.metiers.includes(m.id)} onClick={() => basculerMetier(m.id)} title={`NAF ${m.naf.join(", ")}`}>
                      {d.c.metiers.includes(m.id) && <Icon name="check" size={12} />}
                      {m.libelle}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {err("metiers") && <span className="field-error">{err("metiers")}</span>}
          <label className={`field${err("nafLibres") ? " invalid" : ""}`}>
            <span className="field-label">Autres codes NAF (facultatif)</span>
            <input value={d.nafLibres} onChange={(e) => setD({ ...d, nafLibres: e.target.value })} placeholder="43.29A, 43.12A" />
            {err("nafLibres") ? <span className="field-error">{err("nafLibres")}</span> : <span className="field-hint">Séparés par des virgules. Les services hors bâtiment sont notés, mais l'atelier ne sait pas encore fabriquer leur maquette.</span>}
          </label>
        </fieldset>

        <fieldset>
          <legend>Zone</legend>
          <div className="segmented wide">
            {(
              [
                ["rayon", "Commune + rayon"],
                ["departements", "Départements"],
                ["communes", "Liste de communes"],
              ] as const
            ).map(([t, l]) => (
              <button type="button" key={t} className={zone.type === t ? "on" : ""} onClick={() => setZone(t === "rayon" ? { type: "rayon", commune: zone.type === "rayon" ? zone.commune : "", rayonKm: zone.type === "rayon" ? zone.rayonKm : 10 } : t === "departements" ? { type: "departements", departements: liste(d.departements) } : { type: "communes", communes: liste(d.communes) })}>
                {l}
              </button>
            ))}
          </div>
          {zone.type === "rayon" && (
            <div className="grid-2 zone-fields">
              <label className={`field${err("zone.commune") ? " invalid" : ""}`}>
                <span className="field-label">Commune</span>
                <input value={zone.commune} onChange={(e) => setZone({ ...zone, commune: e.target.value })} placeholder="Bron" />
                {err("zone.commune") && <span className="field-error">{err("zone.commune")}</span>}
              </label>
              <label className={`field${err("zone.rayonKm") ? " invalid" : ""}`}>
                <span className="field-head">
                  <span className="field-label">Rayon</span>
                  <span className="mono small">{zone.rayonKm} km</span>
                </span>
                <input type="range" min={1} max={50} value={zone.rayonKm} onChange={(e) => setZone({ ...zone, rayonKm: Number(e.target.value) })} aria-label="Rayon en kilomètres" />
                {err("zone.rayonKm") ? <span className="field-error">{err("zone.rayonKm")}</span> : <span className="field-hint">Autour du centre de la commune, 50 km au plus.</span>}
              </label>
            </div>
          )}
          {zone.type === "departements" && (
            <label className={`field zone-fields${err("zone.departements") ? " invalid" : ""}`}>
              <span className="field-label">Départements</span>
              <input value={d.departements} onChange={(e) => setD({ ...d, departements: e.target.value })} placeholder="69, 38" />
              {err("zone") ? <span className="field-error">{err("zone")}</span> : <span className="field-hint">Numéros séparés par des virgules (5 au plus).</span>}
            </label>
          )}
          {zone.type === "communes" && (
            <label className={`field zone-fields${err("zone.communes") ? " invalid" : ""}`}>
              <span className="field-label">Communes</span>
              <textarea rows={3} value={d.communes} onChange={(e) => setD({ ...d, communes: e.target.value })} placeholder="Villeurbanne, Bron, Vénissieux" />
              {err("zone") ? <span className="field-error">{err("zone")}</span> : <span className="field-hint">Noms ou codes postaux, séparés par des virgules (30 au plus).</span>}
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend>Présence en ligne</legend>
          <div className="site-opts" role="radiogroup" aria-label="Site actuel">
            {sites.map((s) => (
              <button type="button" role="radio" aria-checked={d.c.site === s} key={s} className={`site-opt${d.c.site === s ? " on" : ""}`} onClick={() => set({ site: s })}>
                {etat?.siteCriteres[s] ?? s}
              </button>
            ))}
          </div>
          <div className="grid-3 crit-nums">
            <label className={`field${err("ancienneteMinAns") ? " invalid" : ""}`}>
              <span className="field-label">Ancienneté min.</span>
              <span className="input-suffix">
                <input inputMode="numeric" value={d.anciennete} onChange={(e) => setD({ ...d, anciennete: e.target.value })} placeholder="—" />
                <span>ans</span>
              </span>
            </label>
            <label className={`field${err("avisMin") ? " invalid" : ""}`}>
              <span className="field-label">Avis Google min.</span>
              <input inputMode="numeric" value={d.avisMin} onChange={(e) => setD({ ...d, avisMin: e.target.value })} placeholder="—" />
            </label>
            <label className={`field${err("noteMin") ? " invalid" : ""}`}>
              <span className="field-label">Note min.</span>
              <span className="input-suffix">
                <input inputMode="decimal" value={d.noteMin} onChange={(e) => setD({ ...d, noteMin: e.target.value })} placeholder="—" />
                <span>/ 5</span>
              </span>
            </label>
          </div>
          {(d.avisMin || d.noteMin) && !etat?.places.configure && <p className="field-hint">Sans Google Places, les avis sont inconnus : ces deux filtres ne pourront rien écarter.</p>}
        </fieldset>

        <fieldset>
          <legend>Exclusions</legend>
          <Option titre="Franchises et réseaux nationaux" desc="Signes relevés sur le site, ou plus de 3 établissements ouverts (Sirene)." on={d.c.exclusions.franchises} onChange={(v) => set({ exclusions: { ...d.c.exclusions, franchises: v } })} />
          <Option titre="Déjà contactés" desc="Statut « Contacté » ou « Perdu » sur leur fiche." on={d.c.exclusions.dejaContactes} onChange={(v) => set({ exclusions: { ...d.c.exclusions, dejaContactes: v } })} />
          <Option titre="Clients" on={d.c.exclusions.clients} onChange={(v) => set({ exclusions: { ...d.c.exclusions, clients: v } })} />
          <Option titre="Liste d'opposition et refus au registre" desc="Toujours respectés : ni désactivables, ni contournables." on onChange={() => {}} disabled />
        </fieldset>

        <fieldset>
          <legend>Sources et volume</legend>
          <Option titre="Artisans et petites entreprises" desc="19 salariés au plus, ni grande entreprise ni ETI." on={d.c.artisansSeulement} onChange={(v) => set({ artisansSeulement: v })} />
          <Option titre="Sièges seulement" desc="Un établissement secondaire n'a pas la main sur son site." on={d.c.siegeSeulement} onChange={(v) => set({ siegeSeulement: v })} />
          <Option titre="OpenStreetMap" desc="Gratuit : site web et téléphone quand ils y figurent." on={d.c.osm} onChange={(v) => set({ osm: v })} />
          <Option
            titre="Google Places"
            desc={etat?.places.configure ? `Téléphone, site, avis, horaires. ${etat.places.restants} appel(s) restant(s) ce mois-ci sur ${etat.places.plafond}.` : "Clé absente : étape sautée (Réglages pour l'ajouter)."}
            on={d.c.places}
            onChange={(v) => set({ places: v })}
            disabled={!etat?.places.configure}
          />
          <Option titre="Audit des sites existants" desc="Une visite légère par site, robots.txt respecté." on={d.c.audit} onChange={(v) => set({ audit: v })} />
          <Option titre="Lighthouse mobile" desc={etat?.lighthouse ? "Une mesure par site avec Edge (environ 15 s chacune)." : "Indisponible : installez le kit des sites (README)."} on={d.c.lighthouse} onChange={(v) => set({ lighthouse: v })} disabled={!etat?.lighthouse || !d.c.audit} />
          <label className={`field${err("limite") ? " invalid" : ""}`}>
            <span className="field-head">
              <span className="field-label">Entreprises gardées au plus</span>
              <span className="mono small">{d.c.limite}</span>
            </span>
            <input type="range" min={25} max={2000} step={25} value={d.c.limite} onChange={(e) => set({ limite: Number(e.target.value) })} aria-label="Nombre maximum d'entreprises" />
            <span className="field-hint">Les plus proches du centre d'abord. Le plan vise 300 à 500 entreprises par zone.</span>
          </label>
        </fieldset>
      </form>
    </Drawer>
  );
}
