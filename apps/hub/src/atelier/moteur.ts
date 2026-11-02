import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentService } from "../agents/agent-service.ts";
import { QuotaClaudeError } from "../agents/claude-cli.ts";
import { now, parseJson, type Db } from "../db/database.ts";
import type { CompanyService } from "../domain/companies.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { Bus, EventLog } from "../domain/events.ts";
import type { SiteService } from "../domain/sites.ts";
import type { Job, JobContext, JobQueue } from "../jobs/job-queue.ts";
import { prerequisMaquette } from "./brief.ts";
import type { KitRunner } from "./kit.ts";
import type { Registre } from "./registre.ts";
import type { Consigne, Issue, Recette } from "./recette.ts";

export const JOB_ETAPE = "atelier.etape";

/** Reprise automatique des fabrications en attente du quota (ADR-16). */
const ATTENTE_REPRISE_MS = 15 * 60_000;

export type EtatFabrication = "en_cours" | "a_valider" | "validee" | "arretee" | "en_attente";
export type EtatPasse = "en_file" | "en_cours" | "ok" | "echec" | "sautee" | "renvoi" | "erreur" | "arret" | "annulee";

export type Passe = {
  n: number;
  etape: string;
  tour: number;
  etat: EtatPasse;
  jobId: string;
  creeLe: string;
  debut: string | null;
  fin: string | null;
  resume: string | null;
  sortie?: unknown;
};

export type Tour = { n: number; origine: "auto" | "demande"; consignes: Consigne[]; fichier: string; debut: string; fin: string | null; resultat: "ok" | "echec" | null };
export type ResultatControle = { etape: string; ok: boolean; resume: string; consignes: Consigne[] };

