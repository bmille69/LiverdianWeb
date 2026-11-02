import { useState, type ReactNode } from "react";
import { api, ApiError, type Company, type Jour, type Source, type Statut } from "../api.ts";
import { Icon } from "../ui/Icon.tsx";
import { Drawer } from "../ui/common.tsx";
import { useToast } from "../ui/toasts.tsx";
import { SOURCE_LABEL, STATUT } from "./labels.tsx";

const JOURS: Jour[] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const SOURCES: Source[] = ["saisie", "sirene", "places", "osm", "audit"];

type Draft = {
  raisonSociale: string;
  nomCommercial: string;
  siren: string;
  naf: string;
  metier: string;
  dateCreation: string;
  dirigeant: string;
  telephone: string;
  email: string;
  siteActuel: string;
  adresseLigne: string;
  codePostal: string;
  commune: string;
  horaires: Partial<Record<Jour, string>>;
  googleValeur: string;
  googleNombre: string;
  googleUrl: string;
  zoneCommune: string;
  zoneVoisines: string;
  statut: Statut;
  score: string;
  notes: string;
  sources: Partial<Record<string, Source>>;
};

function toDraft(c: Company | null): Draft {
  return {
    raisonSociale: c?.raisonSociale ?? "",
    nomCommercial: c?.nomCommercial ?? "",
    siren: c?.siren ?? "",
    naf: c?.naf ?? "",
    metier: c?.metier ?? "",
    dateCreation: c?.dateCreation ?? "",
    dirigeant: c?.dirigeant ?? "",
    telephone: c?.telephone ?? "",
    email: c?.email ?? "",
    siteActuel: c?.siteActuel ?? "",
    adresseLigne: c?.adresse.ligne ?? "",
    codePostal: c?.adresse.codePostal ?? "",
    commune: c?.adresse.commune ?? "",
    horaires: c?.horaires ?? {},
    googleValeur: c?.google?.valeur != null ? String(c.google.valeur).replace(".", ",") : "",
    googleNombre: c?.google?.nombre != null ? String(c.google.nombre) : "",
    googleUrl: c?.google?.url ?? "",
    zoneCommune: c?.zone.commune ?? "",
    zoneVoisines: c?.zone.voisines.join(", ") ?? "",
    statut: c?.statut ?? "prospect",
    score: c?.score != null ? String(c.score) : "",
    notes: c?.notes ?? "",
    sources: c?.sources ?? {},
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function toPayload(d: Draft) {
  const horaires = Object.fromEntries(Object.entries(d.horaires).filter(([, v]) => v && v.trim()));
  const hasGoogle = d.googleValeur.trim() || d.googleNombre.trim() || d.googleUrl.trim();
  return {
    raisonSociale: d.raisonSociale,
    nomCommercial: d.nomCommercial,
    siren: d.siren,
    naf: d.naf,
    metier: d.metier,
    dateCreation: d.dateCreation,
    dirigeant: d.dirigeant,
    telephone: d.telephone,
    email: d.email,
    siteActuel: d.siteActuel,
    adresse: { ligne: d.adresseLigne, codePostal: d.codePostal, commune: d.commune },
    horaires,
    google: hasGoogle ? { valeur: num(d.googleValeur), nombre: num(d.googleNombre), url: d.googleUrl } : null,
    zone: {
      commune: d.zoneCommune,
      voisines: d.zoneVoisines
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    },
    statut: d.statut,
    score: num(d.score),
    notes: d.notes.trim() ? d.notes : null,
    sources: d.sources,
  };
}

/** Sélecteur discret de la provenance d'une donnée. */
function SourcePick({ field, d, set }: { field: string; d: Draft; set: (s: Partial<Record<string, Source>>) => void }) {
  const value = d.sources[field] ?? "saisie";
  return (
    <select className={`source-pick src-${value}`} value={value} onChange={(e) => set({ ...d.sources, [field]: e.target.value as Source })} aria-label="Source de la donnée" title="D'où vient cette donnée ?">
      {SOURCES.map((s) => (
        <option key={s} value={s}>
          {SOURCE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

function Field({ label, children, source, error, wide, hint }: { label: string; children: ReactNode; source?: ReactNode; error?: string; wide?: boolean; hint?: string }) {
  return (
    <label className={`field${wide ? " wide" : ""}${error ? " invalid" : ""}`}>
      <span className="field-head">
        <span className="field-label">{label}</span>
        {source}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function CompanyForm({ company, open, onClose, onSaved }: { company: Company | null; open: boolean; onClose: () => void; onSaved: (c: Company) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => toDraft(company));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastId, setLastId] = useState<string | null | undefined>(undefined);
  // Réinitialise le brouillon quand on ouvre une autre fiche (ou une nouvelle).
  if (open && lastId !== (company?.id ?? null)) {
    setLastId(company?.id ?? null);
    setD(toDraft(company));
    setErrors({});
  }
  if (!open && lastId !== undefined) setLastId(undefined);

  const up = <K extends keyof Draft>(k: K) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const setSources = (s: Partial<Record<string, Source>>) => setD((x) => ({ ...x, sources: s }));
  const src = (field: string, filled: boolean) => (filled ? <SourcePick field={field} d={d} set={setSources} /> : null);
  const err = (path: string) => errors[path];

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const payload = toPayload(d);
      const r = company ? await api.patch<{ company: Company }>(`/api/companies/${company.id}`, payload) : await api.post<{ company: Company }>("/api/companies", payload);
      toast.ok(company ? "Fiche enregistrée" : "Entreprise créée");
      onSaved(r.company);
    } catch (e) {
      if (e instanceof ApiError && e.issues.length) setErrors(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      title={company ? `Modifier · ${company.nomCommercial ?? company.raisonSociale}` : "Nouvelle entreprise"}
      footer={
        <>
          <span className="foot-hint">Les étiquettes à côté des champs indiquent d'où vient chaque donnée.</span>
          <button className="btn btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <Icon name="spinner" size={15} className="spin" /> : <Icon name="check" size={15} />}
            {company ? "Enregistrer" : "Créer la fiche"}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset>
          <legend>Identité</legend>
          <div className="grid-2">
            <Field label="Raison sociale *" source={src("raisonSociale", !!d.raisonSociale)} error={err("raisonSociale")} wide>
              <input value={d.raisonSociale} onChange={up("raisonSociale")} placeholder="Plomberie Martin SARL" autoFocus />
            </Field>
            <Field label="Nom commercial" source={src("nomCommercial", !!d.nomCommercial)} error={err("nomCommercial")}>
              <input value={d.nomCommercial} onChange={up("nomCommercial")} placeholder="Martin Plomberie" />
            </Field>
            <Field label="Métier" source={src("metier", !!d.metier)} error={err("metier")}>
              <input value={d.metier} onChange={up("metier")} placeholder="Plombier chauffagiste" />
            </Field>
            <Field label="SIREN" source={src("siren", !!d.siren)} error={err("siren")}>
              <input value={d.siren} onChange={up("siren")} inputMode="numeric" placeholder="123 456 789" />
            </Field>
            <Field label="Code NAF" source={src("naf", !!d.naf)} error={err("naf")}>
              <input value={d.naf} onChange={up("naf")} placeholder="43.22A" />
            </Field>
            <Field label="Date de création" source={src("dateCreation", !!d.dateCreation)} error={err("dateCreation")}>
              <input type="date" value={d.dateCreation} onChange={up("dateCreation")} />
            </Field>
            <Field label="Dirigeant" source={src("dirigeant", !!d.dirigeant)} error={err("dirigeant")}>
              <input value={d.dirigeant} onChange={up("dirigeant")} placeholder="Jean Martin" />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>Contact</legend>
          <div className="grid-2">
            <Field label="Téléphone" source={src("telephone", !!d.telephone)} error={err("telephone")}>
              <input value={d.telephone} onChange={up("telephone")} inputMode="tel" placeholder="04 78 00 00 00" />
            </Field>
            <Field label="Email" source={src("email", !!d.email)} error={err("email")}>
              <input value={d.email} onChange={up("email")} inputMode="email" placeholder="contact@exemple.fr" />
            </Field>
            <Field label="Site actuel" source={src("siteActuel", !!d.siteActuel)} error={err("siteActuel")} wide>
              <input value={d.siteActuel} onChange={up("siteActuel")} placeholder="https://… (vide s'il n'en a pas)" />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>Adresse et zone</legend>
          <div className="grid-2">
            <Field label="Adresse" source={src("adresse", !!(d.adresseLigne || d.codePostal || d.commune))} error={err("adresse.ligne")} wide>
              <input value={d.adresseLigne} onChange={up("adresseLigne")} placeholder="3 rue des Lilas" />
            </Field>
            <Field label="Code postal" error={err("adresse.codePostal")}>
              <input value={d.codePostal} onChange={up("codePostal")} inputMode="numeric" placeholder="69003" />
            </Field>
            <Field label="Commune" error={err("adresse.commune")}>
              <input value={d.commune} onChange={up("commune")} placeholder="Lyon" />
            </Field>
            <Field label="Commune de la zone" source={src("zone", !!(d.zoneCommune || d.zoneVoisines))} error={err("zone.commune")}>
              <input value={d.zoneCommune} onChange={up("zoneCommune")} placeholder="Lyon 3e" />
            </Field>
            <Field label="Communes voisines" hint="Séparées par des virgules" error={err("zone.voisines")}>
              <input value={d.zoneVoisines} onChange={up("zoneVoisines")} placeholder="Villeurbanne, Bron" />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>
            Horaires <span className="legend-src">{src("horaires", Object.values(d.horaires).some((v) => v?.trim()))}</span>
          </legend>
          <div className="hours">
            {JOURS.map((j) => (
              <label key={j} className="hours-row">
                <span className="hours-day">{j}</span>
                <input value={d.horaires[j] ?? ""} onChange={(e) => setD((x) => ({ ...x, horaires: { ...x.horaires, [j]: e.target.value } }))} placeholder={j === "dimanche" ? "Fermé" : "8h–12h, 14h–18h"} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Avis Google</legend>
          <div className="grid-3">
            <Field label="Note" source={src("google", !!(d.googleValeur || d.googleNombre || d.googleUrl))} error={err("google.valeur")}>
              <input value={d.googleValeur} onChange={up("googleValeur")} inputMode="decimal" placeholder="4,7" />
            </Field>
            <Field label="Nombre d'avis" error={err("google.nombre")}>
              <input value={d.googleNombre} onChange={up("googleNombre")} inputMode="numeric" placeholder="38" />
            </Field>
            <Field label="Lien de la fiche" error={err("google.url")}>
              <input value={d.googleUrl} onChange={up("googleUrl")} placeholder="https://maps.google.com/…" />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>Suivi commercial</legend>
          <div className="grid-2">
            <Field label="Statut">
              <select value={d.statut} onChange={up("statut")}>
                {(Object.keys(STATUT) as Statut[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUT[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Score" hint="De 0 à 100" error={err("score")}>
              <input value={d.score} onChange={up("score")} inputMode="numeric" placeholder="—" />
            </Field>
            <Field label="Notes" wide error={err("notes")}>
              <textarea value={d.notes} onChange={up("notes")} rows={4} placeholder="Ce qu'il faut savoir sur cette entreprise…" />
            </Field>
          </div>
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
