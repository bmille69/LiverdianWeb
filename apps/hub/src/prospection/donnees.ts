import { createHash } from "node:crypto";
import { now, parseJson, transaction, type Db } from "../db/database.ts";
import type { Company, CompanyService, Source, SourcedField } from "../domain/companies.ts";
import { HubError } from "../domain/errors.ts";
import type { EventLog } from "../domain/events.ts";
import type { Appariement } from "./appariement.ts";
import type { AuditSite } from "./audit.ts";
import type { Score, StatutSite } from "./scoring.ts";
import type { FichePlaces } from "./sources/places.ts";
import type { LieuOsm } from "./sources/osm.ts";
import type { EtablissementSirene } from "./sources/recherche-entreprises.ts";
import { formaterTelephone, normaliserTelephone } from "./texte.ts";

/**
 * Données de la prospection : fusion dans la fiche entreprise unique (sans jamais écraser une saisie), relevés propres
 * à la prospection (table prospects), liste d'opposition, purge RGPD.
 */

/**
 * Priorité des sources pour un même champ. Une saisie à la main n'est jamais écrasée ; sinon une source de rang égal
 * ou supérieur remplace la précédente (Places > OSM pour le téléphone et le site, l'audit ne remplace que l'email).
 */
const RANG: Record<Source, number> = { saisie: 100, sirene: 3, places: 3, audit: 2, osm: 1 };

export function peutEcrire(c: Pick<Company, "sources"> | null, champ: SourcedField, source: Source, valeurActuelle: unknown): boolean {
  if (!c) return true;
  const actuelle = c.sources[champ];
  const vide = valeurActuelle === null || valeurActuelle === undefined || valeurActuelle === "" || (typeof valeurActuelle === "object" && !Object.values(valeurActuelle as object).some((v) => v !== null && v !== "" && v !== undefined));
  if (vide || !actuelle) return true;
  if (actuelle === "saisie") return false;
  return RANG[source] >= RANG[actuelle];
}

export type ProspectRow = {
  companyId: string;
  siret: string | null;
  lat: number | null;
  lon: number | null;
  sirene: Partial<EtablissementSirene> | null;
  places: { fiche: FichePlaces | null; appariement: Appariement | null; le: string; decision?: "acceptee" | "refusee"; motif?: string } | null;
  osm: { lieu: LieuOsm | null; appariement: Appariement | null; le: string; decision?: "acceptee" | "refusee" } | null;
  audit: AuditSite | null;
  score: Score | null;
  exclusion: { motif: string; le: string } | null;
  siteStatut: StatutSite | null;
  qualifie: boolean;
  sourceLe: string;
  enrichiLe: string | null;
  auditeLe: string | null;
  noteLe: string | null;
};

function fromRow(r: Record<string, unknown>): ProspectRow {
  return {
    companyId: String(r.company_id),
    siret: (r.siret as string | null) ?? null,
    lat: (r.lat as number | null) ?? null,
    lon: (r.lon as number | null) ?? null,
    sirene: parseJson(r.sirene_json, null),
    places: parseJson(r.places_json, null),
    osm: parseJson(r.osm_json, null),
    audit: parseJson(r.audit_json, null),
    score: parseJson(r.score_json, null),
    exclusion: parseJson(r.exclusion_json, null),
    siteStatut: (r.site_statut as StatutSite | null) ?? null,
    qualifie: Number(r.qualifie) === 1,
    sourceLe: String(r.source_le),
    enrichiLe: (r.enrichi_le as string | null) ?? null,
    auditeLe: (r.audite_le as string | null) ?? null,
    noteLe: (r.note_le as string | null) ?? null,
  };
}

export const empreinte = (type: string, valeur: string) => createHash("sha256").update(`${type}:${valeur}`).digest("hex");

function cleOpposition(type: "siren" | "telephone" | "email", valeur: string): string | null {
  const v = type === "siren" ? valeur.replace(/\D/g, "") : type === "telephone" ? normaliserTelephone(valeur) : valeur.trim().toLowerCase();
  if (!v || (type === "siren" && v.length !== 9)) return null;
  return empreinte(type, v);
}

export class ProspectStore {
  readonly #db: Db;
  readonly #companies: CompanyService;
  readonly #events: EventLog;
  readonly #now: () => Date;
  constructor(deps: { db: Db; companies: CompanyService; events: EventLog; now?: () => Date }) {
    this.#db = deps.db;
    this.#companies = deps.companies;
    this.#events = deps.events;
    this.#now = deps.now ?? (() => new Date());
  }