export type Fabrication = {
  id: string;
  siteId: string;
  recette: string;
  etat: EtatFabrication;
  etape: string | null;
  jobId: string | null;
  tour: number;
  motif: string | null;
  motifType: "controle" | "technique" | "schema" | "annulee" | "quota" | null;
  refaire: boolean;
  cycle: ResultatControle[];
  renvois: { comptes: Record<string, number>; messages: Record<string, string> };
  exigences: string[];
  passes: Passe[];
  tours: Tour[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

function fromRow(r: Record<string, unknown>): Fabrication {
  return {
    id: String(r.id),
    siteId: String(r.site_id),
    recette: String(r.recette),
    etat: r.etat as EtatFabrication,
    etape: (r.etape as string | null) ?? null,
    jobId: (r.job_id as string | null) ?? null,
    tour: Number(r.tour),
    motif: (r.motif as string | null) ?? null,
    motifType: (r.motif_type as Fabrication["motifType"]) ?? null,
    refaire: Number(r.refaire) === 1,
    cycle: parseJson(r.cycle_json, []),
    renvois: { comptes: {}, messages: {}, ...parseJson<Partial<Fabrication["renvois"]>>(r.renvois_json, {}) },
    exigences: parseJson(r.exigences_json, []),
    passes: parseJson(r.passes_json, []),
    tours: parseJson(r.tours_json, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

/** Texte d'un tour de correction : les consignes exactes, regroupées par origine, sans reformulation. */
export function compilerConsignes(n: number, origine: Tour["origine"], consignes: Consigne[], exigences: string[]): string {
  const groupes = new Map<string, string[]>();
  for (const c of consignes) groupes.set(c.origine, [...(groupes.get(c.origine) ?? []), c.texte]);
  const lignes = [`# Tour de correction ${n}${origine === "demande" ? " — demande du propriétaire" : ""}`, ""];
  if (exigences.length) {
    lignes.push("## Exigences du propriétaire (à respecter, mot pour mot)", "", ...exigences.map((e) => `- ${e}`), "");
  }
  for (const [o, textes] of groupes) lignes.push(`## ${o}`, "", ...textes.map((t) => `- ${t}`), "");
  return lignes.join("\n");
}

/**
 * Machine à états de l'atelier (ADR-09). Le code enchaîne les étapes d'une recette ; chaque étape est un
 * travail de la file (rejouable : elle repart de ses fichiers d'entrée). L'état est en base : un redémarrage
 * au milieu reprend là où on en était. Un contrôle raté renvoie en correction (N tours au plus), puis
 * arrêt « à revoir » avec le motif ; jamais « validé avec remarques ».
 */
export class Atelier {
  readonly #db: Db;
  readonly #events: EventLog;
  readonly #jobs: JobQueue;
  readonly #sites: SiteService;
  readonly #companies: CompanyService;
  readonly #recettes: Map<string, Recette>;
  readonly #agents: Pick<AgentService, "ask" | "atelier">;
  readonly #kit: KitRunner;
  readonly #registre: Registre;
  readonly #sitesDir: string;
  readonly #now: () => Date;
  #unsubscribe: (() => void) | null = null;
  readonly #timerAttente: NodeJS.Timeout;

  constructor(deps: {
    db: Db;
    bus: Bus;
    events: EventLog;
    jobs: JobQueue;
    sites: SiteService;
    companies: CompanyService;
    recettes: Recette[];
    agents: Pick<AgentService, "ask" | "atelier">;
    kit: KitRunner;
    registre: Registre;
    sitesDir: string;
    now?: () => Date;
  }) {
    this.#db = deps.db;
    this.#events = deps.events;
    this.#jobs = deps.jobs;
    this.#sites = deps.sites;
    this.#companies = deps.companies;
    this.#recettes = new Map(deps.recettes.map((r) => [r.id, r]));
    this.#agents = deps.agents;
    this.#kit = deps.kit;
    this.#registre = deps.registre;
    this.#sitesDir = deps.sitesDir;
    this.#now = deps.now ?? (() => new Date());
    this.#jobs.register(JOB_ETAPE, { run: (ctx) => this.#executer(ctx) });
    // La fin d'un travail d'étape (publiée par la file) fait avancer la fabrication.
    this.#unsubscribe = deps.bus.subscribe((m) => {
      if (m.kind !== "job") return;
      const job = m.job as Job;
      if (job.type === JOB_ETAPE && (job.state === "done" || job.state === "failed" || job.state === "cancelled")) {
        // Hors de la pile de la file (qui est en train de clore le travail).
        queueMicrotask(() => this.#surFinDeTravail(job.id));
      }
    });
    // Reprise automatique des fabrications en attente du quota : le rétablissement se constate par un vrai appel.
    this.#timerAttente = setInterval(() => {
      try {
        this.reprendreEnAttente();
      } catch {
        /* un échec de reprise attendra le prochain tour */
      }
    }, ATTENTE_REPRISE_MS);
    this.#timerAttente.unref();
  }

  close(): void {
    this.#unsubscribe?.();
    clearInterval(this.#timerAttente);
  }

  recettes(): Recette[] {
    return [...this.#recettes.values()];
  }

  recette(id: string): Recette {
    const r = this.#recettes.get(id);
    if (!r) throw new HubError(`Recette sans chaîne de fabrication : ${id}`);
    return r;
  }

  // ── Lecture ─────────────────────────────────────────────────────────────

  get(id: string): Fabrication {
    const row = this.#db.prepare("SELECT * FROM fabrications WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Fabrication");
    return fromRow(row);
  }

  /** Dernière fabrication d'un site (null si le site n'a jamais été fabriqué). */
  pourSite(siteId: string): Fabrication | null {
    const row = this.#db.prepare("SELECT * FROM fabrications WHERE site_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(siteId) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  list(filter: { etat?: EtatFabrication } = {}): (Fabrication & { companyName: string; companyId: string })[] {
    const rows = this.#db
      .prepare(
        `SELECT f.*, s.company_id AS company_id, COALESCE(c.nom_commercial, c.raison_sociale) AS company_name FROM fabrications f
         JOIN sites s ON s.id = f.site_id JOIN companies c ON c.id = s.company_id
         WHERE f.rowid IN (SELECT MAX(rowid) FROM fabrications GROUP BY site_id) ${filter.etat ? "AND f.etat = ?" : ""}
         ORDER BY f.updated_at DESC LIMIT 200`,
      )
      .all(...(filter.etat ? [filter.etat] : [])) as Record<string, unknown>[];
    return rows.map((r) => ({ ...fromRow(r), companyName: String(r.company_name), companyId: String(r.company_id) }));
  }

  // ── Actions ─────────────────────────────────────────────────────────────

  /** « Créer la maquette » : un site neuf pour l'entreprise, et sa fabrication démarre. */
  lancer(companyId: string, recetteId = "vitrine-artisan") {
    const company = this.#companies.get(companyId);
    const recette = this.recette(recetteId);
    const pre = prerequisMaquette(company);
    if (!pre.possible) throw new HubError(`Impossible de créer la maquette : il manque ${pre.manques.join(", ")}.`, 400);
    const enCours = this.#db
      .prepare("SELECT f.id FROM fabrications f JOIN sites s ON s.id = f.site_id WHERE s.company_id = ? AND f.etat = 'en_cours'")
      .get(companyId) as { id: string } | undefined;
    if (enCours) throw new HubError("Une maquette est déjà en fabrication pour cette entreprise.", 409);
    const site = this.#sites.create({ companyId, recette: recette.id });
    const id = randomUUID().slice(0, 12);
    const at = now();
    this.#db.prepare("INSERT INTO fabrications (id, site_id, recette, etat, created_at, updated_at) VALUES (?, ?, ?, 'en_cours', ?, ?)").run(id, site.id, recette.id, at, at);
    this.#sites.update(site.id, { statut: "en_fabrication" });
    this.#events.append({ type: "atelier.lancee", subject: `site:${site.id}`, message: `Maquette lancée pour ${company.nomCommercial ?? company.raisonSociale} (${recette.nom})`, data: { fabricationId: id, companyId } });
    this.#demarrer(this.get(id), recette.sequence[0]!);
    return { site: this.#sites.get(site.id), fabrication: this.get(id) };
  }

  valider(siteId: string): Fabrication {
    const f = this.#derniere(siteId);
    if (f.etat !== "a_valider") throw new HubError("Cette maquette n'attend pas de validation.", 409);
    this.#maj(f.id, { etat: "validee", finished_at: now() });
    this.#sites.update(siteId, { statut: "demo_prete" });
    const site = this.#sites.get(siteId);
    const company = this.#companies.get(site.companyId);
    if (company.statut === "prospect" || company.statut === "qualifie") this.#companies.update(company.id, { statut: "maquette" });
    this.#events.append({ type: "atelier.validee", subject: `site:${siteId}`, message: `Maquette validée : ${site.companyName} (démo prête)`, data: { fabricationId: f.id } });
    return this.get(f.id);
  }

  /** Demande de modifications : le texte devient une exigence, transmise mot pour mot, puis toute la chaîne de contrôle. */
  modifier(siteId: string, texte: string): Fabrication {
    const demande = texte.trim();
    if (demande.length < 5) throw new HubError("Décrivez la modification demandée.", 400);
    const f = this.#derniere(siteId);
    if (f.etat !== "a_valider" && f.etat !== "arretee" && f.etat !== "validee") throw new HubError("La fabrication est en cours : attendez la fin.", 409);
    if (!f.passes.some((p) => p.etape === this.recette(f.recette).correction.retour)) throw new HubError("Ce site n'a pas encore été construit : utilisez « Refaire ».", 409);
    const exigences = [...f.exigences, demande];
    this.#maj(f.id, { etat: "en_cours", motif: null, motif_type: null, finished_at: null, tour: 0, cycle_json: "[]", exigences_json: JSON.stringify(exigences) });
    this.#sites.update(siteId, { statut: "en_fabrication" });
    this.#events.append({ type: "atelier.modifications", subject: `site:${siteId}`, message: `Modifications demandées : « ${demande.slice(0, 140)}${demande.length > 140 ? "…" : ""} »`, data: { fabricationId: f.id } });
    this.#ouvrirTour(this.get(f.id), "demande", [{ origine: "Demande du propriétaire", texte: demande }]);
    return this.get(f.id);
  }

  /** Refaire : repart de la direction artistique (le brief est gardé, le design précédent sert de contre-exemple). */
  refaire(siteId: string): Fabrication {
    const f = this.#derniere(siteId);
    const recette = this.recette(f.recette);
    if (f.etat === "en_cours" && f.jobId) {
      const job = this.#jobs.get(f.jobId);
      if (job.state === "queued" || job.state === "running") {
        this.#maj(f.id, { job_id: null });
        this.#jobs.cancel(f.jobId);
      }
    }
    const dir = this.#sites.dirOf(siteId);
    const refaire = existsSync(join(dir, "design.json"));
    if (refaire) copyFileSync(join(dir, "design.json"), join(dir, "design-precedent.json"));
    this.#maj(f.id, { etat: "en_cours", motif: null, motif_type: null, finished_at: null, tour: 0, cycle_json: "[]", renvois_json: JSON.stringify({ comptes: {}, messages: {} }), exigences_json: "[]", refaire: refaire ? 1 : 0 });
    this.#sites.update(siteId, { statut: "en_fabrication" });
    this.#events.append({ type: "atelier.refaire", subject: `site:${siteId}`, message: `Maquette à refaire depuis la direction artistique`, data: { fabricationId: f.id } });
    const debut = this.#brief(siteId) ? recette.refaire : recette.sequence[0]!;
    this.#demarrer(this.get(f.id), debut);
    return this.get(f.id);
  }

  /** Reprend une fabrication arrêtée sur une erreur technique, ou en attente du quota, à l'étape où elle s'est arrêtée. */
  reprendre(siteId: string): Fabrication {
    const f = this.#derniere(siteId);
    const attente = f.etat === "en_attente" && f.motifType === "quota";
    const arretee = f.etat === "arretee" && (f.motifType === "technique" || f.motifType === "annulee");
    if ((!arretee && !attente) || !f.etape) throw new HubError("Seule une fabrication arrêtée par une erreur, une annulation ou le quota se reprend.", 409);
    this.#maj(f.id, { etat: "en_cours", motif: null, motif_type: null, finished_at: null });
    this.#sites.update(siteId, { statut: "en_fabrication" });
    this.#demarrer(this.get(f.id), f.etape);
    return this.get(f.id);
  }

  /** Reprise automatique de toutes les fabrications en attente du quota. Retourne le nombre relancées. */
  reprendreEnAttente(): number {
    let n = 0;
    for (const f of this.list({ etat: "en_attente" })) {
      if (f.motifType !== "quota" || !f.etape) continue;
      this.#events.append({ type: "atelier.reprise", subject: `site:${f.siteId}`, message: `Nouvel essai après l'attente du quota : ${f.etape}`, data: { fabricationId: f.id } });
      this.reprendre(f.siteId);
      n++;
    }
    return n;
  }

  /**
   * Après le démarrage de la file : rattrape une fin de travail qui n'aurait pas été traitée (arrêt du hub entre
   * la fin d'un travail et la suite), et relance une étape dont le travail aurait disparu.
   */
  reprendreApresDemarrage(): number {
    let n = 0;
    for (const f of this.list({ etat: "en_cours" })) {
      if (!f.jobId) {
        if (f.etape) this.#demarrer(f, f.etape);
        n++;
        continue;
      }
      let job: Job | null = null;
      try {
        job = this.#jobs.get(f.jobId);
      } catch {
        job = null;
      }
      if (!job) {
        if (f.etape) this.#demarrer(f, f.etape);
        n++;
      } else if (job.state === "done" || job.state === "failed" || job.state === "cancelled") {
        this.#surFinDeTravail(job.id);
        n++;
      }
    }
    return n;
  }

  // ── Mécanique ───────────────────────────────────────────────────────────

  #derniere(siteId: string): Fabrication {
    const f = this.pourSite(siteId);
    if (!f) throw notFound("Fabrication de ce site");
    return f;
  }

  #brief(siteId: string): boolean {
    return existsSync(join(this.#sites.dirOf(siteId), "brief.json"));
  }

  #maj(id: string, cols: Record<string, string | number | null>): void {
    const keys = Object.keys(cols);
    this.#db.prepare(`UPDATE fabrications SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...Object.values(cols), now(), id);
  }

  #majPasse(f: Fabrication, jobId: string, patch: Partial<Passe>): void {
    const passes = f.passes.map((p) => (p.jobId === jobId ? { ...p, ...patch } : p));
    this.#maj(f.id, { passes_json: JSON.stringify(passes) });
  }

  #demarrer(f: Fabrication, etape: string): void {
    const recette = this.recette(f.recette);
    const def = recette.etapes[etape];
    if (!def) throw new HubError(`Étape inconnue dans la recette ${recette.id} : ${etape}`, 500);
    const site = this.#sites.get(f.siteId);
    const job = this.#jobs.enqueue({
      type: JOB_ETAPE,
      label: `${def.label} — ${site.companyName}${f.tour ? ` (tour ${f.tour})` : ""}`,
      subject: `site:${f.siteId}`,
      input: { fabricationId: f.id, etape },
      maxAttempts: def.essais ?? 1,
    });
    const passe: Passe = { n: f.passes.length + 1, etape, tour: f.tour, etat: "en_file", jobId: job.id, creeLe: now(), debut: null, fin: null, resume: null };
    this.#maj(f.id, { etape, job_id: job.id, passes_json: JSON.stringify([...this.get(f.id).passes, passe]) });
    this.#events.append({ type: "atelier.etape", subject: `site:${f.siteId}`, message: `${site.companyName} : ${def.label}${def.agent ? "" : " (code)"}`, data: { fabricationId: f.id, etape, jobId: job.id } });
  }

  /** Exécutant des travaux d'étape : charge l'état, lance l'étape de la recette, rend son issue. */
  async #executer(ctx: JobContext): Promise<Issue | { issue: "ignoree" }> {
    const input = ctx.job.input as { fabricationId: string; etape: string };
    // La file peut lancer le travail pendant même son ajout (avant que #demarrer n'ait noté son identifiant) :
    // on laisse d'abord #demarrer finir.
    await new Promise((r) => setImmediate(r));
    const f = this.get(input.fabricationId);
    // Un travail dépassé (étape relancée, refaire) ne fait rien.
    if (f.jobId !== ctx.job.id || f.etat !== "en_cours") return { issue: "ignoree" };
    const recette = this.recette(f.recette);
    const def = recette.etapes[input.etape]!;
    this.#majPasse(f, ctx.job.id, { etat: "en_cours", debut: now() });
    const site = this.#sites.get(f.siteId);
    const dernierTour = f.tours[f.tours.length - 1];
    ctx.progress({ label: def.label, pct: null });
    try {
      return await def.run({
        fabricationId: f.id,
        siteId: f.siteId,
        siteDir: this.#sites.dirOf(f.siteId),
        sitesDir: this.#sitesDir,
        company: this.#companies.get(site.companyId),
        recette,
        tour: f.tour,
        renvoi: f.renvois.messages[input.etape] ?? null,
        consignes: input.etape === recette.correction.etape ? (dernierTour?.consignes ?? []) : [],
        exigences: f.exigences,
        refaire: f.refaire,
        agents: this.#agents,
        kit: this.#kit,
        registre: this.#registre,
        job: ctx,
        now: this.#now,
      });
    } catch (err) {
      // Limite de l'abonnement (ADR-16) : la fabrication se met en pause tout de suite, avant toute
      // reprise de la file, et attend le rétablissement (reprise automatique ou manuelle).
      if (err instanceof QuotaClaudeError) {
        const actuelle = this.get(input.fabricationId);
        if (actuelle.jobId === ctx.job.id && actuelle.etat === "en_cours") {
          this.#majPasse(actuelle, ctx.job.id, { etat: "erreur", fin: now(), resume: "Limite de l'abonnement atteinte : mise en attente" });
          this.#maj(actuelle.id, { job_id: null });
          this.#attendre(this.get(actuelle.id));
        }
      }
      throw err;
    }
  }

  /** Mise en attente : le quota est épuisé, la fabrication repartira seule (ou à la demande). */
  #attendre(f: Fabrication): void {
    const motif = "Limite de l'abonnement Claude atteinte : en attente du rétablissement du quota.";
    this.#maj(f.id, { etat: "en_attente", motif, motif_type: "quota", finished_at: null });
    const site = this.#sites.get(f.siteId);
    this.#events.append({ type: "atelier.attente", subject: `site:${f.siteId}`, message: `${site.companyName} : ${motif}`, data: { fabricationId: f.id } });
  }

  #surFinDeTravail(jobId: string): void {
    const row = this.#db.prepare("SELECT id FROM fabrications WHERE job_id = ? AND etat = 'en_cours'").get(jobId) as { id: string } | undefined;
    if (!row) return;
    const f = this.get(row.id);
    const job = this.#jobs.get(jobId);
    const recette = this.recette(f.recette);
    const etape = f.etape!;
    const def = recette.etapes[etape]!;
    const fin = now();
    // Le travail est clos : on le détache tout de suite (une seconde notification ne fera rien).
    this.#maj(f.id, { job_id: null });

    if (job.state === "cancelled") {
      this.#majPasse(f, jobId, { etat: "annulee", fin, resume: "Travail annulé" });
      return this.#arreter(this.get(f.id), "annulee", `Fabrication annulée pendant l'étape « ${def.label} ».`);
    }
    if (job.state === "failed") {
      this.#majPasse(f, jobId, { etat: "erreur", fin, resume: job.error });
      return this.#arreter(this.get(f.id), "technique", `Erreur technique à l'étape « ${def.label} » : ${job.error ?? "inconnue"}`);
    }
    const issue = job.output as Issue | { issue: "ignoree" };
    if (issue.issue === "ignoree") return;
    const etat: EtatPasse =
      issue.issue === "controle" ? (issue.ok ? "ok" : "echec") : issue.issue === "suite" ? "ok" : issue.issue === "sautee" ? "sautee" : issue.issue === "renvoi" ? "renvoi" : "arret";
    this.#majPasse(f, jobId, { etat, fin, resume: issue.resume, sortie: issue.sortie });
    let g = this.get(f.id);
    // Un message de renvoi traité par son étape est consommé.
    if (g.renvois.messages[etape] && issue.issue !== "renvoi") {
      const messages = { ...g.renvois.messages };
      delete messages[etape];
      this.#maj(g.id, { renvois_json: JSON.stringify({ ...g.renvois, messages }) });
      g = this.get(f.id);
    }
    this.#events.append({
      type: issue.issue === "controle" && !issue.ok ? "atelier.echec" : "atelier.etape.fin",
      subject: `site:${g.siteId}`,
      message: `${def.label} : ${issue.resume}`.slice(0, 300),
      data: { fabricationId: g.id, etape, issue: issue.issue },
    });

    switch (issue.issue) {
      case "arret":
        return this.#arreter(g, "schema", issue.motif);
      case "renvoi": {
        // Un renvoi par cause (contrôle du design, schéma du kit…) et par étape : le second refus arrête.
        const cle = issue.cle ?? issue.vers;
        const deja = g.renvois.comptes[cle] ?? 0;
        const cible = recette.etapes[issue.vers];
        if (!cible) return this.#arreter(g, "technique", `Renvoi vers une étape inconnue : ${issue.vers}`);
        if (deja >= (issue.max ?? 1)) {
          return this.#arreter(g, "schema", `${cible.label} : refus encore présent après un renvoi. Message exact : ${issue.message}`);
        }
        this.#maj(g.id, { renvois_json: JSON.stringify({ comptes: { ...g.renvois.comptes, [cle]: deja + 1 }, messages: { ...g.renvois.messages, [issue.vers]: issue.message } }) });
        return this.#demarrer(this.get(g.id), issue.vers);
      }
      case "controle": {
        const cycle = [...g.cycle, { etape, ok: issue.ok, resume: issue.resume, consignes: issue.consignes }];
        this.#maj(g.id, { cycle_json: JSON.stringify(cycle) });
        if (!issue.ok && issue.bloqueLaSuite) return this.#decider(this.get(g.id));
        return this.#suivante(this.get(g.id), etape);
      }
      default:
        return this.#suivante(g, etape);
    }
  }

  #suivante(f: Fabrication, etape: string): void {
    const recette = this.recette(f.recette);
    if (etape === recette.correction.etape) {
      // Fin d'un tour de correction : retour aux contrôles, avec un cycle neuf.
      this.#maj(f.id, { cycle_json: "[]" });
      return this.#demarrer(this.get(f.id), recette.correction.retour);
    }
    const i = recette.sequence.indexOf(etape);
    const next = recette.sequence[i + 1];
    if (next) {
      // Un nouveau passage par les contrôles repart d'un cycle vide.
      if (next === recette.correction.retour) this.#maj(f.id, { cycle_json: "[]" });
      return this.#demarrer(this.get(f.id), next);
    }
    return this.#decider(f);
  }

  /** Bout de la chaîne : tout passe → à valider ; sinon tour de correction, ou arrêt après le dernier tour. */
  #decider(f: Fabrication): void {
    const recette = this.recette(f.recette);
    const echecs = f.cycle.filter((c) => !c.ok);
    const tours = f.tours.map((t, i) => (i === f.tours.length - 1 && t.fin === null ? { ...t, fin: now(), resultat: (echecs.length ? "echec" : "ok") as Tour["resultat"] } : t));
    this.#maj(f.id, { tours_json: JSON.stringify(tours) });
    const site = this.#sites.get(f.siteId);
    if (!echecs.length) {
      this.#maj(f.id, { etat: "a_valider", etape: null, finished_at: now() });
      const visuel = f.passes.filter((p) => p.etat === "ok" && p.sortie && typeof p.sortie === "object" && "moyenne" in (p.sortie as object)).pop();
      const moyenne = visuel ? Number((visuel.sortie as { moyenne: number }).moyenne) : null;
      this.#sites.update(f.siteId, { statut: "a_valider", ...(moyenne ? { qualiteNote: Math.round((moyenne / 5) * 100) } : {}) });
      this.#events.append({ type: "atelier.a_valider", subject: `site:${f.siteId}`, message: `Maquette de ${site.companyName} prête à valider (tous les contrôles passent)`, data: { fabricationId: f.id } });
      // Fabrication réussie : le site entre au registre (empreinte lue par les prochaines fabrications).
      this.#registre.inscrireEnFond(f.siteId);
      return;
    }
    if (f.tour >= recette.correction.toursMax) {
      const motif = `${recette.correction.toursMax} tours de correction sans réussir tous les contrôles. Encore en échec : ${echecs.map((e) => `${recette.etapes[e.etape]?.label ?? e.etape} — ${e.resume}`).join(" ; ")}`;
      return this.#arreter(this.get(f.id), "controle", motif);
    }
    this.#ouvrirTour(
      this.get(f.id),
      "auto",
      echecs.flatMap((e) => e.consignes),
    );
  }

  #ouvrirTour(f: Fabrication, origine: Tour["origine"], consignes: Consigne[]): void {
    const recette = this.recette(f.recette);
    const n = f.tours.length + 1;
    const dossier = join(this.#sites.dirOf(f.siteId), ".atelier", "corrections");
    mkdirSync(dossier, { recursive: true });
    const fichier = join(dossier, `tour-${n}.md`);
    writeFileSync(fichier, compilerConsignes(n, origine, consignes, f.exigences), "utf8");
    const tour: Tour = { n, origine, consignes, fichier: `.atelier/corrections/tour-${n}.md`, debut: now(), fin: null, resultat: null };
    this.#maj(f.id, { tour: origine === "auto" ? f.tour + 1 : 0, cycle_json: "[]", tours_json: JSON.stringify([...f.tours, tour]) });
    this.#events.append({
      type: "atelier.correction",
      subject: `site:${f.siteId}`,
      message: origine === "auto" ? `Tour de correction ${f.tour + 1}/${recette.correction.toursMax} : ${consignes.length} consigne(s)` : "Tour de correction sur demande du propriétaire",
      data: { fabricationId: f.id, tour: n },
    });
    this.#demarrer(this.get(f.id), recette.correction.etape);
  }

  #arreter(f: Fabrication, type: NonNullable<Fabrication["motifType"]>, motif: string): void {
    this.#maj(f.id, { etat: "arretee", motif, motif_type: type, finished_at: now() });
    this.#sites.update(f.siteId, { statut: "a_revoir" });
    const site = this.#sites.get(f.siteId);
    this.#events.append({ type: "atelier.arretee", subject: `site:${f.siteId}`, message: `Fabrication arrêtée (${site.companyName}) : ${motif}`.slice(0, 400), data: { fabricationId: f.id, type } });
  }
}
