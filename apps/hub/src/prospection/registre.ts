/**
 * Registre des activités de traitement (RGPD, art. 30), fiche « Prospection commerciale B2B », générée à partir de
 * l'état réel du hub : ce qui est stocké, d'où, combien de temps, qui le reçoit. À relire et compléter par le
 * responsable de traitement (identité, adresse) : le hub ne connaît pas encore ces informations.
 */
export type EtatRegistre = {
  genereLe: string;
  purgeMois: number;
  placesConfigure: boolean;
  deepseekConfigure: boolean;
  prospects: number;
  qualifies: number;
  exclus: number;
  oppositions: number;
  derniereCampagne: string | null;
};

export function registreMarkdown(e: EtatRegistre): string {
  const date = new Date(e.genereLe).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const destinataires = [
    "- **Aucune cession ni location** des données à des tiers.",
    "- **Anthropic (Claude Code)** : extraits publics des sites des entreprises (titre, textes visibles, emails affichés) pour qualifier la présence en ligne, quand DeepSeek n'est pas configuré.",
    e.deepseekConfigure
      ? "- **DeepSeek** (configuré) : les mêmes extraits publics, pour la même finalité. Prestataire situé hors de l'Union européenne : transfert à encadrer."
      : "- DeepSeek : non configuré, aucun envoi.",
    e.placesConfigure
      ? "- **Google (Places API)** : nom et commune de l'entreprise, pour retrouver sa fiche publique (téléphone, site, note, horaires)."
      : "- Google Places : non configuré, aucun envoi.",
    "- OpenStreetMap (Overpass) et l'API Recherche d'entreprises : requêtes par zone et code d'activité, sans donnée nominative envoyée.",
  ];
  return `# Registre de traitement — Prospection commerciale B2B

Généré par Liverdian le ${date}. Fiche à relire et compléter (identité et coordonnées du responsable).

## Responsable du traitement
À compléter : nom de l'entrepreneur, SIRET de la micro-entreprise, adresse, email de contact.

## Finalité
Identifier des entreprises (artisans, petites entreprises de services) susceptibles d'avoir besoin d'un site web,
évaluer leur présence en ligne, et leur proposer une maquette de site. Prospection **entre professionnels** portant
sur leur activité professionnelle.

## Base légale
Intérêt légitime (art. 6.1.f du RGPD) : prospection B2B en rapport avec l'activité du destinataire, avec identification
de l'expéditeur et possibilité simple de refuser (mention STOP dans chaque message, liste d'opposition à vie).

## Personnes concernées
Entreprises et, pour les entrepreneurs individuels, la personne qui exerce. Les entreprises qui se sont opposées à la
prospection au registre (RNE) ou dont la diffusion est restreinte (Sirene) ne sont **jamais** reprises.

## Données traitées (et seulement celles-ci)
- Identité de l'entreprise : raison sociale, nom commercial, SIREN, SIRET, code NAF, date de création, tranche d'effectif.
- Un seul dirigeant (prénom et nom), pour s'adresser à la bonne personne. Ni date de naissance, ni autre dirigeant.
- Coordonnées professionnelles publiques : adresse de l'établissement, téléphone, site web, email affiché sur le site.
- Note Google et nombre d'avis (jamais le texte des avis ni les photos), horaires.
- Relevés de l'audit du site (HTTPS, mobile, année du copyright, technologie) et le détail du score. Aucune copie des pages.

## Sources
API Recherche d'entreprises (data.gouv), Google Places API (officielle), OpenStreetMap, le site public de l'entreprise.
Pas de scraping d'annuaires ni de Google Maps.

## Destinataires
${destinataires.join("\n")}

## Durée de conservation
- Prospect non converti : supprimé automatiquement après **${e.purgeMois} mois** sans activité.
- Fiche écartée par une campagne (filtres non remplis) : supprimée à la fin de la campagne.
- Réponses des API en cache : 7 jours (Sirene, OpenStreetMap) à 30 jours (Google Places, communes), puis effacées.
- Liste d'opposition : conservée sans limite, sous forme d'**empreintes** (SHA-256) du SIREN, du téléphone ou de l'email,
  jamais en clair : elle sert seulement à ne plus jamais contacter ces entreprises.

## Droits des personnes
Accès, rectification, effacement, opposition : sur simple demande (réponse à un message, STOP, courrier). Une opposition
supprime la fiche et inscrit l'entreprise sur la liste d'opposition (bouton « Exclure » › « Opposition »).

## Sécurité
Base locale sur le poste du responsable (aucun accès réseau entrant), clés d'API hors du code et des journaux.

## État au ${date}
- Prospects en base : ${e.prospects} (dont ${e.qualifies} qualifiés, ${e.exclus} exclus)
- Entrées sur la liste d'opposition : ${e.oppositions}
- Dernière campagne : ${e.derniereCampagne ?? "aucune"}
`;
}
