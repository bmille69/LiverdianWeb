/**
 * Codes NAF du bâtiment → métier du kit et prestations plausibles. Ces prestations ne sont pas des faits sur
 * l'entreprise : ce sont les travaux que ce code d'activité couvre normalement. Le Rédacteur choisit parmi elles
 * (il ne promet rien d'autre) et le contrôle des faits s'y réfère.
 */
export type MetierKit = "electricien" | "plombier" | "chauffagiste" | "couvreur" | "menuisier" | "peintre" | "macon" | "paysagiste" | "autre";

export type ActiviteNaf = {
  naf: string;
  intitule: string;
  metier: MetierKit;
  /** Libellé du métier pour les titres (« Électricien »). */
  libelle: string;
  /** Préréglage de thème du kit le plus proche (le kit n'en a pas pour tous les métiers). */
  preset: "electricien" | "plombier" | "chauffagiste" | "couvreur" | "menuisier" | "peintre";
  /** Dossiers de la banque d'images à proposer au Directeur artistique (en plus de « maison »). */
  banque: string[];
  prestations: string[];
};

export const NAF: ActiviteNaf[] = [
  {
    naf: "43.21A",
    intitule: "Travaux d'installation électrique dans tous locaux",
    metier: "electricien",
    libelle: "Électricien",
    preset: "electricien",
    banque: ["electricien"],
    prestations: [
      "Dépannage électrique (panne, disjoncteur ou différentiel qui saute, prise qui chauffe)",
      "Mise en sécurité et mise aux normes NF C 15-100",
      "Remplacement ou rénovation du tableau électrique",
      "Rénovation électrique complète d'un logement",
      "Création de circuits, prises et points lumineux",
      "Éclairage intérieur et extérieur (spots, suspensions, LED)",
      "Ventilation (VMC) : pose et remplacement",
      "Chauffage électrique (radiateurs, programmation)",
      "Interphone, visiophone, portail motorisé (raccordement)",
      "Borne de recharge de véhicule électrique",
    ],
  },
  {
    naf: "43.21B",
    intitule: "Travaux d'installation électrique sur la voie publique",
    metier: "electricien",
    libelle: "Électricien",
    preset: "electricien",
    banque: ["electricien"],
    prestations: ["Éclairage extérieur", "Raccordements", "Installations électriques extérieures"],
  },
  {
    naf: "43.22A",
    intitule: "Travaux d'installation d'eau et de gaz en tous locaux",
    metier: "plombier",
    libelle: "Plombier",
    preset: "plombier",
    banque: ["plombier"],
    prestations: [
      "Recherche et réparation de fuite",
      "Débouchage (évier, WC, canalisation)",
      "Remplacement de chauffe-eau et ballon d'eau chaude",
      "Robinetterie, mitigeurs, WC et sanitaires",
      "Création ou rénovation de salle de bain",
      "Réseaux d'eau et d'évacuation (cuivre, multicouche, PER)",
      "Installation et raccordement gaz",
    ],
  },
  {
    naf: "43.22B",
    intitule: "Travaux d'installation d'équipements thermiques et de climatisation",
    metier: "chauffagiste",
    libelle: "Chauffagiste",
    preset: "chauffagiste",
    banque: ["chauffagiste"],
    prestations: [
      "Installation et remplacement de chaudière",
      "Entretien annuel et dépannage de chaudière",
      "Pompe à chaleur air-eau et air-air",
      "Climatisation",
      "Radiateurs et plancher chauffant",
      "Désembouage et équilibrage du circuit de chauffage",
    ],
  },
  {
    naf: "43.91A",
    intitule: "Travaux de charpente",
    metier: "couvreur",
    libelle: "Charpentier",
    preset: "couvreur",
    banque: ["couvreur", "menuisier"],
    prestations: ["Charpente traditionnelle et industrielle", "Réparation et renforcement de charpente", "Traitement des bois de charpente", "Extension et surélévation en bois"],
  },
  {
    naf: "43.91B",
    intitule: "Travaux de couverture par éléments",
    metier: "couvreur",
    libelle: "Couvreur",
    preset: "couvreur",
    banque: ["couvreur"],
    prestations: [
      "Réfection de toiture",
      "Recherche et réparation de fuite de toit",
      "Remplacement de tuiles cassées ou déplacées",
      "Zinguerie : gouttières, chéneaux, descentes",
      "Démoussage et traitement de toiture",
      "Fenêtres de toit",
      "Isolation de toiture",
    ],
  },
  {
    naf: "43.32A",
    intitule: "Travaux de menuiserie bois et PVC",
    metier: "menuisier",
    libelle: "Menuisier",
    preset: "menuisier",
    banque: ["menuisier"],
    prestations: ["Fenêtres et portes-fenêtres", "Portes d'entrée et portes intérieures", "Volets", "Placards et aménagements sur mesure", "Escaliers", "Parquet"],
  },
  {
    naf: "43.32B",
    intitule: "Travaux de menuiserie métallique et serrurerie",
    metier: "menuisier",
    libelle: "Menuisier métallier",
    preset: "menuisier",
    banque: ["menuisier"],
    prestations: ["Menuiseries aluminium", "Portails et clôtures métalliques", "Garde-corps et rampes", "Serrurerie"],
  },
  {
    naf: "43.34Z",
    intitule: "Travaux de peinture et vitrerie",
    metier: "peintre",
    libelle: "Peintre en bâtiment",
    preset: "peintre",
    banque: ["peintre"],
    prestations: ["Peinture intérieure (murs, plafonds, boiseries)", "Peinture de façade", "Préparation des supports, enduits, rebouchage", "Revêtements muraux et papier peint", "Vitrerie"],
  },
  {
    naf: "43.31Z",
    intitule: "Travaux de plâtrerie",
    metier: "autre",
    libelle: "Plâtrier plaquiste",
    preset: "peintre",
    banque: ["peintre"],
    prestations: ["Cloisons et doublages en plaque de plâtre", "Faux plafonds", "Isolation intérieure", "Enduits"],
  },
  {
    naf: "43.33Z",
    intitule: "Travaux de revêtement des sols et des murs",
    metier: "autre",
    libelle: "Carreleur",
    preset: "peintre",
    banque: ["peintre"],
    prestations: ["Carrelage sol et mur", "Faïence de salle de bain et cuisine", "Pose de parquet et sols souples", "Chape et ragréage"],
  },
  {
    naf: "43.99C",
    intitule: "Travaux de maçonnerie générale et gros œuvre de bâtiment",
    metier: "macon",
    libelle: "Maçon",
    preset: "couvreur",
    banque: ["maison"],
    prestations: ["Maçonnerie générale", "Ouverture de mur porteur", "Extension et agrandissement", "Dalle, chape et fondations", "Murs et clôtures", "Rénovation de façade"],
  },
  {
    naf: "81.30Z",
    intitule: "Services d'aménagement paysager",
    metier: "paysagiste",
    libelle: "Paysagiste",
    preset: "menuisier",
    banque: ["maison"],
    prestations: ["Création de jardin", "Entretien d'espaces verts", "Taille de haies et élagage", "Engazonnement", "Terrasses et allées"],
  },
];

