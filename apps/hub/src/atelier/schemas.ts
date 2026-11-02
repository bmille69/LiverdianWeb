import { z } from "zod";

/**
 * Schémas de sortie des agents de la recette « vitrine artisan ». Demandés au CLI (--json-schema) puis revérifiés.
 * Ils fixent la forme ; le contrat final (longueurs, variantes, règles croisées) reste celui du kit
 * (`packages/site-kit/src/schema.ts`), appliqué à l'assemblage : une erreur y renvoie à l'agent fautif.
 */
export const PRESETS = ["electricien", "plombier", "chauffagiste", "couvreur", "menuisier", "peintre"] as const;
export const POLICES = ["archivo", "barlow-semi-condensed", "bricolage-grotesque", "dm-serif-display", "fraunces", "inter", "manrope", "plus-jakarta-sans", "schibsted-grotesk", "source-sans-3", "space-grotesk", "work-sans"] as const;
export const SIGNATURES = ["faisceau", "onde", "isobares", "tuiles", "veinage", "aplat"] as const;
export const TYPES_SECTION = ["hero", "services", "pourquoi", "realisations", "avis", "zone", "appel", "devis"] as const;
export const COULEURS = ["fond", "surface", "teinte", "encre", "encreDouce", "trait", "sombre", "sombreSurface", "surSombre", "surSombreDoux", "accent", "surAccent", "accentTexte", "accentSurSombre"] as const;

export const VARIANTES: Record<(typeof TYPES_SECTION)[number], string[]> = {
  hero: ["photo", "typo", "scinde"],
  services: ["cartes", "liste", "bandes"],
  pourquoi: ["colonnes", "manifeste"],
  realisations: ["mosaique", "grille"],
  avis: ["badge", "bandeau"],
  zone: ["carte", "liste"],
  appel: ["bande", "carte"],
  devis: ["scinde", "encadre"],
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "couleur #RRGGBB");
const cle = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "clé : minuscules, chiffres, tirets");

export const DesignSchema = z.object({
  intention: z.array(z.string().min(20)).length(3).describe("L'intention du site en exactement 3 phrases : pour qui, quelle impression, comment il se distingue"),
  theme: z.object({
    preset: z.enum(PRESETS),
    couleurs: z
      .object(Object.fromEntries(COULEURS.map((k) => [k, hex.optional()])) as Record<(typeof COULEURS)[number], z.ZodOptional<typeof hex>>)
      .describe("Surcharges de jetons du préréglage (au moins accent ou sombre, pour ne pas reproduire un autre site)"),
    polices: z.object({ titres: z.enum(POLICES).optional(), corps: z.enum(POLICES).optional() }).optional(),
    rayon: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(12), z.literal(16)]).optional(),
    signature: z.enum(SIGNATURES).optional(),
  }),
  ajustements: z.string().min(20).describe("Ce qui distingue ce thème des sites du même métier listés dans le brief, et pourquoi ces teintes"),
  entete: z.object({ variante: z.enum(["simple", "double"]) }),
  pied: z.object({ variante: z.enum(["complet", "sobre"]) }),
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
        nombreItems: z.number().int().min(2).max(8).optional().describe("Services / pourquoi : nombre d'éléments attendus du Rédacteur"),
        justification: z.string().min(10),
      }),
    )
    .min(4)
    .max(9),
  zoneVoisines: z.array(z.string()).optional().describe("Seulement si le brief n'a pas de voisines saisies : 4 à 8 noms exacts pris dans zone.candidates"),
  signature: z.object({ element: z.string().min(3), description: z.string().min(10) }).describe("L'élément signature qui rend ce site reconnaissable"),
  surMesure: z
    .object({ demande: z.boolean(), consigne: z.string() })
    .describe("demande=true seulement si un ajustement hors du kit est indispensable ; la consigne dit alors exactement quoi faire à l'Intégrateur"),
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
  legendes: z.array(t(90)).optional().describe("Réalisations : une légende par image, dans l'ordre"),
  besoins: z.array(t(48)).max(10).optional(),
  boutonEnvoyer: t(28).optional(),
});

export const ContenuSchema = z.object({
  sections: z.array(ContenuSectionSchema).min(4).max(9),
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
