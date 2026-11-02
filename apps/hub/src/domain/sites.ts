import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { now, type Db } from "../db/database.ts";
import type { CompanyService } from "./companies.ts";
import { notFound } from "./errors.ts";
import type { EventLog } from "./events.ts";

export const SITE_STATUTS = ["brouillon", "en_fabrication", "a_valider", "a_revoir", "demo_prete", "demo_en_ligne", "livre", "archive"] as const;
export type SiteStatut = (typeof SITE_STATUTS)[number];
export const SITE_STATUT_LABELS: Record<SiteStatut, string> = {
  brouillon: "Brouillon",
  en_fabrication: "En fabrication",
  a_valider: "À valider",
  a_revoir: "À revoir",
  demo_prete: "Démo prête",
  demo_en_ligne: "Démo en ligne",
  livre: "Livré",
  archive: "Archivé",
};

/** Recettes connues (VISION §2.2) : un type de site = une recette. Seules celles de `atelier/recettes` ont une chaîne de fabrication. */
export const RECETTES = [
  { id: "vitrine-artisan", nom: "Vitrine artisan 1 page" },
  { id: "vitrine-pro", nom: "Vitrine Pro 5 pages" },
] as const;

export const SiteInput = z.object({
  companyId: z.string().min(1, "Entreprise manquante"),
  recette: z.enum(RECETTES.map((r) => r.id) as [string, ...string[]], { error: "Recette inconnue" }).default("vitrine-artisan"),
});
const url = z.string().trim().max(500).transform((s) => (s === "" ? null : s)).nullable();
export const SitePatch = z.object({
  statut: z.enum(SITE_STATUTS).optional(),
  qualiteNote: z.number().min(0).max(100).nullable().optional(),
  urlDemo: url.optional(),
  urlProd: url.optional(),
});

export type Site = {
  id: string;
  companyId: string;
  companyName: string;
  recette: string;
  statut: SiteStatut;
  dossier: string;
  qualiteNote: number | null;
  urlDemo: string | null;
  urlProd: string | null;
  createdAt: string;
  updatedAt: string;
};

function fromRow(r: Record<string, unknown>): Site {
  return {
    id: String(r.id),
    companyId: String(r.company_id),
    companyName: String(r.company_name ?? ""),
    recette: String(r.recette),
    statut: r.statut as SiteStatut,
    dossier: String(r.dossier),
    qualiteNote: (r.qualite_note as number | null) ?? null,
    urlDemo: (r.url_demo as string | null) ?? null,
    urlProd: (r.url_prod as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const SELECT = "SELECT s.*, COALESCE(c.nom_commercial, c.raison_sociale) AS company_name FROM sites s JOIN companies c ON c.id = s.company_id";

export class SiteService {
  readonly #db: Db;
  readonly #events: EventLog;
  readonly #companies: CompanyService;
  readonly #sitesDir: string;
  constructor(db: Db, events: EventLog, companies: CompanyService, sitesDir: string) {
    this.#db = db;
    this.#events = events;
    this.#companies = companies;
    this.#sitesDir = sitesDir;
  }

  /** Dossier d'un site sur disque : toujours sous `.data/sites/<id>`, jamais ailleurs. */
  dirOf(id: string): string {
    return join(this.#sitesDir, id);
  }

  list(filter: { companyId?: string; statut?: SiteStatut } = {}): Site[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.companyId) {
      where.push("s.company_id = ?");
      params.push(filter.companyId);
    }
    if (filter.statut) {
      where.push("s.statut = ?");
      params.push(filter.statut);
    }
    return (this.#db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.updated_at DESC`).all(...params) as Record<string, unknown>[]).map(fromRow);
  }

  get(id: string): Site {
    const row = this.#db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Site");
    return fromRow(row);
  }

  create(raw: unknown): Site {
    const input = SiteInput.parse(raw);
    const company = this.#companies.get(input.companyId);
    const id = randomUUID().slice(0, 8);
    const dossier = this.dirOf(id);
    mkdirSync(dossier, { recursive: true });
    const at = now();
    this.#db
      .prepare("INSERT INTO sites (id, company_id, recette, statut, dossier, created_at, updated_at) VALUES (?, ?, ?, 'brouillon', ?, ?, ?)")
      .run(id, company.id, input.recette, dossier, at, at);
    this.#events.append({ type: "site.created", subject: `site:${id}`, message: `Site créé pour ${company.nomCommercial ?? company.raisonSociale}`, data: { companyId: company.id } });
    return this.get(id);
  }

  update(id: string, raw: unknown): Site {
    const before = this.get(id);
    const patch = SitePatch.parse(raw);
    this.#db
      .prepare("UPDATE sites SET statut = ?, qualite_note = ?, url_demo = ?, url_prod = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.statut ?? before.statut,
        "qualiteNote" in patch ? (patch.qualiteNote ?? null) : before.qualiteNote,
        "urlDemo" in patch ? (patch.urlDemo ?? null) : before.urlDemo,
        "urlProd" in patch ? (patch.urlProd ?? null) : before.urlProd,
        now(),
        id,
      );
    const after = this.get(id);
    if (after.statut !== before.statut) {
      this.#events.append({
        type: "site.status",
        subject: `site:${id}`,
        message: `Site de ${after.companyName} : ${SITE_STATUT_LABELS[before.statut]} → ${SITE_STATUT_LABELS[after.statut]}`,
      });
    }
    return after;
  }
}
