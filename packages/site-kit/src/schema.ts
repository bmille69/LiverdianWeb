/**
 * Schéma du fichier `src/data/site.json` d'un site client.
 * C'est le contrat entre le hub, les agents (DA, Rédacteur, Intégrateur) et le kit.
 * Tout ce qui est propre au client vit ici ; les composants ne contiennent aucune donnée.
 *
 * Ce fichier est importé à la fois par Astro (build) et par les scripts Node (TypeScript natif) :
 * pas d'enum, pas de syntaxe TypeScript non effaçable.
 */
import { z } from "zod";

z.config(z.locales.fr());

// ─── Briques communes ────────────────────────────────────────────────────────

const texte = z.string().trim().min(1, "texte vide");
const texteCourt = (max: number) => texte.max(max, `trop long (${max} caractères max)`);
const url = z.url({ message: "URL invalide (doit commencer par https://)" });
const dateIso = z.iso.date({ message: "date attendue au format AAAA-MM-JJ" });

/** Clé d'une image déclarée dans `images` (ex. "hero", "chantier-1"). */
const cleImage = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "clé d'image : minuscules, chiffres et tirets");

export const METIERS = [
  "electricien",
  "plombier",
  "chauffagiste",
  "couvreur",
  "menuisier",
  "peintre",
  "macon",
  "paysagiste",
  "autre",
] as const;
export const metier = z.enum(METIERS);

export const JOURS = ["lu", "ma", "me", "je", "ve", "sa", "di"] as const;
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "heure attendue au format HH:MM");

const commune = z.object({
  nom: texteCourt(60),
  /** Coordonnées (WGS84) : nécessaires pour la variante « carte » de la zone. */
  lat: z.number().min(41).max(51.5).optional(),
  lon: z.number().min(-5.5).max(10).optional(),
});

// ─── Entreprise ──────────────────────────────────────────────────────────────

export const entrepriseSchema = z.object({
  raisonSociale: texteCourt(120),
  /** Nom affiché partout (enseigne). Par défaut : la raison sociale. */
  nomCommercial: texteCourt(60).optional(),
  metier,
  /** Libellé du métier tel qu'il apparaît dans les titres (« Électricien », « Couvreur-zingueur »). */
  metierLibelle: texteCourt(40),
  naf: z.string().regex(/^\d{2}\.\d{2}[A-Z]$/, "code NAF attendu au format 43.21A"),
  siren: z.string().regex(/^\d{3} ?\d{3} ?\d{3}$/, "SIREN : 9 chiffres"),
  siret: z.string().regex(/^\d{3} ?\d{3} ?\d{3} ?\d{5}$/, "SIRET : 14 chiffres").optional(),
  formeJuridique: texteCourt(80).optional(),
  capital: texteCourt(40).optional(),
  rcs: texteCourt(80).optional(),
  rm: texteCourt(80).optional(),
  tva: texteCourt(20).optional(),
  adresse: z.object({
    rue: texteCourt(120),
    codePostal: z.string().regex(/^\d{5}$/, "code postal : 5 chiffres"),
    commune: texteCourt(60),
  }),
  telephone: z
    .string()
    .refine((v) => /^(?:\+33|0033|0)[1-9](?:[ .-]?\d{2}){4}$/.test(v.trim()), "numéro de téléphone français attendu"),
  email: z.email({ message: "adresse email invalide" }).optional(),
  horaires: z
    .array(
      z.object({
        jours: z.array(z.enum(JOURS)).min(1),
        ouverture: heure,
        fermeture: heure,
      }),
    )
    .optional(),
  /** Précision libre affichée sous les horaires (« Sur rendez-vous le samedi »). */
  horairesNote: texteCourt(120).optional(),
  noteGoogle: z
    .object({
      valeur: z.number().min(1).max(5),
      nombre: z.number().int().min(1),
      url,
    })
    .optional(),
  dateCreation: dateIso.optional(),
  dirigeant: texteCourt(80).optional(),
});

// ─── Zone ────────────────────────────────────────────────────────────────────

export const zoneSchema = z.object({
  commune,
  voisines: z.array(commune).min(1, "au moins une commune voisine").max(16),
  /** Texte court affiché avec la carte (« À 20 minutes autour de Vienne »). Facultatif. */
  precision: texteCourt(120).optional(),
});

// ─── Thème ───────────────────────────────────────────────────────────────────

