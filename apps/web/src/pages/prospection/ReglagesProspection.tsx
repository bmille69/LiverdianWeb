import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import { useApi } from "../../live.tsx";
import type { EtatProspection } from "../../prospection-api.ts";
import { Icon } from "../../ui/Icon.tsx";
import { useToast } from "../../ui/toasts.tsx";

type Secrets = { secrets: Record<"GOOGLE_PLACES_API_KEY" | "DEEPSEEK_API_KEY", { libelle: string; configure: boolean; parEnvironnement: boolean }> };

/** Réglages › Prospection : clés d'API (écrites dans .data/settings/secrets.json, jamais relues par l'interface) et plafond Places. */
export function ReglagesProspection() {
  const etat = useApi<EtatProspection>("/api/prospection/etat", ["settings", "prospection"]);
  const secrets = useApi<Secrets>("/api/secrets", ["settings"]);
  const toast = useToast();
  const [plafond, setPlafond] = useState("");
  useEffect(() => {
    if (etat.data) setPlafond(String(etat.data.places.plafond));
  }, [etat.data?.places.plafond]);

  const enregistrerPlafond = async () => {
    const n = Number(plafond);
    try {
      await api.patch("/api/settings", { "prospection.places.plafondMensuel": n });
      toast.ok(`Plafond Google Places : ${n} appels par mois`);
      etat.reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const p = etat.data?.places;
  return (
    <section className="settings-group">
      <h2>Prospection</h2>
      <Cle nom="GOOGLE_PLACES_API_KEY" info={secrets.data?.secrets.GOOGLE_PLACES_API_KEY} onSaved={() => (secrets.reload(), etat.reload())} placeholder="AIza…">
        Téléphone, site web, note et nombre d'avis, horaires de chaque prospect. À créer sur la console Google Cloud (API « Places API (New) »), voir le README.
      </Cle>
      {p && (
        <div className="setting">
          <div>
            <div className="setting-title">Plafond mensuel Google Places</div>
            <div className="setting-desc">
              {p.appels} appel(s) ce mois-ci (~{p.coutUsd.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $ au tarif public, avant quota gratuit). Google offre {p.quotaGratuit}{" "}
              recherches par mois, puis environ {p.coutParAppelUsd.toLocaleString("fr-FR")} $ l'une : le hub refuse de dépasser ce plafond.
            </div>
          </div>
          <span className="cle-saisie">
            <input inputMode="numeric" value={plafond} onChange={(e) => setPlafond(e.target.value)} aria-label="Plafond mensuel" style={{ width: 90 }} />
            <button className="btn btn-ghost btn-sm" onClick={enregistrerPlafond} disabled={plafond === String(p.plafond)}>
              Enregistrer
            </button>
          </span>
        </div>
      )}
      <Cle nom="DEEPSEEK_API_KEY" info={secrets.data?.secrets.DEEPSEEK_API_KEY} onSaved={() => (secrets.reload(), etat.reload())} placeholder="sk-…">
        Facultatif. L'Éclaireur l'utilise pour trancher le flou des audits (franchise, vrai site, email) ; sans elle, c'est Claude haiku sur votre abonnement.
      </Cle>
    </section>
  );
}

function Cle({ nom, info, onSaved, placeholder, children }: { nom: string; info: { libelle: string; configure: boolean; parEnvironnement: boolean } | undefined; onSaved: () => void; placeholder: string; children: React.ReactNode }) {
  const toast = useToast();
  const [valeur, setValeur] = useState("");
  const [ouvert, setOuvert] = useState(false);
  const save = async (v: string | null) => {
    try {
      await api.put("/api/secrets", { nom, valeur: v });
      toast.ok(v ? `${info?.libelle ?? "Clé"} enregistrée` : `${info?.libelle ?? "Clé"} retirée`);
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
        <div className="setting-title">{info?.libelle ?? nom}</div>
        <div className="setting-desc">{children}</div>
        {ouvert && (
          <form
            className="cle-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(valeur);
            }}
          >
            <input type="password" autoComplete="off" spellCheck={false} value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={placeholder} aria-label={info?.libelle ?? nom} autoFocus />
            <button className="btn btn-primary btn-sm" disabled={valeur.trim().length < 20}>
              Enregistrer
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert(false)}>
              Annuler
            </button>
          </form>
        )}
        {ouvert && <div className="setting-desc">Rangée dans <code>.data/settings/secrets.json</code>, jamais en base ni dans les journaux, jamais réaffichée.</div>}
      </div>
      <span className="cle-saisie">
        <span className={`badge ${info?.configure ? "tone-green" : "tone-muted"}`}>
          {info?.configure && <Icon name="check" size={12} />}
          {info?.parEnvironnement ? "Variable d'environnement" : info?.configure ? "Configurée" : "Non configurée"}
        </span>
        {!info?.parEnvironnement && !ouvert && (
          <button className="btn btn-ghost btn-sm" onClick={() => setOuvert(true)}>
            {info?.configure ? "Remplacer" : "Ajouter"}
          </button>
        )}
        {info?.configure && !info.parEnvironnement && !ouvert && (
          <button className="icon-btn sm" onClick={() => save(null)} title="Retirer la clé" aria-label="Retirer la clé">
            <Icon name="trash" size={14} />
          </button>
        )}
      </span>
    </div>
  );
}
