import { randomUUID } from "node:crypto";
import { distanceKm } from "../atelier/communes.ts";
import { now, parseJson, type Db } from "../db/database.ts";
import type { Company } from "../domain/companies.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { Bus, EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import type { Job, JobContext, JobQueue } from "../jobs/job-queue.ts";
import { meilleur, type Cible } from "./appariement.ts";
import { auditerSite, type AuditDeps } from "./audit.ts";
import { CampagneInput, Criteres } from "./criteres.ts";
import type { ProspectStore } from "./donnees.ts";
import { codesNaf, libelleNaf, metier, metierDeNaf } from "./metiers.ts";
import { calculerScore, grilleComplete, sansVraiSite, siteDefaillant, ageAnnees, type Faits, type StatutSite } from "./scoring.ts";
import { communeLisible, type Geo } from "./sources/geo.ts";
import type { OpenStreetMap, ZoneOsm, LieuOsm } from "./sources/osm.ts";
import { decouperAdresse, GooglePlaces, horairesDePlaces, PlafondPlacesAtteint } from "./sources/places.ts";
import { TRANCHES_EFFECTIF, type EtablissementSirene, type RechercheEntreprises, type ZoneRecherche } from "./sources/recherche-entreprises.ts";
import type { Compteur } from "./reseau.ts";

export const JOB_CAMPAGNE = "prospection.campagne";
export const PHASES = ["sourcing", "enrichissement", "audit", "score", "nettoyage"] as const;
export type Phase = (typeof PHASES)[number];
export const PHASE_LABELS: Record<Phase, string> = {
  sourcing: "Recherche des entreprises (Sirene)",
  enrichissement: "Enrichissement (OpenStreetMap, Google Places)",
  audit: "Audit des sites existants",
  score: "Calcul des scores",
  nettoyage: "Nettoyage des fiches écartées",
};
export type EtatCampagne = "brouillon" | "en_cours" | "terminee" | "erreur" | "annulee";

/** Pages Sirene lues au plus (25 entreprises par page ; l'API s'arrête de toute façon à 10 000 résultats). */
const PAGES_MAX = 400;
/** Un audit de moins de 30 jours sur la même adresse est réutilisé (une visite par site, pas plus). */
const AUDIT_VALIDE_MS = 30 * 86400_000;

export type Compteurs = {
  trouves?: number;
  pagesLues?: number;
  pagesTotal?: number;
  etablissements?: number;
  ecartes?: Record<string, number>;
  sources?: number;
  nouvelles?: number;
  enrichis?: number;
  osm?: { lieux: number; apparies: number; douteux: number; erreur?: string | null };
  places?: { appels: number; cache: number; apparies: number; douteux: number; saute?: string | null };
  avecSite?: number;
  sansSite?: number;
  audites?: number;
  qualifies?: number;
  aVerifier?: number;
  notes?: number;
  nettoyes?: number;
  aTraiter?: number;
  traites?: number;
};

export type Campagne = {
  id: string;
  nom: string;
  criteres: Criteres;
  etat: EtatCampagne;
  phase: Phase | null;
  jobId: string | null;
  compteurs: Compteurs;
  erreur: string | null;
  lanceeLe: string | null;
  finieLe: string | null;
  createdAt: string;
  updatedAt: string;
};