export const PRESETS = ["electricien", "plombier", "chauffagiste", "couvreur", "menuisier", "peintre"] as const;
export const POLICES = [
  "archivo",
  "barlow-semi-condensed",
  "bricolage-grotesque",
  "dm-serif-display",
  "fraunces",
  "inter",
  "manrope",
  "plus-jakarta-sans",
  "schibsted-grotesk",
  "source-sans-3",
  "space-grotesk",
  "work-sans",
] as const;
export const SIGNATURES = ["faisceau", "onde", "isobares", "tuiles", "veinage", "aplat"] as const;

const couleurHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "couleur attendue au format #RRGGBB");
export const COULEURS = [
  "fond",
  "surface",
  "teinte",
  "encre",
  "encreDouce",
  "trait",
  "sombre",
  "sombreSurface",
  "surSombre",
  "surSombreDoux",
  "accent",
  "surAccent",
  "accentTexte",
  "accentSurSombre",
] as const;
export const couleursSchema = z.object(Object.fromEntries(COULEURS.map((c) => [c, couleurHex])) as {
  [K in (typeof COULEURS)[number]]: typeof couleurHex;
});

export const themeSchema = z.object({
  preset: z.enum(PRESETS),
  /** Surcharges ponctuelles du préréglage (ne jamais livrer deux sites du même métier avec la même teinte). */
  couleurs: couleursSchema.partial().optional(),
  polices: z.object({ titres: z.enum(POLICES).optional(), corps: z.enum(POLICES).optional() }).optional(),
  /** Rayon des coins en px, appliqué partout (boutons, cartes, images). */
  rayon: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.literal(8), z.literal(12), z.literal(16)]).optional(),
  signature: z.enum(SIGNATURES).optional(),
});

// ─── Images ──────────────────────────────────────────────────────────────────

export const imageSchema = z.object({
  /** Chemin relatif à la racine du site : `stock/<metier>/<fichier>` (banque) ou `photos/<fichier>` (client). */
  fichier: z.string().regex(/^(stock|photos)\/[A-Za-z0-9._\/-]+\.(jpe?g|png|webp|avif)$/i, "chemin attendu : stock/… ou photos/…"),
  alt: texteCourt(160),
  /** Point focal pour le recadrage (CSS object-position), ex. "50% 30%". */
  focale: z.string().regex(/^\d{1,3}% \d{1,3}%$/).optional(),
  credit: texteCourt(120).optional(),
});

// ─── Sections ────────────────────────────────────────────────────────────────

const enTete = {
  /** Identifiant d'ancre (#services). Par défaut : le type de section. */
  ancre: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  /** Libellé dans le menu ; `false` pour ne pas apparaître dans le menu. */
  menu: z.union([texteCourt(24), z.literal(false)]).optional(),
  surtitre: texteCourt(48).optional(),
};

const icone = z.string().regex(/^[a-z0-9-]+$/, "nom d'icône Lucide (ex. « zap »)");

export const heroSchema = z.object({
  type: z.literal("hero"),
  variante: z.enum(["photo", "typo", "scinde"]),
  contenu: z.object({
    surtitre: texteCourt(60).optional(),
    /** Le H1 unique de la page : métier + commune (4 à 9 mots). */
    titre: texteCourt(90),
    /** Partie du titre mise en valeur (doit figurer telle quelle dans le titre). */
    titreAccent: texteCourt(60).optional(),
    sousTitre: texteCourt(220),
    image: cleImage.optional(),
    /** Mot géant de la variante « typo » (élément signature), ex. « Plomberie ». */
    motSignature: texteCourt(16).optional(),
    boutonAppel: texteCourt(24).optional(),
    boutonDevis: texteCourt(28).optional(),
    /** Affiche la note Google sous les boutons (si la note existe). */
    afficherNote: z.boolean().optional(),
    /** Faits courts vérifiés affichés en ligne sous le hero (« Basé à Vienne », « Contact direct avec l'artisan »). */
    reperes: z.array(texteCourt(48)).max(3).optional(),
  }),
});

export const servicesSchema = z.object({
  type: z.literal("services"),
  variante: z.enum(["cartes", "liste", "bandes"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(90),
    intro: texteCourt(320).optional(),
    items: z
      .array(
        z.object({
          titre: texteCourt(48),
          texte: texteCourt(280),
          icone: icone.optional(),
          image: cleImage.optional(),
          /** Points concrets (variante « bandes » et « liste »). */
          points: z.array(texteCourt(80)).max(4).optional(),
        }),
      )
      .min(2)
      .max(8),
  }),
});

export const pourquoiSchema = z.object({
  type: z.literal("pourquoi"),
  variante: z.enum(["colonnes", "manifeste"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(110),
    intro: texteCourt(320).optional(),
    image: cleImage.optional(),
    items: z.array(z.object({ titre: texteCourt(60), texte: texteCourt(260), icone: icone.optional() })).min(2).max(4),
  }),
});