/** Mots du métier (saisie libre) → code NAF, quand la fiche n'a pas de NAF. */
const MOTS: [RegExp, string][] = [
  [/[ée]lectric/i, "43.21A"],
  [/chauffag|climatis|pompe [àa] chaleur/i, "43.22B"],
  [/plomb/i, "43.22A"],
  [/charpent/i, "43.91A"],
  [/couvr|toitur|zingu/i, "43.91B"],
  [/serrur|m[ée]tall/i, "43.32B"],
  [/menuis/i, "43.32A"],
  [/peint/i, "43.34Z"],
  [/pl[âa]tr|plaquis/i, "43.31Z"],
  [/carrel/i, "43.33Z"],
  [/ma[çc]on/i, "43.99C"],
  [/paysag|jardin/i, "81.30Z"],
];

export function activiteDe(naf: string | null | undefined, metier: string | null | undefined): { activite: ActiviteNaf; via: "naf" | "metier" } | null {
  if (naf) {
    const a = NAF.find((x) => x.naf === naf);
    if (a) return { activite: a, via: "naf" };
  }
  if (metier) {
    const code = MOTS.find(([re]) => re.test(metier))?.[1];
    const a = code ? NAF.find((x) => x.naf === code) : undefined;
    if (a) return { activite: a, via: "metier" };
  }
  return null;
}