  #iso(): string {
    return this.#now().toISOString();
  }

  get(companyId: string): ProspectRow | null {
    const r = this.#db.prepare("SELECT * FROM prospects WHERE company_id = ?").get(companyId) as Record<string, unknown> | undefined;
    return r ? fromRow(r) : null;
  }

  company(id: string): Company | null {
    try {
      return this.#companies.get(id);
    } catch {
      return null;
    }
  }

  companyParSiren(siren: string): Company | null {
    const r = this.#db.prepare("SELECT id FROM companies WHERE siren = ?").get(siren) as { id: string } | undefined;
    return r ? this.#companies.get(r.id) : null;
  }

  /** Met à jour des colonnes de la ligne prospect (créée si absente). */
  maj(companyId: string, patch: Partial<Record<"siret" | "lat" | "lon" | "sirene" | "places" | "osm" | "audit" | "score" | "exclusion" | "site_statut" | "qualifie" | "enrichi_le" | "audite_le" | "note_le", unknown>>): void {
    const at = this.#iso();
    this.#db.prepare("INSERT INTO prospects (company_id, source_le, updated_at) VALUES (?, ?, ?) ON CONFLICT(company_id) DO NOTHING").run(companyId, at, at);
    const json = new Set(["sirene", "places", "osm", "audit", "score", "exclusion"]);
    const cols: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      cols.push(`${json.has(k) ? `${k}_json` : k} = ?`);
      vals.push(json.has(k) ? (v == null ? null : JSON.stringify(v)) : k === "qualifie" ? (v ? 1 : 0) : ((v as string | number | null) ?? null));
    }
    cols.push("updated_at = ?");
    vals.push(at);
    this.#db.prepare(`UPDATE prospects SET ${cols.join(", ")} WHERE company_id = ?`).run(...vals, companyId);
  }

  /**
   * Fusion d'un établissement Sirene dans la fiche entreprise : création si le SIREN est inconnu, sinon mise à jour
   * des seuls champs que Sirene a le droit d'écrire (jamais une saisie à la main). Rend la fiche et si elle est neuve.
   */
  fusionnerSirene(e: EtablissementSirene, metier: string | null): { company: Company; cree: boolean } {
    const existante = this.companyParSiren(e.siren);
    const champs: { champ: SourcedField; valeur: unknown; cle: string }[] = [
      { champ: "raisonSociale", valeur: e.raisonSociale, cle: "raisonSociale" },
      { champ: "nomCommercial", valeur: e.nomCommercial, cle: "nomCommercial" },
      { champ: "siren", valeur: e.siren, cle: "siren" },
      { champ: "naf", valeur: e.naf || null, cle: "naf" },
      { champ: "metier", valeur: metier, cle: "metier" },
      { champ: "dateCreation", valeur: e.dateCreation, cle: "dateCreation" },
      { champ: "dirigeant", valeur: e.dirigeant, cle: "dirigeant" },
      { champ: "adresse", valeur: { ligne: e.adresse.ligne, codePostal: e.adresse.codePostal, commune: e.adresse.commune }, cle: "adresse" },
    ];
    const patch: Record<string, unknown> = {};
    const sources: Partial<Record<SourcedField, Source>> = {};
    for (const c of champs) {
      if (c.valeur === null || c.valeur === undefined || c.valeur === "") continue;
      const actuelle = existante ? (c.champ === "adresse" ? existante.adresse : (existante as unknown as Record<string, unknown>)[c.champ]) : null;
      if (!peutEcrire(existante, c.champ, "sirene", actuelle)) continue;
      patch[c.cle] = c.valeur;
      sources[c.champ] = "sirene";
    }
    if (!existante) return { company: this.#companies.create({ ...patch, statut: "prospect", sources }, { silencieux: true }), cree: true };
    if (!Object.keys(patch).length) return { company: existante, cree: false };
    return { company: this.#companies.update(existante.id, { ...patch, sources }, { silencieux: true }), cree: false };
  }

  /** Fusion de champs venus de Places, d'OSM ou de l'audit, avec la même règle de priorité. Rend les champs écrits. */
  fusionnerChamps(companyId: string, source: Source, valeurs: Partial<Record<"telephone" | "siteActuel" | "email" | "google" | "horaires", unknown>>): string[] {
    const c = this.#companies.get(companyId);
    const patch: Record<string, unknown> = {};
    const sources: Partial<Record<SourcedField, Source>> = {};
    for (const [champ, brute] of Object.entries(valeurs) as [SourcedField, unknown][]) {
      // Téléphones au format français (« +33 4 78… » d'OSM → « 04 78… »), celui que l'atelier attend.
      const valeur = champ === "telephone" && typeof brute === "string" ? formaterTelephone(brute) : brute;
      if (valeur === null || valeur === undefined || valeur === "" || (typeof valeur === "object" && !Object.keys(valeur as object).length)) continue;
      if (!peutEcrire(c, champ, source, (c as unknown as Record<string, unknown>)[champ])) continue;
      patch[champ] = valeur;
      sources[champ] = source;
    }
    if (Object.keys(patch).length) this.#companies.update(companyId, { ...patch, sources }, { silencieux: true });
    return Object.keys(patch);
  }

  /** Statut et score de la fiche après calcul du score (prospect ↔ qualifié seulement, rien d'autre n'est touché). */
  appliquerScore(companyId: string, score: Score): void {
    const c = this.#companies.get(companyId);
    const patch: Record<string, unknown> = { score: Math.max(0, Math.min(100, score.total)) };
    if (score.qualifie && c.statut === "prospect") patch.statut = "qualifie";
    if (!score.qualifie && c.statut === "qualifie") patch.statut = "prospect";
    this.#companies.update(companyId, patch, { silencieux: true });
  }

  // ── Exclusion et liste d'opposition ─────────────────────────────────────

  exclure(ids: string[], motif: string): { exclues: number; supprimees: number } {
    const m = motif.trim();
    if (m.length < 2) throw new HubError("Indiquez le motif de l'exclusion");
    let exclues = 0;
    let supprimees = 0;
    transaction(this.#db, () => {
      for (const id of ids) {
        const c = this.#companies.get(id);
        if (/^opposition/i.test(m)) {
          // Opposition : on garde seulement des empreintes (jamais plus sourcée), puis la fiche disparaît (sauf cliente).
          this.ajouterOpposition({ siren: c.siren, telephone: c.telephone, email: c.email }, m);
          if (c.statut !== "client" && !this.#aDesSites(id)) {
            this.#companies.delete(id);
            supprimees++;
            continue;
          }
        }
        this.maj(id, { exclusion: { motif: m, le: this.#iso() }, qualifie: false });
        this.#companies.update(id, { statut: "exclu" }, { silencieux: ids.length > 1 });
        exclues++;
      }
    });
    this.#events.append({ type: "prospection.exclusion", message: `${exclues + supprimees} prospect(s) exclu(s) : ${m}${supprimees ? ` (${supprimees} fiche(s) supprimée(s), opposition enregistrée)` : ""}` });
    return { exclues, supprimees };
  }

  #aDesSites(companyId: string): boolean {
    return !!this.#db.prepare("SELECT 1 FROM sites WHERE company_id = ? LIMIT 1").get(companyId);
  }

  ajouterOpposition(v: { siren?: string | null; telephone?: string | null; email?: string | null }, motif: string | null = null): number {
    let n = 0;
    for (const type of ["siren", "telephone", "email"] as const) {
      const val = v[type];
      if (!val) continue;
      const cle = cleOpposition(type, val);
      if (!cle) continue;
      n += Number(this.#db.prepare("INSERT INTO opposition (cle, type, motif, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(cle) DO NOTHING").run(cle, type, motif, this.#iso()).changes);
    }
    return n;
  }

  estOpposee(v: { siren?: string | null; telephone?: string | null; email?: string | null }): boolean {
    for (const type of ["siren", "telephone", "email"] as const) {
      const val = v[type];
      if (!val) continue;
      const cle = cleOpposition(type, val);
      if (cle && this.#db.prepare("SELECT 1 FROM opposition WHERE cle = ?").get(cle)) return true;
    }
    return false;
  }

  oppositions(): { total: number; parType: Record<string, number>; dernieres: { type: string; motif: string | null; le: string }[] } {
    const rows = this.#db.prepare("SELECT type, COUNT(*) AS n FROM opposition GROUP BY type").all() as { type: string; n: number }[];
    const dernieres = (this.#db.prepare("SELECT type, motif, created_at FROM opposition ORDER BY created_at DESC LIMIT 20").all() as { type: string; motif: string | null; created_at: string }[]).map((r) => ({ type: r.type, motif: r.motif, le: r.created_at }));
    return { total: rows.reduce((s, r) => s + Number(r.n), 0), parType: Object.fromEntries(rows.map((r) => [r.type, Number(r.n)])), dernieres };
  }

  // ── Purge RGPD ──────────────────────────────────────────────────────────

  /**
   * Prospects non convertis sans activité depuis `mois` mois : fiche supprimée (avec ses relevés). Jamais une cliente,
   * jamais une fiche qui a un site (ses maquettes relèvent de l'atelier), ni une fiche créée à la main (sans ligne prospect).
   */
  purger(mois: number): { supprimees: number; avant: string } {
    const d = this.#now();
    const avant = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - mois, d.getUTCDate())).toISOString();
    const ids = (
      this.#db
        .prepare(
          `SELECT c.id FROM companies c JOIN prospects p ON p.company_id = c.id
           WHERE c.statut <> 'client' AND c.updated_at < ? AND p.updated_at < ?
             AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.company_id = c.id)
             AND NOT EXISTS (SELECT 1 FROM maquettes_file m WHERE m.company_id = c.id AND m.etat = 'en_attente')`,
        )
        .all(avant, avant) as { id: string }[]
    ).map((r) => r.id);
    transaction(this.#db, () => {
      for (const id of ids) this.#db.prepare("DELETE FROM companies WHERE id = ?").run(id);
    });
    if (ids.length) this.#events.append({ type: "prospection.purge", message: `Purge RGPD : ${ids.length} prospect(s) non converti(s) supprimé(s) (sans activité depuis ${mois} mois)` });
    return { supprimees: ids.length, avant };
  }

  /** Effectifs de la prospection (registre de traitement). */
  compter(): { prospects: number; qualifies: number; exclus: number } {
    const r = this.#db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(p.qualifie), 0) AS q, COALESCE(SUM(CASE WHEN c.statut = 'exclu' THEN 1 ELSE 0 END), 0) AS e FROM prospects p JOIN companies c ON c.id = p.company_id")
      .get() as { n: number; q: number; e: number };
    return { prospects: Number(r.n), qualifies: Number(r.q), exclus: Number(r.e) };
  }
}