export const realisationsSchema = z.object({
  type: z.literal("realisations"),
  variante: z.enum(["mosaique", "grille"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(90),
    intro: texteCourt(320).optional(),
    images: z.array(z.object({ image: cleImage, legende: texteCourt(90).optional() })).min(3).max(8),
  }),
});

export const avisSchema = z.object({
  type: z.literal("avis"),
  variante: z.enum(["badge", "bandeau"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(90),
    texte: texteCourt(260).optional(),
  }),
});

export const zoneSectionSchema = z.object({
  type: z.literal("zone"),
  variante: z.enum(["carte", "liste"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(90),
    intro: texteCourt(320).optional(),
  }),
});

export const appelSchema = z.object({
  type: z.literal("appel"),
  variante: z.enum(["bande", "carte"]),
  ...enTete,
  contenu: z.object({
    titre: texteCourt(90),
    texte: texteCourt(220).optional(),
    image: cleImage.optional(),
  }),
});

export const devisSchema = z.object({
  type: z.literal("devis"),
  variante: z.enum(["scinde", "encadre"]),
  ...enTete,
  contenu: z.object({
    surtitre: texteCourt(48).optional(),
    titre: texteCourt(90),
    /** Ce qui se passe après l'envoi, sans délai inventé. */
    intro: texteCourt(320),
    /** Choix proposés dans « Votre besoin ». Par défaut : les titres des services. */
    besoins: z.array(texteCourt(48)).max(10).optional(),
    boutonEnvoyer: texteCourt(28).optional(),
  }),
});

export const sectionSchema = z.discriminatedUnion("type", [
  heroSchema,
  servicesSchema,
  pourquoiSchema,
  realisationsSchema,
  avisSchema,
  zoneSectionSchema,
  appelSchema,
  devisSchema,
]);

// ─── Site ────────────────────────────────────────────────────────────────────

