import { randomUUID } from "node:crypto";
import { z } from "zod";
import { now, parseJson, type Db } from "../db/database.ts";
import { HubError, notFound } from "./errors.ts";
import type { EventLog } from "./events.ts";

export const STATUTS = ["prospect", "qualifie", "maquette", "contacte", "client", "perdu", "exclu"] as const;
export type Statut = (typeof STATUTS)[number];
export const STATUT_LABELS: Record<Statut, string> = {
  prospect: "Prospect",
  qualifie: "Qualifié",
  maquette: "Maquette",
  contacte: "Contacté",
  client: "Client",
  perdu: "Perdu",
  exclu: "Exclu",
};

/** D'où vient une donnée : saisie à la main, API Sirene, Google Places, audit du site existant. */
export const SOURCES = ["saisie", "sirene", "places", "audit"] as const;
export type Source = (typeof SOURCES)[number];

/** Champs dont on garde la provenance (contrôle des faits, VISION §4). */
export const SOURCED_FIELDS = [
  "raisonSociale",
  "nomCommercial",
  "siren",
  "naf",
  "metier",
  "dateCreation",
  "dirigeant",
  "telephone",
  "email",
  "siteActuel",
  "adresse",
  "horaires",
  "google",
  "zone",
] as const;
export type SourcedField = (typeof SOURCED_FIELDS)[number];

export const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

const text = (max: number) => z.string().trim().max(max).transform((s) => (s === "" ? null : s)).nullable();

export const CompanyInput = z.object({
  raisonSociale: z.string({ error: "La raison sociale est obligatoire" }).trim().min(1, "La raison sociale est obligatoire").max(200),
  nomCommercial: text(200).optional(),
  siren: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ""))
    .refine((s) => s === "" || /^\d{9}$/.test(s), "Le SIREN compte 9 chiffres")
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional(),
  naf: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => s === "" || /^\d{2}\.?\d{2}[A-Z]$/.test(s), "Code NAF attendu sous la forme 43.22A")
    .transform((s) => (s === "" ? null : s.length === 5 ? `${s.slice(0, 2)}.${s.slice(2)}` : s))
    .nullable()
    .optional(),
  metier: text(120).optional(),
  dateCreation: z
    .string()
    .trim()
    .refine((s) => s === "" || /^\d{4}-\d{2}-\d{2}$/.test(s), "Date attendue au format AAAA-MM-JJ")
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .optional(),
  dirigeant: text(200).optional(),
  telephone: text(40).optional(),
  email: z
    .string()
    .trim()
    .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "Adresse email invalide")
    .transform((s) => (s === "" ? null : s.toLowerCase()))
    .nullable()
    .optional(),
  siteActuel: text(500).optional(),
  adresse: z
    .object({ ligne: text(300).optional(), codePostal: text(10).optional(), commune: text(120).optional() })
    .nullable()
    .optional(),
  horaires: z.partialRecord(z.enum(JOURS), z.string().trim().max(120)).nullable().optional(),
  google: z
    .object({
      valeur: z.number().min(0).max(5).nullable(),
      nombre: z.number().int().min(0).nullable(),
      url: text(1000).optional(),
    })
    .nullable()
    .optional(),
  zone: z.object({ commune: text(120).optional(), voisines: z.array(z.string().trim().min(1).max(120)).max(60).default([]) }).nullable().optional(),
  statut: z.enum(STATUTS).optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  notes: z.string().max(20_000).nullable().optional(),
  sources: z.partialRecord(z.enum(SOURCED_FIELDS), z.enum(SOURCES)).optional(),
});
export type CompanyInput = z.input<typeof CompanyInput>;
export const CompanyPatch = CompanyInput.partial();

export type Company = {
  id: string;
  raisonSociale: string;
  nomCommercial: string | null;
  siren: string | null;
  naf: string | null;
  metier: string | null;
  dateCreation: string | null;
  dirigeant: string | null;
  telephone: string | null;
  email: string | null;
  siteActuel: string | null;
  adresse: { ligne: string | null; codePostal: string | null; commune: string | null };
  horaires: Partial<Record<(typeof JOURS)[number], string>>;
  google: { valeur: number | null; nombre: number | null; url: string | null } | null;
  zone: { commune: string | null; voisines: string[] };
  statut: Statut;
  score: number | null;
  notes: string | null;
  sources: Partial<Record<SourcedField, Source>>;
  createdAt: string;
  updatedAt: string;
};

