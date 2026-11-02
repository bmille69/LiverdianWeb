import { z } from "zod";
import { METIERS } from "./metiers.ts";

/** Critères d'une campagne : enregistrés tels quels, relus à chaque lancement. */
export const SITE_CRITERES = ["peu_importe", "aucun", "aucun_ou_defaillant", "defaillant"] as const;
export const SITE_CRITERE_LABELS: Record<(typeof SITE_CRITERES)[number], string> = {
  peu_importe: "Peu importe",
  aucun: "Sans site",
  aucun_ou_defaillant: "Sans site ou site défaillant",
  defaillant: "Site défaillant (daté, sans HTTPS, non mobile)",
};

const Zone = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rayon"),
    commune: z.string().trim().min(2, "Indiquez une commune").max(120),
    rayonKm: z.number().min(1, "Rayon d'au moins 1 km").max(50, "L'API ne cherche pas au-delà de 50 km"),
  }),
  z.object({
    type: z.literal("departements"),
    departements: z.array(z.string().trim().regex(/^(\d{2}|2A|2B|97[1-6])$/, "Département attendu sous la forme 69")).min(1, "Au moins un département").max(5, "5 départements au plus"),
  }),
  z.object({
    type: z.literal("communes"),
    communes: z.array(z.string().trim().min(2).max(120)).min(1, "Au moins une commune").max(30, "30 communes au plus"),
  }),
]);

export const Criteres = z
  .object({
    metiers: z.array(z.enum(METIERS.map((m) => m.id) as [string, ...string[]])).max(20).default([]),
    nafLibres: z
      .array(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^\d{2}\.?\d{2}[A-Z]$/, "Code NAF attendu sous la forme 43.22A")
          .transform((s) => (s.length === 5 ? `${s.slice(0, 2)}.${s.slice(2)}` : s)),
      )
      .max(10)
      .default([]),
    zone: Zone,
    site: z.enum(SITE_CRITERES).default("peu_importe"),
    ancienneteMinAns: z.number().min(0).max(100).nullable().default(null),
    avisMin: z.number().int().min(0).max(100000).nullable().default(null),
    noteMin: z.number().min(0).max(5).nullable().default(null),
    /** Artisans et petites entreprises : 19 salariés au plus, ni grande entreprise ni ETI, 3 établissements ouverts au plus. */
    artisansSeulement: z.boolean().default(true),
    siegeSeulement: z.boolean().default(true),
    exclusions: z
      .object({ franchises: z.boolean().default(true), dejaContactes: z.boolean().default(true), clients: z.boolean().default(true) })
      .default({ franchises: true, dejaContactes: true, clients: true }),
    limite: z.number().int().min(1).max(2000, "2 000 entreprises au plus par campagne").default(300),
    places: z.boolean().default(true),
    osm: z.boolean().default(true),
    audit: z.boolean().default(true),
    lighthouse: z.boolean().default(true),
  })
  .refine((c) => c.metiers.length + c.nafLibres.length > 0, { message: "Choisissez au moins un métier", path: ["metiers"] });
export type Criteres = z.infer<typeof Criteres>;

export const CampagneInput = z.object({
  nom: z.string({ error: "Donnez un nom à la campagne" }).trim().min(2, "Donnez un nom à la campagne").max(120),
  criteres: Criteres,
});
