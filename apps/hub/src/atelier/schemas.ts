import { z } from "zod";

/**
 * Schémas de sortie des agents de la recette « vitrine artisan ». Demandés au CLI (--json-schema) puis revérifiés.
 * Ils fixent la forme ; le contrat final (longueurs, variantes, règles croisées) reste celui du kit
 * (`packages/site-kit/src/schema.ts`), appliqué à l'assemblage : une erreur y renvoie à l'agent fautif.
 */
/*
 * Ces listes recopient celles du kit (packages/site-kit/src/schema.ts) : le hub n'importe pas le kit dans son code
 * (dépendances séparées). Un test vérifie qu'elles restent identiques.
 */
export const PRESETS = ["electricien", "plombier", "chauffagiste", "couvreur", "menuisier", "peintre"] as const;
export const POLICES = ["archivo", "barlow-semi-condensed", "bitter", "bricolage-grotesque", "dm-sans", "dm-serif-display", "figtree", "fraunces", "hanken-grotesk", "instrument-sans", "instrument-serif", "inter", "libre-franklin", "literata", "manrope", "newsreader", "oswald", "plus-jakarta-sans", "public-sans", "red-hat-display", "roboto-slab", "schibsted-grotesk", "sora", "source-sans-3", "space-grotesk", "work-sans", "young-serif"] as const;
export const PAIRES_POLICES = ["atelier-technique", "plan-de-coupe", "chantier-net", "grotesque-franche", "geometrie-douce", "contemporain-clair", "industriel-condense", "affiche-robuste", "signaletique", "editorial-serif", "maison-de-famille", "gazette-locale", "artisan-d-art", "bois-et-papier", "elegance-sobre", "patrimoine", "slab-robuste", "slab-editorial", "rondeur-accueillante", "precision-suisse", "caractere-fort", "classique-moderne"] as const;
export const SIGNATURES = ["faisceau", "onde", "isobares", "tuiles", "veinage", "aplat", "cotes", "points", "chevrons", "briques", "rayures", "topo"] as const;
export const TYPES_SECTION = ["hero", "services", "pourquoi", "realisations", "avis", "zone", "appel", "devis", "surmesure"] as const;
export const COULEURS = ["fond", "surface", "teinte", "encre", "encreDouce", "trait", "sombre", "sombreSurface", "surSombre", "surSombreDoux", "accent", "surAccent", "accentTexte", "accentSurSombre"] as const;
export const FONDS = ["clair", "surface", "teinte", "sombre"] as const;
export const ENTETES = ["simple", "double", "centre"] as const;
export const PIEDS = ["complet", "sobre", "signature"] as const;

export const VARIANTES: Record<(typeof TYPES_SECTION)[number], string[]> = {
  hero: ["photo", "typo", "scinde", "panorama", "encart"],
  services: ["cartes", "liste", "bandes", "index", "tuiles"],
  pourquoi: ["colonnes", "manifeste", "etapes", "encadre"],
  realisations: ["mosaique", "grille", "bande", "diptyque"],
  avis: ["badge", "bandeau"],
  zone: ["carte", "liste", "tableau", "bandeau"],
  appel: ["bande", "carte"],
  devis: ["scinde", "encadre", "plein", "appel"],
  surmesure: ["composant"],
};

export const MISE = {
  echelle: ["equilibree", "sobre", "affirmee", "monumentale"],
  densite: ["standard", "compacte", "aeree"],
  images: ["naturel", "franc", "passe-partout", "duotone", "contraste"],
  cadre: ["auto", "simple", "equerres", "decale", "arche", "lisere", "coin"],
  boutons: ["plein", "pilule", "marque", "carre"],
  rythme: ["alterne", "contraste", "clair", "chaud"],
  titres: ["normale", "capitales"],
  surtitres: ["marqueur", "filet", "pastille", "simple"],
} as const;

export const PALETTE = {
  vivacite: ["franche", "sourde", "vive"],
  accentTon: ["clair", "fonce"],
  neutres: ["teintes", "gris", "colores"],
  fond: ["casse", "blanc", "teinte"],
  sombre: ["profond", "nuit", "colore"],
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "couleur #RRGGBB");
const cle = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "clé : minuscules, chiffres, tirets");