export const siteSchema = z
  .object({
    /** Version du schéma (pour les migrations futures). */
    version: z.literal(1),
    /** Identifiant court du site (minuscules, tirets) : nom de dossier, sous-domaine de démo. */
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "slug : minuscules, chiffres et tirets"),
    entreprise: entrepriseSchema,
    zone: zoneSchema,
    theme: themeSchema,
    images: z.record(cleImage, imageSchema).default({}),
    entete: z
      .object({ variante: z.enum(["simple", "double"]), boutonDevis: texteCourt(24).optional() })
      .default({ variante: "simple" }),
    sections: z.array(sectionSchema).min(2),
    pied: z
      .object({ variante: z.enum(["complet", "sobre"]), phrase: texteCourt(200).optional() })
      .default({ variante: "complet" }),
    seo: z.object({
      /** URL publique (sans / final). Sert au sitemap, au canonical et à l'Open Graph. */
      url: url.optional(),
      /** Titre de la page d'accueil (≤ 60 caractères). Par défaut : « Métier à Commune | Nom ». */
      titre: texteCourt(60).optional(),
      description: texte.min(70, "description trop courte (140 à 160 caractères conseillés)").max(170, "description trop longue (160 caractères max)"),
    }),
    formulaire: z
      .object({
        /** URL qui reçoit le POST du formulaire hors démo. */
        action: url.optional(),
      })
      .default({}),
    demo: z.object({
      actif: z.boolean(),
      agence: texteCourt(60).default("Liverdian"),
      agenceUrl: url.optional(),
      dateSuppression: dateIso.optional(),
    }),
    legal: z
      .object({
        directeurPublication: texteCourt(80).optional(),
        hebergeur: z
          .object({ nom: texteCourt(80), adresse: texteCourt(160), telephone: texteCourt(40).optional(), url: url.optional() })
          .optional(),
        mediateur: texteCourt(200).optional(),
        assurance: texteCourt(200).optional(),
      })
      .default({}),
  })
  .superRefine((site, ctx) => {
    const sections = site.sections;
    const heros = sections.filter((s) => s.type === "hero");
    if (heros.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "il faut exactement une section « hero » (elle porte le H1 unique)" });
    } else if (sections[0]?.type !== "hero") {
      ctx.addIssue({ code: "custom", path: ["sections", 0], message: "la section « hero » doit être la première" });
    }
    if (!sections.some((s) => s.type === "devis")) {
      ctx.addIssue({ code: "custom", path: ["sections"], message: "il manque la section « devis » (formulaire)" });
    }
    const ancres = new Set<string>();
    sections.forEach((s, i) => {
      if (s.type === "hero") return;
      const a = s.ancre ?? s.type;
      if (ancres.has(a)) ctx.addIssue({ code: "custom", path: ["sections", i, "ancre"], message: `ancre « ${a} » en double` });
      ancres.add(a);
    });
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1];
      const b = sections[i];
      if (a && b && a.type === b.type) {
        ctx.addIssue({ code: "custom", path: ["sections", i], message: "deux sections du même type à la suite" });
      }
    }
    // Images référencées → déclarées.
    const verifierImage = (cle: string | undefined, path: (string | number)[]) => {
      if (cle && !site.images[cle]) ctx.addIssue({ code: "custom", path, message: `image « ${cle} » absente de « images »` });
    };
    sections.forEach((s, i) => {
      const p = ["sections", i, "contenu"];
      if (s.type === "hero") {
        verifierImage(s.contenu.image, [...p, "image"]);
        if ((s.variante === "photo" || s.variante === "scinde") && !s.contenu.image) {
          ctx.addIssue({ code: "custom", path: [...p, "image"], message: `le hero « ${s.variante} » demande une image` });
        }
        if (s.contenu.titreAccent && !s.contenu.titre.includes(s.contenu.titreAccent)) {
          ctx.addIssue({ code: "custom", path: [...p, "titreAccent"], message: "« titreAccent » doit être un extrait exact du titre" });
        }
        if (s.contenu.afficherNote && !site.entreprise.noteGoogle) {
          ctx.addIssue({ code: "custom", path: [...p, "afficherNote"], message: "afficherNote sans entreprise.noteGoogle" });
        }
      }
      if (s.type === "services") {
        s.contenu.items.forEach((it, j) => verifierImage(it.image, [...p, "items", j, "image"]));
        if (s.variante === "bandes" && s.contenu.items.some((it) => !it.image)) {
          ctx.addIssue({ code: "custom", path: [...p, "items"], message: "la variante « bandes » demande une image par service" });
        }
        if (s.variante === "bandes" && s.contenu.items.length > 4) {
          ctx.addIssue({ code: "custom", path: [...p, "items"], message: "la variante « bandes » accepte 4 services au plus" });
        }
      }
      if (s.type === "pourquoi") verifierImage(s.contenu.image, [...p, "image"]);
      if (s.type === "appel") verifierImage(s.contenu.image, [...p, "image"]);
      if (s.type === "realisations") s.contenu.images.forEach((im, j) => verifierImage(im.image, [...p, "images", j, "image"]));
      if (s.type === "avis" && !site.entreprise.noteGoogle) {
        ctx.addIssue({ code: "custom", path: ["sections", i], message: "section « avis » sans entreprise.noteGoogle : la supprimer" });
      }
      if (s.type === "zone" && s.variante === "carte") {
        const toutes = [site.zone.commune, ...site.zone.voisines];
        if (toutes.some((c) => c.lat === undefined || c.lon === undefined)) {
          ctx.addIssue({ code: "custom", path: ["zone"], message: "la variante « carte » demande lat/lon pour chaque commune" });
        }
      }
    });
    if (site.demo.actif && !site.demo.dateSuppression) {
      ctx.addIssue({ code: "custom", path: ["demo", "dateSuppression"], message: "une démo doit avoir une date de suppression" });
    }
  });

export type SiteInput = z.input<typeof siteSchema>;
export type Site = z.output<typeof siteSchema>;
export type Entreprise = Site["entreprise"];
export type Zone = Site["zone"];
export type Commune = Zone["commune"];
export type Theme = Site["theme"];
export type Couleurs = z.output<typeof couleursSchema>;
export type ImageDecl = z.output<typeof imageSchema>;
export type Section = Site["sections"][number];
export type SectionDe<T extends Section["type"]> = Extract<Section, { type: T }>;
export type Metier = (typeof METIERS)[number];
export type Preset = (typeof PRESETS)[number];
export type Police = (typeof POLICES)[number];
export type Signature = (typeof SIGNATURES)[number];

/** Résultat de validation : soit le site, soit une liste d'erreurs lisibles en français. */
export function validerSite(donnees: unknown): { ok: true; site: Site } | { ok: false; erreurs: string[] } {
  const r = siteSchema.safeParse(donnees);
  if (r.success) return { ok: true, site: r.data };
  const erreurs = r.error.issues.map((i) => {
    const chemin = i.path.length ? i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "") : "(racine)";
    return `${chemin} : ${i.message}`;
  });
  return { ok: false, erreurs };
}
