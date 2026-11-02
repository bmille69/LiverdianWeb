import { Icon } from "../ui/Icon.tsx";
import { PageHeader } from "../ui/common.tsx";

type Soon = { title: string; icon: string; phase: string; lead: string; points: { title: string; text: string }[] };

/** Ce qui arrivera, d'après docs/VISION.md §2 et §6. */
const SOON: Record<string, Soon> = {
  prospection: {
    title: "Prospection",
    icon: "prospection",
    phase: "Phase 2",
    lead: "Trouver les entreprises qui ont besoin d'un site, par des sources légales et stables, puis les classer par une grille réglable.",
    points: [
      { title: "Campagnes de recherche", text: "Métiers (liste lisible → codes NAF), zone (commune + rayon, départements), présence de site, ancienneté, avis. Enregistrables et relançables." },
      { title: "Sources officielles", text: "API Recherche d'entreprises (gratuite), Google Places pour le téléphone, le site et les avis, et l'audit du site existant. Pas de scraping d'annuaires." },
      { title: "Audit et score", text: "Navigateur sans fenêtre + Lighthouse sur le site actuel, puis un score calculé par une grille que vous réglez ici." },
      { title: "Actions en un clic", text: "Créer la maquette · Préparer l'email · Ajouter à une séquence · Exclure · Appeler (numéro copié + script)." },
    ],
  },
  commercial: {
    title: "Commercial",
    icon: "commercial",
    phase: "Phase 3",
    lead: "Convaincre sans y passer ses soirées : des séquences sobres, des démos suivies, des réponses triées.",
    points: [
      { title: "Séquences", text: "J0 / J3 / J7 / J14 par défaut, éditables : email, courrier avec QR code, tâche « appeler » ou SMS." },
      { title: "Agent commercial", text: "Personnalise chaque message à partir de la fiche et de la maquette, classe les réponses (intéressé, question, refus, STOP) et prépare la suite." },
      { title: "Signaux", text: "Les démos sont servies par notre hébergement : on sait qui ouvre sa maquette, quand et combien de temps." },
      { title: "Délivrabilité", text: "Domaine d'envoi dédié, plafond quotidien, rebonds surveillés, liste d'opposition à vie. Le hub refuse d'envoyer hors règles." },
    ],
  },
  finance: {
    title: "Finance",
    icon: "finance",
    phase: "Phase 4",
    lead: "Devis, factures et abonnements conformes, calculés par du code — jamais par un modèle.",
    points: [
      { title: "Devis et factures", text: "Numérotation continue, mentions micro-entreprise, « TVA non applicable, art. 293 B du CGI » tant que franchise, PDF." },
      { title: "Paiement", text: "Liens Stripe (acompte, solde), abonnements, rapprochement automatique : une facture passe « payée » seule." },
      { title: "Tableau de bord", text: "CA encaissé, récurrent mensuel, impayés, coût d'acquisition, CA à déclarer à l'URSSAF, alertes avant les plafonds." },
      { title: "Facturation électronique", text: "Factures stockées en données structurées dès le départ, prêtes pour l'obligation d'émission de septembre 2027." },
    ],
  },
};

export function SoonPage({ id }: { id: keyof typeof SOON }) {
  const s = SOON[id]!;
  return (
    <div className="page">
      <PageHeader title={s.title} subtitle={<span className="badge tone-violet">{s.phase} · bientôt</span>} />
      <div className="soon">
        <div className="soon-hero">
          <div className="soon-icon">
            <Icon name={s.icon} size={26} />
          </div>
          <p className="soon-lead">{s.lead}</p>
        </div>
        <div className="soon-grid">
          {s.points.map((p, i) => (
            <div key={p.title} className="soon-card" style={{ animationDelay: `${80 + i * 60}ms` }}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