const teinte = z.number().int().min(0).max(359);

export const DesignSchema = z.object({
  intention: z.array(z.string().min(20)).length(3).describe("L'intention du site en exactement 3 phrases : pour qui, quelle impression, comment il se distingue"),
  theme: z.object({
    preset: z.enum(PRESETS),
    palette: z
      .object({
        teinte: teinte.describe("Teinte des neutres et du fond sombre, 0-359° (cercle OKLCH)"),
        accent: teinte.describe("Teinte de l'accent, 0-359°"),
        vivacite: z.enum(PALETTE.vivacite),
        accentTon: z.enum(PALETTE.accentTon),
        neutres: z.enum(PALETTE.neutres),
        fond: z.enum(PALETTE.fond),
        sombre: z.enum(PALETTE.sombre),
      })
      .describe("Palette propre au site, calculée par le code (contrastes AA garantis)"),
    couleurs: z
      .object(Object.fromEntries(COULEURS.map((k) => [k, hex.optional()])) as Record<(typeof COULEURS)[number], z.ZodOptional<typeof hex>>)
      .optional()
      .describe("Surcharges ponctuelles de la palette générée : à éviter sauf raison précise"),
    polices: z.object({ paire: z.enum(PAIRES_POLICES) }).describe("Paire de polices du catalogue"),
    rayon: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(12), z.literal(16)]),
    signature: z.enum(SIGNATURES),
    mise: z
      .object({
        echelle: z.enum(MISE.echelle),
        densite: z.enum(MISE.densite),
        images: z.enum(MISE.images),
        cadre: z.enum(MISE.cadre),
        boutons: z.enum(MISE.boutons),
        rythme: z.enum(MISE.rythme),
        titres: z.enum(MISE.titres),
        surtitres: z.enum(MISE.surtitres),
      })
      .describe("Mise en page, indépendante des couleurs"),
  }),
  ajustements: z.string().min(20).describe("Ce qui distingue ce site des sites proches du registre (unicite-design.json), et pourquoi ces choix"),
  entete: z.object({ variante: z.enum(ENTETES) }),
  pied: z.object({ variante: z.enum(PIEDS) }),
  images: z
    .array(
      z.object({
        cle,
        fichier: z.string().describe("Chemin exact de la banque, ex. stock/electricien/tableau-electrique-01.jpg"),
        alt: z.string().min(10).max(160).describe("Ce que montre réellement la photo, sans mot-clé plaqué"),
        focale: z.string().regex(/^\d{1,3}% \d{1,3}%$/).optional().describe("Point focal CSS, ex. « 50% 30% »"),
        justification: z.string().min(10),
      }),
    )
    .max(12),
  sections: z
    .array(
      z.object({
        type: z.enum(TYPES_SECTION),
        variante: z.string(),
        image: cle.optional().describe("Image de la section (hero photo/scinde, pourquoi, appel)"),
        images: z.array(cle).optional().describe("Réalisations : images dans l'ordre ; services bandes : une image par service ; services liste : image du 1er service"),
        nombreItems: z.number().int().min(2).max(10).optional().describe("Services / pourquoi / surmesure : nombre d'éléments attendus du Rédacteur"),
        fond: z.enum(FONDS).optional().describe("Fond imposé (sinon celui de la variante selon le rythme)"),
        justification: z.string().min(10),
      }),
    )
    .min(4)
    .max(10),
  zoneVoisines: z.array(z.string()).optional().describe("Seulement si le brief n'a pas de voisines saisies : 4 à 8 noms exacts pris dans zone.candidates"),
  signature: z.object({ element: z.string().min(3), description: z.string().min(10) }).describe("L'élément signature qui rend ce site reconnaissable"),
  surMesure: z
    .object({
      element: z.string().min(3).max(80).describe("Nom court de l'élément sur mesure (« Frise de la panne à la remise en service »)"),
      composant: z.string().regex(/^[A-Z][A-Za-z0-9]{2,40}$/).describe("Nom du composant Astro en PascalCase (« FriseDepannage »)"),
      description: z.string().min(80).describe("Ce que l'élément montre, sa composition, son comportement à 375, 768 et 1440 px, ses jetons : assez précis pour être codé sans deviner"),
      textes: z.string().min(20).describe("Ce que le Rédacteur doit écrire pour cet élément (titre, intro, éléments : nombre et nature)"),
      pourquoi: z.string().min(20).describe("Pourquoi cet élément appartient à CETTE entreprise et à aucune autre"),
    })
    .describe("L'élément sur mesure du site, placé dans sections (type « surmesure », variante « composant »)"),
});
export type Design = z.infer<typeof DesignSchema>;