function fromRow(r: Record<string, unknown>): Company {
  const s = (k: string) => (r[k] as string | null) ?? null;
  return {
    id: String(r.id),
    raisonSociale: String(r.raison_sociale),
    nomCommercial: s("nom_commercial"),
    siren: s("siren"),
    naf: s("naf"),
    metier: s("metier"),
    dateCreation: s("date_creation"),
    dirigeant: s("dirigeant"),
    telephone: s("telephone"),
    email: s("email"),
    siteActuel: s("site_actuel"),
    adresse: { ligne: s("adresse_ligne"), codePostal: s("code_postal"), commune: s("commune") },
    horaires: parseJson(r.horaires_json, {}),
    google: parseJson(r.google_json, null),
    zone: parseJson(r.zone_json, { commune: null, voisines: [] }),
    statut: r.statut as Statut,
    score: (r.score as number | null) ?? null,
    notes: s("notes"),
    sources: parseJson(r.sources_json, {}),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Une valeur « renseignée » : sert à attribuer la source par défaut (saisie) aux seuls champs remplis. */
function isFilled(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.values(v as object).some(isFilled);
  return true;
}

export type CompanyFilter = { q?: string; statut?: Statut; metier?: string; commune?: string };

export class CompanyService {
  readonly #db: Db;
  readonly #events: EventLog;
  constructor(db: Db, events: EventLog) {
    this.#db = db;
    this.#events = events;
  }

  list(filter: CompanyFilter = {}): Company[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.statut) {
      where.push("statut = ?");
      params.push(filter.statut);
    }
    if (filter.metier) {
      where.push("metier = ?");
      params.push(filter.metier);
    }
    if (filter.commune) {
      where.push("commune = ?");
      params.push(filter.commune);
    }
    if (filter.q?.trim()) {
      where.push("(raison_sociale LIKE ? OR nom_commercial LIKE ? OR siren LIKE ? OR commune LIKE ? OR metier LIKE ? OR telephone LIKE ?)");
      const like = `%${filter.q.trim().replace(/[%_]/g, "")}%`;
      params.push(like, like, like, like, like, like);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM companies ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC`)
      .all(...params) as Record<string, unknown>[];
    return rows.map(fromRow);
  }

  get(id: string): Company {
    const row = this.#db.prepare("SELECT * FROM companies WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Entreprise");
    return fromRow(row);
  }

  create(raw: unknown): Company {
    const input = CompanyInput.parse(raw);
    const id = randomUUID().slice(0, 8);
    const at = now();
    // Source par défaut : « saisie » pour chaque champ renseigné, sauf indication contraire.
    const sources: Partial<Record<SourcedField, Source>> = {};
    for (const f of SOURCED_FIELDS) if (isFilled(input[f])) sources[f] = input.sources?.[f] ?? "saisie";
    this.#checkSiren(input.siren ?? null, null);
    this.#db
      .prepare(
        `INSERT INTO companies (id, raison_sociale, nom_commercial, siren, naf, metier, date_creation, dirigeant, telephone, email,
          site_actuel, adresse_ligne, code_postal, commune, horaires_json, google_json, zone_json, statut, score, notes, sources_json,
          created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.raisonSociale,
        input.nomCommercial ?? null,
        input.siren ?? null,
        input.naf ?? null,
        input.metier ?? null,
        input.dateCreation ?? null,
        input.dirigeant ?? null,
        input.telephone ?? null,
        input.email ?? null,
        input.siteActuel ?? null,
        input.adresse?.ligne ?? null,
        input.adresse?.codePostal ?? null,
        input.adresse?.commune ?? null,
        JSON.stringify(input.horaires ?? {}),
        input.google ? JSON.stringify({ url: null, ...input.google }) : null,
        JSON.stringify({ commune: input.zone?.commune ?? null, voisines: input.zone?.voisines ?? [] }),
        input.statut ?? "prospect",
        input.score ?? null,
        input.notes ?? null,
        JSON.stringify(sources),
        at,
        at,
      );
    const company = this.get(id);
    this.#events.append({ type: "company.created", subject: `company:${id}`, message: `Fiche créée : ${company.raisonSociale}` });
    return company;
  }

  update(id: string, raw: unknown): Company {
    const before = this.get(id);
    const patch = CompanyPatch.parse(raw);
    const sources = { ...before.sources };
    for (const f of SOURCED_FIELDS) {
      if (!(f in patch)) continue;
      // Une donnée modifiée sans source précisée devient une saisie ; une donnée vidée perd sa source.
      if (isFilled(patch[f])) sources[f] = patch.sources?.[f] ?? "saisie";
      else delete sources[f];
    }
    // Source corrigée seule, sans toucher à la donnée : seulement si la donnée existe.
    for (const [f, src] of Object.entries(patch.sources ?? {}) as [SourcedField, Source][]) if (!(f in patch) && sources[f]) sources[f] = src;
    if ("siren" in patch) this.#checkSiren(patch.siren ?? null, id);

    const merged = {
      raison_sociale: patch.raisonSociale ?? before.raisonSociale,
      nom_commercial: "nomCommercial" in patch ? (patch.nomCommercial ?? null) : before.nomCommercial,
      siren: "siren" in patch ? (patch.siren ?? null) : before.siren,
      naf: "naf" in patch ? (patch.naf ?? null) : before.naf,
      metier: "metier" in patch ? (patch.metier ?? null) : before.metier,
      date_creation: "dateCreation" in patch ? (patch.dateCreation ?? null) : before.dateCreation,
      dirigeant: "dirigeant" in patch ? (patch.dirigeant ?? null) : before.dirigeant,
      telephone: "telephone" in patch ? (patch.telephone ?? null) : before.telephone,
      email: "email" in patch ? (patch.email ?? null) : before.email,
      site_actuel: "siteActuel" in patch ? (patch.siteActuel ?? null) : before.siteActuel,
      adresse_ligne: "adresse" in patch ? (patch.adresse?.ligne ?? null) : before.adresse.ligne,
      code_postal: "adresse" in patch ? (patch.adresse?.codePostal ?? null) : before.adresse.codePostal,
      commune: "adresse" in patch ? (patch.adresse?.commune ?? null) : before.adresse.commune,
      horaires_json: JSON.stringify("horaires" in patch ? (patch.horaires ?? {}) : before.horaires),
      google_json: "google" in patch ? (patch.google ? JSON.stringify({ url: null, ...patch.google }) : null) : before.google ? JSON.stringify(before.google) : null,
      zone_json: JSON.stringify("zone" in patch ? { commune: patch.zone?.commune ?? null, voisines: patch.zone?.voisines ?? [] } : before.zone),
      statut: patch.statut ?? before.statut,
      score: "score" in patch ? (patch.score ?? null) : before.score,
      notes: "notes" in patch ? (patch.notes ?? null) : before.notes,
      sources_json: JSON.stringify(sources),
      updated_at: now(),
    };
    const cols = Object.keys(merged);
    this.#db.prepare(`UPDATE companies SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(merged), id);
    const after = this.get(id);
    if (after.statut !== before.statut) {
      this.#events.append({
        type: "company.status",
        subject: `company:${id}`,
        message: `${after.raisonSociale} : ${STATUT_LABELS[before.statut]} → ${STATUT_LABELS[after.statut]}`,
        data: { from: before.statut, to: after.statut },
      });
    } else {
      this.#events.append({ type: "company.updated", subject: `company:${id}`, message: `Fiche mise à jour : ${after.raisonSociale}` });
    }
    return after;
  }

  delete(id: string): void {
    const c = this.get(id);
    this.#db.prepare("DELETE FROM companies WHERE id = ?").run(id);
    this.#events.append({ type: "company.deleted", subject: `company:${id}`, message: `Fiche supprimée : ${c.raisonSociale}` });
  }

  #checkSiren(siren: string | null, selfId: string | null): void {
    if (!siren) return;
    const other = this.#db.prepare("SELECT id, raison_sociale FROM companies WHERE siren = ? AND id IS NOT ?").get(siren, selfId) as
      | { id: string; raison_sociale: string }
      | undefined;
    if (other) throw new HubError(`Ce SIREN est déjà celui de « ${other.raison_sociale} »`, 409);
  }
}