function fromRow(r: Record<string, unknown>): Campagne {
  return {
    id: String(r.id),
    nom: String(r.nom),
    criteres: parseJson(r.criteres_json, {} as Criteres),
    etat: r.etat as EtatCampagne,
    phase: (r.phase as Phase | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    compteurs: parseJson(r.compteurs_json, {}),
    erreur: (r.erreur as string | null) ?? null,
    lanceeLe: (r.lancee_le as string | null) ?? null,
    finieLe: (r.finie_le as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

type ZoneResolue = { recherche: ZoneRecherche; osm: ZoneOsm; centres: { lat: number; lon: number }[]; rayonKm: number | null; libelle: string };

export type CampagnesDeps = {
  db: Db;
  bus: Bus;
  events: EventLog;
  settings: Settings;
  jobs: JobQueue;
  store: ProspectStore;
  sirene: RechercheEntreprises;
  geo: Geo;
  osm: OpenStreetMap;
  places: GooglePlaces;
  compteur: Compteur;
  audit: AuditDeps;
  now?: () => Date;
};

/** Campagnes : critères enregistrés, lancement (un travail de la file), phases déterministes et reprenables. */
export class Campagnes {
  readonly #d: CampagnesDeps;
  readonly #now: () => Date;
  #unsubscribe: (() => void) | null = null;

  constructor(deps: CampagnesDeps) {
    this.#d = deps;
    this.#now = deps.now ?? (() => new Date());
    deps.jobs.register(JOB_CAMPAGNE, { run: (ctx) => this.#executer(ctx) });
    // Annulation ou échec définitif du travail : la campagne le dit.
    this.#unsubscribe = deps.bus.subscribe((m) => {
      if (m.kind !== "job") return;
      const job = m.job as Job;
      if (job.type !== JOB_CAMPAGNE || (job.state !== "cancelled" && job.state !== "failed")) return;
      const row = this.#d.db.prepare("SELECT id FROM campagnes WHERE job_id = ? AND etat = 'en_cours'").get(job.id) as { id: string } | undefined;
      if (!row) return;
      this.#maj(row.id, job.state === "cancelled" ? { etat: "annulee", finie_le: now() } : { etat: "erreur", erreur: job.error ?? "Erreur inconnue", finie_le: now() });
      this.#d.events.append({ type: "prospection.campagne", subject: `campagne:${row.id}`, message: job.state === "cancelled" ? "Campagne annulée" : `Campagne en erreur : ${job.error ?? ""}` });
    });
  }

  close(): void {
    this.#unsubscribe?.();
  }

  list(): Campagne[] {
    return (this.#d.db.prepare("SELECT * FROM campagnes ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(fromRow);
  }

  get(id: string): Campagne {
    const r = this.#d.db.prepare("SELECT * FROM campagnes WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) throw notFound("Campagne");
    return fromRow(r);
  }

  creer(raw: unknown): Campagne {
    const input = CampagneInput.parse(raw);
    const id = randomUUID().slice(0, 8);
    const at = now();
    this.#d.db.prepare("INSERT INTO campagnes (id, nom, criteres_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, input.nom, JSON.stringify(input.criteres), at, at);
    this.#d.events.append({ type: "prospection.campagne", subject: `campagne:${id}`, message: `Campagne créée : ${input.nom}` });
    return this.get(id);
  }

  modifier(id: string, raw: unknown): Campagne {
    const c = this.get(id);
    if (c.etat === "en_cours") throw new HubError("La campagne tourne : attendez la fin ou annulez-la avant de changer ses critères.", 409);
    const input = CampagneInput.parse(raw);
    this.#maj(id, { nom: input.nom, criteres_json: JSON.stringify(input.criteres) });
    return this.get(id);
  }

  supprimer(id: string): void {
    const c = this.get(id);
    if (c.etat === "en_cours") throw new HubError("La campagne tourne : annulez-la d'abord.", 409);
    // Les fiches trouvées restent (elles appartiennent au fichier des entreprises) ; seul le lien à la campagne part.
    this.#d.db.prepare("DELETE FROM campagnes WHERE id = ?").run(id);
    this.#d.events.append({ type: "prospection.campagne", message: `Campagne supprimée : ${c.nom}` });
  }

  /** Lance (ou relance) la campagne : un travail de la file, repris tout seul après un redémarrage. */
  lancer(id: string): Campagne {
    const c = this.get(id);
    if (c.etat === "en_cours") throw new HubError("La campagne tourne déjà.", 409);
    // Relance : on repart des critères, les fiches déjà trouvées sont mises à jour (jamais dupliquées).
    this.#d.db.prepare("DELETE FROM campagne_prospects WHERE campagne_id = ?").run(id);
    this.#maj(id, { etat: "en_cours", phase: "sourcing", job_id: null, compteurs_json: "{}", erreur: null, lancee_le: now(), finie_le: null });
    const job = this.#d.jobs.enqueue({ type: JOB_CAMPAGNE, label: `Campagne « ${c.nom} »`, subject: `campagne:${id}`, input: { campagneId: id }, maxAttempts: 2 });
    this.#maj(id, { job_id: job.id });
    this.#d.events.append({ type: "prospection.campagne", subject: `campagne:${id}`, message: `Campagne lancée : ${c.nom}` });
    return this.get(id);
  }

  annuler(id: string): Campagne {
    const c = this.get(id);
    if (c.etat !== "en_cours" || !c.jobId) throw new HubError("La campagne ne tourne pas.", 409);
    this.#d.jobs.cancel(c.jobId);
    return this.get(id);
  }

  #maj(id: string, patch: Record<string, string | number | null>): void {
    const cols = Object.keys(patch);
    this.#d.db.prepare(`UPDATE campagnes SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...Object.values(patch), now(), id);
  }

  /** Compteurs en direct : l'interface les relit pendant qu'une campagne tourne (rien dans le journal). */
  #compter(id: string, fn: (c: Compteurs) => void): void {
    const c = this.get(id).compteurs;
    fn(c);
    this.#maj(id, { compteurs_json: JSON.stringify(c) });
  }

  // ── Exécution ───────────────────────────────────────────────────────────

  async #executer(ctx: JobContext): Promise<unknown> {
    const { campagneId } = ctx.job.input as { campagneId: string };
    // La file peut lancer le travail pendant son ajout, avant que la campagne n'ait noté son identifiant.
    await Promise.resolve();
    let c = this.get(campagneId);
    if ((c.jobId !== null && c.jobId !== ctx.job.id) || c.etat !== "en_cours") return { ignore: true };
    const criteres = Criteres.parse(c.criteres);
    try {
      const zone = await this.#zone(criteres, ctx.signal);
      // Chaque phase reprend là où elle s'était arrêtée (étape notée par entreprise) : un redémarrage ne refait rien.
      for (const phase of PHASES.slice(PHASES.indexOf(c.phase ?? "sourcing"))) {
        this.#maj(campagneId, { phase });
        ctx.progress({ label: PHASE_LABELS[phase], pct: Math.round((PHASES.indexOf(phase) / PHASES.length) * 100) });
        ctx.log("info", PHASE_LABELS[phase]);
        if (phase === "sourcing") await this.#sourcing(campagneId, criteres, zone, ctx);
        if (phase === "enrichissement") await this.#enrichissement(campagneId, criteres, zone, ctx);
        if (phase === "audit") await this.#audit(campagneId, criteres, ctx);
        if (phase === "score") this.#score(campagneId, criteres);
        if (phase === "nettoyage") this.#nettoyage(campagneId);
      }
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      this.#maj(campagneId, { erreur: (err as Error).message.slice(0, 500) });
      throw err;
    }
    this.#maj(campagneId, { etat: "terminee", phase: null, finie_le: now() });
    c = this.get(campagneId);
    const k = c.compteurs;
    this.#d.events.append({
      type: "prospection.campagne",
      subject: `campagne:${campagneId}`,
      message: `Campagne « ${c.nom} » terminée : ${k.sources ?? 0} entreprise(s) gardée(s), ${k.qualifies ?? 0} qualifiée(s)`,
      data: { compteurs: k },
    });
    ctx.progress({ label: "Terminée", pct: 100 });
    return { compteurs: k };
  }

  async #zone(cr: Criteres, signal: AbortSignal): Promise<ZoneResolue> {
    const z = cr.zone;
    if (z.type === "rayon") {
      const commune = await this.#d.geo.commune(z.commune, signal);
      return {
        recherche: { type: "rayon", lat: commune.lat, lon: commune.lon, rayonKm: z.rayonKm },
        osm: [{ type: "cercle", lat: commune.lat, lon: commune.lon, rayonKm: z.rayonKm }],
        centres: [{ lat: commune.lat, lon: commune.lon }],
        rayonKm: z.rayonKm,
        libelle: `${commune.nom} + ${z.rayonKm} km`,
      };
    }
    if (z.type === "communes") {
      const communes = [];
      for (const nom of z.communes) communes.push(await this.#d.geo.commune(nom, signal));
      const codes = communes.map((c) => c.code).filter((c): c is string => !!c);
      if (!codes.length) throw new HubError("Aucune commune reconnue (geo.api.gouv.fr injoignable ?)", 502);
      return {
        recherche: { type: "communes", codes },
        osm: communes.map((c) => ({ type: "cercle" as const, lat: c.lat, lon: c.lon, rayonKm: 4 })),
        centres: communes,
        rayonKm: null,
        libelle: communes.map((c) => c.nom).join(", "),
      };
    }
    return { recherche: { type: "departements", departements: z.departements }, osm: { type: "departements", departements: z.departements }, centres: [], rayonKm: null, libelle: `Département(s) ${z.departements.join(", ")}` };
  }

  #distance(zone: ZoneResolue, lat: number | null, lon: number | null): number | null {
    if (lat == null || lon == null || !zone.centres.length) return null;
    return Math.round(Math.min(...zone.centres.map((c) => distanceKm(c, { lat, lon }))) * 10) / 10;
  }

  async #sourcing(id: string, cr: Criteres, zone: ZoneResolue, ctx: JobContext): Promise<void> {
    const naf = codesNaf(cr.metiers, cr.nafLibres);
    const ecartes: Record<string, number> = {};
    const ecarter = (motif: string) => (ecartes[motif] = (ecartes[motif] ?? 0) + 1);
    const vus = new Set<string>();
    const gardes: { e: EtablissementSirene; km: number | null }[] = [];
    let pages = 1;
    let total = 0;
    const maintenant = this.#now();
    for (let p = 1; p <= Math.min(pages, PAGES_MAX); p++) {
      const r = await this.#d.sirene.page(zone.recherche, naf, p, { signal: ctx.signal, campagneId: id });
      pages = r.pages;
      total = r.total;
      for (const e of r.etablissements) {
        if (vus.has(e.siret)) continue;
        vus.add(e.siret);
        const km = this.#distance(zone, e.lat, e.lon);
        if (!e.diffusible) ecarter("non diffusible (Sirene)");
        else if (e.oppositionProspection) ecarter("opposée à la prospection (registre)");
        else if (this.#d.store.estOpposee({ siren: e.siren })) ecarter("liste d'opposition");
        else if (cr.siegeSeulement && !e.estSiege) ecarter("établissement secondaire");
        else if (zone.rayonKm != null && km != null && km > zone.rayonKm) ecarter("hors zone");
        else if (cr.artisansSeulement && (e.categorie === "GE" || e.categorie === "ETI" || (TRANCHES_EFFECTIF[e.effectif ?? ""]?.max ?? 0) > 19 || (e.etablissementsOuverts ?? 1) > 3)) ecarter("réseau ou entreprise de plus de 19 salariés");
        else if (cr.ancienneteMinAns != null && e.dateCreation && ageAnnees(e.dateCreation, maintenant) < cr.ancienneteMinAns) ecarter("trop récente");
        else gardes.push({ e, km });
      }
      if (p % 5 === 0 || p === pages) {
        ctx.progress({ label: `Sirene : page ${p} sur ${Math.min(pages, PAGES_MAX)}`, pct: Math.round((p / Math.max(1, Math.min(pages, PAGES_MAX))) * 18) });
        this.#compter(id, (k) => Object.assign(k, { trouves: total, pagesLues: p, pagesTotal: Math.min(pages, PAGES_MAX), etablissements: vus.size }));
      }
    }
    // Plus proches d'abord, jusqu'à la limite de la campagne ; un SIREN = une fiche.
    gardes.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
    const parSiren = new Set<string>();
    let nouvelles = 0;
    let sources = 0;
    for (const { e, km } of gardes) {
      if (parSiren.has(e.siren)) continue;
      parSiren.add(e.siren);
      const existante = this.#d.store.companyParSiren(e.siren);
      if (existante) {
        if (existante.statut === "exclu") {
          ecarter("exclue auparavant");
          continue;
        }
        if (cr.exclusions.clients && existante.statut === "client") {
          ecarter("déjà cliente");
          continue;
        }
        if (cr.exclusions.dejaContactes && (existante.statut === "contacte" || existante.statut === "perdu")) {
          ecarter("déjà contactée");
          continue;
        }
      }
      if (sources >= cr.limite) {
        ecarter("au-delà de la limite de la campagne");
        continue;
      }
      const commune = (e.adresse.codeCommune && (await this.#d.geo.nomDeCode(e.adresse.codeCommune, ctx.signal))) || communeLisible(e.adresse.commune);
      const etab = { ...e, adresse: { ...e.adresse, commune } };
      const { company, cree } = this.#d.store.fusionnerSirene(etab, libelleNaf(e.naf) ?? metierDeNaf(e.naf)?.libelle ?? null);
      if (cree) nouvelles++;
      sources++;
      this.#d.store.maj(company.id, {
        siret: e.siret,
        lat: e.lat,
        lon: e.lon,
        sirene: { siret: e.siret, enseignes: e.enseignes, sigle: e.sigle, estSiege: e.estSiege, effectif: e.effectif, categorie: e.categorie, etablissementsOuverts: e.etablissementsOuverts, natureJuridique: e.natureJuridique },
      });
      this.#d.db
        .prepare("INSERT INTO campagne_prospects (campagne_id, company_id, distance_km, etape, ajoute_le, maj_le) VALUES (?, ?, ?, 'source', ?, ?) ON CONFLICT(campagne_id, company_id) DO UPDATE SET distance_km = excluded.distance_km, maj_le = excluded.maj_le")
        .run(id, company.id, km, now(), now());
      if (sources % 25 === 0) this.#compter(id, (k) => Object.assign(k, { sources, nouvelles }));
    }
    this.#compter(id, (k) => Object.assign(k, { trouves: total, etablissements: vus.size, ecartes, sources, nouvelles }));
    this.#d.events.append({ type: "prospection.campagne", subject: `campagne:${id}`, message: `Sirene : ${total} entreprise(s) trouvée(s) dans ${zone.libelle}, ${sources} gardée(s) (${nouvelles} nouvelle(s))` });
  }

  #lignes(id: string, etape: string): { companyId: string; km: number | null }[] {
    return (this.#d.db.prepare("SELECT company_id, distance_km FROM campagne_prospects WHERE campagne_id = ? AND etape = ? ORDER BY distance_km IS NULL, distance_km, company_id").all(id, etape) as { company_id: string; distance_km: number | null }[]).map((r) => ({
      companyId: r.company_id,
      km: r.distance_km,
    }));
  }

  #etape(id: string, companyId: string, etape: string, motif: string | null = null): void {
    this.#d.db.prepare("UPDATE campagne_prospects SET etape = ?, motif = ?, maj_le = ? WHERE campagne_id = ? AND company_id = ?").run(etape, motif, now(), id, companyId);
  }

  #cible(c: Company): Cible {
    const p = this.#d.store.get(c.id);
    // Du dirigeant, seul le nom de famille compte : un prénom commun (« Jean ») ne rapproche pas deux entreprises.
    const nomDirigeant = c.dirigeant?.split(/\s+/).slice(1).join(" ") || null;
    return { noms: [c.nomCommercial, c.raisonSociale, ...(p?.sirene?.enseignes ?? []), nomDirigeant], adresse: { ligne: c.adresse.ligne, codePostal: c.adresse.codePostal }, lat: p?.lat ?? null, lon: p?.lon ?? null };
  }

  async #enrichissement(id: string, cr: Criteres, zone: ZoneResolue, ctx: JobContext): Promise<void> {
    const lignes = this.#lignes(id, "source");
    const k0 = this.get(id).compteurs;
    const osmK = k0.osm ?? { lieux: 0, apparies: 0, douteux: 0, erreur: null };
    const plK = k0.places ?? { appels: 0, cache: 0, apparies: 0, douteux: 0, saute: null };

    // OpenStreetMap : une requête pour toute la zone (en cache 7 jours).
    let lieux: LieuOsm[] = [];
    if (cr.osm && lignes.length) {
      const etiquettes = [...cr.metiers.flatMap((m) => metier(m)?.osm ?? []), ...cr.nafLibres.flatMap((n) => metierDeNaf(n)?.osm ?? [])];
      try {
        ctx.progress({ label: "OpenStreetMap : lieux de la zone", pct: 20 });
        lieux = (await this.#d.osm.lieux(zone.osm, etiquettes, { signal: ctx.signal, campagneId: id })).lieux;
        osmK.lieux = lieux.length;
        osmK.erreur = null;
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        osmK.erreur = (err as Error).message.slice(0, 300);
        ctx.log("error", osmK.erreur);
      }
    }
    if (!cr.places) plK.saute = "désactivé dans les critères de la campagne";
    else if (!this.#d.places.configure) plK.saute = "clé Google Places absente (Réglages)";
    this.#compter(id, (k) => Object.assign(k, { osm: osmK, places: plK, aTraiter: lignes.length, traites: 0 }));

    let i = 0;
    for (const { companyId } of lignes) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error("Annulé");
      i++;
      const c = this.#d.store.company(companyId);
      if (!c) continue;
      const cible = this.#cible(c);
      const le = now();
      if (lieux.length) {
        const m = meilleur(cible, lieux);
        const prec = this.#d.store.get(c.id)?.osm;
        // Une décision du propriétaire (accepté ou refusé) sur le même lieu est gardée.
        const decision = prec?.lieu && m && prec.lieu.id === m.candidat.id ? prec.decision : undefined;
        this.#d.store.maj(c.id, { osm: m ? { lieu: m.candidat, appariement: m.appariement, le, ...(decision ? { decision } : {}) } : { lieu: null, appariement: null, le } });
        if (m && (m.appariement.statut === "fusionne" ? decision !== "refusee" : decision === "acceptee")) {
          osmK.apparies++;
          this.#d.store.fusionnerChamps(c.id, "osm", { telephone: m.candidat.telephone, siteActuel: m.candidat.site });
        } else if (m?.appariement.statut === "douteux") osmK.douteux++;
      }
      if (!plK.saute) {
        try {
          const nom = c.nomCommercial ?? c.raisonSociale;
          const r = await this.#d.places.chercher({ texte: `${nom} ${c.adresse.commune ?? ""}`.trim(), lat: cible.lat, lon: cible.lon, signal: ctx.signal, campagneId: id });
          if (r.depuisCache) plK.cache++;
          else plK.appels++;
          const cands = r.fiches.map((f) => ({ ...f, adresse: decouperAdresse(f.adresse), adresseComplete: f.adresse }));
          const m = meilleur(cible, cands);
          const fiche = m ? r.fiches.find((f) => f.id === m.candidat.id)! : null;
          const prec = this.#d.store.get(c.id)?.places;
          const decision = prec?.fiche && fiche && prec.fiche.id === fiche.id ? prec.decision : undefined;
          this.#d.store.maj(c.id, { places: { fiche, appariement: m?.appariement ?? null, le, ...(decision ? { decision } : {}) } });
          if (fiche && m && (m.appariement.statut === "fusionne" ? decision !== "refusee" : decision === "acceptee")) {
            plK.apparies++;
            this.fusionnerPlaces(c.id, fiche);
          } else if (m?.appariement.statut === "douteux") plK.douteux++;
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          if (err instanceof PlafondPlacesAtteint) {
            plK.saute = err.message;
            ctx.log("error", err.message);
          } else ctx.log("error", `Places, ${c.raisonSociale} : ${(err as Error).message.slice(0, 200)}`);
        }
      }
      this.#d.store.maj(c.id, { enrichi_le: le });
      this.#etape(id, c.id, "enrichi");
      if (i % 10 === 0 || i === lignes.length) {
        ctx.progress({ label: `Enrichissement : ${i} sur ${lignes.length}`, pct: 20 + Math.round((i / lignes.length) * 20) });
        this.#compter(id, (k) => Object.assign(k, { osm: osmK, places: plK, enrichis: (k0.enrichis ?? 0) + i, traites: i }));
      }
    }
    this.#compter(id, (k) => Object.assign(k, { osm: osmK, places: plK }));
  }

  /** Données Places fusionnées dans la fiche (téléphone, site, note et avis, horaires). */
  fusionnerPlaces(companyId: string, f: { telephone: string | null; site: string | null; note: number | null; avis: number | null; url: string | null; horaires: string[] }): string[] {
    return this.#d.store.fusionnerChamps(companyId, "places", {
      telephone: f.telephone,
      siteActuel: f.site,
      google: f.note != null || f.avis != null ? { valeur: f.note, nombre: f.avis, url: f.url } : null,
      horaires: f.horaires.length ? horairesDePlaces(f.horaires) : null,
    });
  }

  async #audit(id: string, cr: Criteres, ctx: JobContext): Promise<void> {
    const lignes = this.#lignes(id, "enrichi");
    let avecSite = 0;
    let sansSite = 0;
    let audites = 0;
    const k0 = this.get(id).compteurs;
    avecSite = k0.avecSite ?? 0;
    sansSite = k0.sansSite ?? 0;
    audites = k0.audites ?? 0;
    let i = 0;
    // Deux sites à la fois au plus (sites différents, donc hôtes différents) ; Lighthouse lance un Edge à chaque fois.
    const file = [...lignes];
    const travail = async () => {
      for (let l = file.shift(); l; l = file.shift()) {
        if (ctx.signal.aborted) throw ctx.signal.reason ?? new Error("Annulé");
        const c = this.#d.store.company(l.companyId);
        if (!c) continue;
        const p = this.#d.store.get(c.id);
        let statut: StatutSite;
        if (!c.siteActuel) {
          statut = "aucun";
          sansSite++;
          this.#d.store.maj(c.id, { site_statut: "aucun", audit: null, audite_le: now() });
        } else {
          avecSite++;
          const recent = p?.audit && p.audit.url.replace(/^https?:\/\//, "").replace(/\/$/, "") === c.siteActuel.replace(/^https?:\/\//, "").replace(/\/$/, "") && this.#now().getTime() - new Date(p.audit.le).getTime() < AUDIT_VALIDE_MS;
          if (recent) {
            // Audit de moins de 30 jours sur la même adresse : réutilisé (aucune nouvelle visite), compté quand même.
            statut = p!.audit!.statutSite;
            audites++;
          }
          else if (!cr.audit) statut = "inconnu";
          else {
            ctx.log("tool", `Audit de ${c.siteActuel}`);
            const audit = await auditerSite({ url: c.siteActuel, entreprise: c.nomCommercial ?? c.raisonSociale, commune: c.adresse.commune, lighthouse: cr.lighthouse }, this.#d.audit, ctx.signal);
            audites++;
            statut = audit.statutSite;
            this.#d.store.maj(c.id, { audit });
            if (audit.email) this.#d.store.fusionnerChamps(c.id, "audit", { email: audit.email });
          }
          this.#d.store.maj(c.id, { site_statut: statut, audite_le: now() });
        }
        this.#etape(id, c.id, "audite");
        i++;
        if (i % 5 === 0 || i === lignes.length) {
          ctx.progress({ label: `Audit : ${i} sur ${lignes.length}`, pct: 40 + Math.round((i / Math.max(1, lignes.length)) * 50) });
          this.#compter(id, (k) => Object.assign(k, { avecSite, sansSite, audites, traites: i, aTraiter: lignes.length }));
        }
      }
    };
    await Promise.all([travail(), travail()]);
    this.#compter(id, (k) => Object.assign(k, { avecSite, sansSite, audites }));
  }

  /** Faits du score d'une fiche, à partir de la fiche et de ses relevés. */
  faits(c: Company): Faits {
    const p = this.#d.store.get(c.id);
    const sourcesSite: Faits["sourcesSite"] = [];
    if (p?.places && p.places.le) sourcesSite.push("places");
    if (p?.osm && p.osm.le) sourcesSite.push("osm");
    if (c.sources.siteActuel === "saisie") sourcesSite.push("saisie");
    const a = p?.audit ?? null;
    const reseau = (p?.sirene?.etablissementsOuverts ?? 1) > 3;
    return {
      statutSite: (p?.siteStatut as StatutSite | null) ?? (c.siteActuel ? "inconnu" : "aucun"),
      sourcesSite,
      https: a?.https ?? null,
      mobile: a?.mobile ?? null,
      anneeCopyright: a?.anneeCopyright ?? null,
      techDatee: a?.techDatee ?? null,
      avis: c.google ? { note: c.google.valeur, nombre: c.google.nombre } : null,
      dateCreation: c.dateCreation,
      franchise: a?.franchise?.oui ? a.franchise : reseau ? { oui: true, raison: `réseau : ${p?.sirene?.etablissementsOuverts} établissements ouverts (Sirene)` } : (a?.franchise ?? null),
    };
  }

  /** Recalcule le score d'une fiche (grille du moment) ; rend le score. */
  noter(c: Company): ReturnType<typeof calculerScore> {
    const grille = grilleComplete(this.#d.settings.get("prospection.grille"));
    const score = calculerScore(grille, this.faits(c), this.#now());
    this.#d.store.maj(c.id, { score, qualifie: score.qualifie, note_le: now() });
    this.#d.store.appliquerScore(c.id, score);
    return score;
  }

  #score(id: string, cr: Criteres): void {
    const lignes = this.#lignes(id, "audite");
    let qualifies = this.get(id).compteurs.qualifies ?? 0;
    let notes = this.get(id).compteurs.notes ?? 0;
    let aVerifier = this.get(id).compteurs.aVerifier ?? 0;
    const ecartes = { ...(this.get(id).compteurs.ecartes ?? {}) };
    for (const { companyId } of lignes) {
      const c = this.#d.store.company(companyId);
      if (!c) continue;
      const score = this.noter(c);
      const statut = this.#d.store.get(c.id)?.siteStatut ?? "inconnu";
      let motif: string | null = null;
      if (cr.exclusions.franchises && score.exclu) motif = "franchise ou réseau";
      else if (cr.site === "aucun" && !sansVraiSite(statut)) motif = "a déjà un site";
      else if (cr.site === "aucun_ou_defaillant" && !(sansVraiSite(statut) || siteDefaillant(statut))) motif = "site correct";
      else if (cr.site === "defaillant" && !siteDefaillant(statut)) motif = "pas de site défaillant";
      else if (cr.avisMin != null && c.google?.nombre != null && c.google.nombre < cr.avisMin) motif = "pas assez d'avis";
      else if (cr.noteMin != null && c.google?.valeur != null && c.google.valeur < cr.noteMin) motif = "note trop basse";
      if (motif) {
        ecartes[motif] = (ecartes[motif] ?? 0) + 1;
        this.#etape(id, c.id, "ecarte", motif);
        // Une fiche écartée par cette campagne ne compte pas comme qualifiée pour elle.
        continue;
      }
      notes++;
      if (score.qualifie) qualifies++;
      if (score.aVerifier) aVerifier++;
      this.#etape(id, c.id, "note");
    }
    this.#compter(id, (k) => Object.assign(k, { qualifies, aVerifier, notes, ecartes }));
  }

  /**
   * Minimisation (RGPD) : une fiche créée par la prospection et écartée par toutes ses campagnes, sans rien de saisi
   * à la main ni site, est supprimée tout de suite (les compteurs gardent le nombre et le motif).
   */
  #nettoyage(id: string): void {
    const ids = (
      this.#d.db
        .prepare(
          `SELECT cp.company_id AS id FROM campagne_prospects cp JOIN companies c ON c.id = cp.company_id
           WHERE cp.campagne_id = ? AND cp.etape = 'ecarte' AND c.statut IN ('prospect', 'qualifie')
             AND c.sources_json NOT LIKE '%"saisie"%' AND (c.notes IS NULL OR c.notes = '')
             AND NOT EXISTS (SELECT 1 FROM campagne_prospects o WHERE o.company_id = cp.company_id AND o.campagne_id <> cp.campagne_id AND o.etape <> 'ecarte')
             AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.company_id = cp.company_id)
             AND NOT EXISTS (SELECT 1 FROM maquettes_file m WHERE m.company_id = cp.company_id)`,
        )
        .all(id) as { id: string }[]
    ).map((r) => r.id);
    for (const cid of ids) this.#d.db.prepare("DELETE FROM companies WHERE id = ?").run(cid);
    this.#compter(id, (k) => Object.assign(k, { nettoyes: (k.nettoyes ?? 0) + ids.length }));
  }
}