const t = (max: number) => z.string().min(1).max(max);

export const ContenuSectionSchema = z.object({
  type: z.enum(TYPES_SECTION),
  surtitre: t(48).optional(),
  titre: t(110).optional(),
  titreAccent: t(60).optional(),
  sousTitre: t(220).optional(),
  intro: t(320).optional(),
  texte: t(260).optional(),
  motSignature: t(16).optional(),
  boutonAppel: t(24).optional(),
  boutonDevis: t(28).optional(),
  afficherNote: z.boolean().optional(),
  reperes: z.array(t(48)).max(3).optional(),
  items: z.array(z.object({ titre: t(60), texte: t(280), icone: z.string().regex(/^[a-z0-9-]+$/).optional(), points: z.array(t(80)).max(4).optional() })).optional(),
  elements: z
    .array(z.object({ titre: t(60), texte: t(260).optional(), detail: t(80).optional() }))
    .max(10)
    .optional()
    .describe("Élément sur mesure : ses éléments, comme le demande design.surMesure.textes"),
  legendes: z.array(t(90)).optional().describe("Réalisations : une légende par image, dans l'ordre"),
  besoins: z.array(t(48)).max(10).optional(),
  boutonEnvoyer: t(28).optional(),
});

export const ContenuSchema = z.object({
  sections: z.array(ContenuSectionSchema).min(4).max(10),
  seo: z.object({ titre: t(60).optional(), description: z.string().min(70).max(170) }),
  piedPhrase: t(200).optional(),
  zonePrecision: t(120).optional(),
  horairesNote: t(120).optional(),
  enteteBoutonDevis: t(24).optional(),
  laisseDeCote: z.array(z.string()).describe("Ce que tu as volontairement laissé de côté faute de source (peut être vide)"),
});
export type Contenu = z.infer<typeof ContenuSchema>;

export const FaitsSchema = z.object({
  items: z.array(
    z.object({
      phrase: z.string(),
      section: z.string(),
      statut: z.enum(["conforme", "reformulation", "absente", "contradictoire", "prestation_douteuse"]),
      source: z.string().optional(),
      correction: z.string().optional().describe("Obligatoire si le statut n'est pas conforme/reformulation : consigne exacte de correction"),
    }),
  ),
  verdict: z.enum(["pass", "fail"]),
});
export type Faits = z.infer<typeof FaitsSchema>;

const note = z.number().int().min(1).max(5);
export const VisuelSchema = z.object({
  description: z.string().describe("Ce que tu vois, capture par capture, avant de juger"),
  blocking: z.array(z.object({ capture: z.string(), probleme: z.string(), consigne: z.string() })),
  scores: z.object({ hierarchie: note, espacement: note, typographie: note, couleur_images: note, finition: note, mobile: note }),
  justifications: z.object({ hierarchie: z.string(), espacement: z.string(), typographie: z.string(), couleur_images: z.string(), finition: z.string(), mobile: z.string() }),
  corrections: z.array(z.object({ section: z.string(), probleme: z.string(), consigne: z.string() })),
  verdict: z.enum(["pass", "fail"]),
});
export type Visuel = z.infer<typeof VisuelSchema>;

export const UxSchema = z.object({
  parcours: z.object({ urgent: z.string(), comparateur: z.string(), sceptique: z.string() }).describe("Déroulé de chaque parcours, en quelques phrases"),
  problemes: z.array(z.object({ gravite: z.enum(["bloquant", "majeur", "mineur"]), parcours: z.string(), constat: z.string(), consigne: z.string() })),
  verdict: z.enum(["pass", "fail"]),
});
export type Ux = z.infer<typeof UxSchema>;
