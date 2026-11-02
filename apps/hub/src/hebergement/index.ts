/**
 * Hébergement des démos (brief F, ADR-15) : chaque maquette validée part en un clic sur
 * `https://<slug>.demo.<domaine>` (un seul Worker Cloudflare « liverdian-demos » + Static Assets,
 * une route par sous-domaine), disparaît automatiquement à J+30, et ses visites sont comptées
 * par le Worker dans Workers KV puis relevées ici (sans IP ni donnée personnelle).
 */
import { createHmac, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { HubError } from "../domain/errors.ts";
import { now, parseJson, type Db } from "../db/database.ts";
import type { EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import type { Site, SiteService } from "../domain/sites.ts";
import type { JobContext, JobQueue } from "../jobs/job-queue.ts";
import { Cloudflare, CloudflareError, type FetchLike } from "./cloudflare.ts";
import { Wrangler, ecrireConfig, runProcess, wranglerDuDepot } from "./deploy.ts";
import { slugifier, slugUnique } from "./slug.ts";
import type { Spawner } from "../agents/claude-cli.ts";

/** Limites publiées des Static Assets de Cloudflare : refus avant de les dépasser, message clair. */
export const LIMITES = {
  fichiers: 20_000,
  tailleFichier: 25 * 1024 * 1024, // 25 Mio
  total: 10 * 1024 * 1024 * 1024, // 10 Gio
} as const;

/** Clés que l'interface peut enregistrer dans .data/settings/secrets.json (jamais renvoyées, jamais journalisées). */
export const SECRETS = {
  CLOUDFLARE_ACCOUNT_ID: { libelle: "Identifiant du compte Cloudflare", format: /^[0-9a-f]{32}$/i },
  CLOUDFLARE_API_TOKEN: { libelle: "Jeton Cloudflare", format: /^[A-Za-z0-9_-]{30,200}$/ },
  CLOUDFLARE_DEMOS_APERCU_SECRET: { libelle: "Secret d'aperçu des démos", format: /^[0-9a-f]{64}$/i },
} as const;
export type NomSecret = keyof typeof SECRETS;

export type DemoEtat = "en_ligne" | "expiree" | "retiree";

export type Demo = {
  siteId: string;
  siteNom: string;
  slug: string;
  url: string;
  etat: DemoEtat;
  publieLe: string | null;
  expireLe: string | null;
  retireeLe: string | null;
  visites: number;
  derniereVisite: string | null;
  premiereOuvertureLe: string | null;
  dernierePublicationLe: string | null;
};

const JOUR_MS = 24 * 3600_000;
export const DUREE_DEMO_JOURS = 30;

function fromRow(r: Record<string, unknown>): Demo {
  return {
    siteId: String(r.site_id),
    siteNom: String(r.site_nom ?? ""),
    slug: String(r.slug),
    url: String(r.url),
    etat: r.etat as DemoEtat,
    publieLe: (r.publie_le as string | null) ?? null,
    expireLe: (r.expire_le as string | null) ?? null,
    retireeLe: (r.retiree_le as string | null) ?? null,
    visites: Number(r.visites ?? 0),
    derniereVisite: (r.derniere_visite as string | null) ?? null,
    premiereOuvertureLe: (r.premiere_ouverture_le as string | null) ?? null,
    dernierePublicationLe: (r.derniere_publication_le as string | null) ?? null,
  };
}

const SELECT_DEMOS = "SELECT d.*, COALESCE(c.nom_commercial, c.raison_sociale) AS site_nom FROM demos d JOIN sites s ON s.id = d.site_id JOIN companies c ON c.id = s.company_id";

/** Point du test de connexion : vert, orange (à créer à la première publication) ou rouge (à corriger). */
export type PointTest = { ok: boolean; niveau: "ok" | "avertissement" | "erreur"; titre: string; detail: string };

export type HebergementOptions = {
  /** Fetch injectable (tests ; la vérification publique des démos l'utilise aussi). */
  fetch?: FetchLike;
  /** Spawner injectable (tests : faux wrangler). */
  spawner?: Spawner;
  now?: () => Date;
};

const PublierInput = z.object({ siteId: z.string().min(1) });

export class Hebergement {
  readonly #db: Db;
  readonly #events: EventLog;
  readonly #settings: Settings;
  readonly #sites: SiteService;
  readonly #jobs: JobQueue;
  readonly #dataDir: string;
  readonly #fetch: FetchLike;
  readonly #spawner?: Spawner;
  readonly #now: () => Date;
  #minuteurReleve: ReturnType<typeof setInterval> | null = null;
  #minuteurExpiration: ReturnType<typeof setInterval> | null = null;

  constructor(deps: { db: Db; events: EventLog; settings: Settings; sites: SiteService; jobs: JobQueue; dataDir: string; options?: HebergementOptions }) {
    this.#db = deps.db;
    this.#events = deps.events;
    this.#settings = deps.settings;
    this.#sites = deps.sites;
    this.#jobs = deps.jobs;
    this.#dataDir = deps.dataDir;
    this.#fetch = deps.options?.fetch ?? ((input, init) => fetch(input, init));
    this.#spawner = deps.options?.spawner;
    this.#now = deps.options?.now ?? (() => new Date());

    deps.jobs.register("hebergement.publier", {
      run: (ctx) => this.#publier(ctx),
    });
    deps.jobs.register("hebergement.retirer", {
      run: (ctx) => this.#retirer(ctx),
    });
    deps.jobs.register("hebergement.prolonger", {
      run: (ctx) => this.#prolonger(ctx),
    });
    deps.jobs.register("hebergement.expiration", {
      run: (ctx) => this.#expiration(ctx),
    });
  }

  // ── Dossier de l'hébergement ────────────────────────────────────────────

  /** Dossier de l'assemblage des démos (.data/hebergement). */
  dirHebergement(): string {
    return join(this.#dataDir, "hebergement");
  }

  dirDemos(): string {
    return join(this.dirHebergement(), "demos");
  }

  // ── Configuration et secrets ────────────────────────────────────────────

  #domaine(): string {
    return this.#settings.get("hebergement.domaine").trim().toLowerCase();
  }

  /** Date d'échéance d'une nouvelle publication (J+30), sur l'horloge du service (testable). */
  #echeance(): string {
    return new Date(this.#now().getTime() + DUREE_DEMO_JOURS * JOUR_MS).toISOString();
  }

  /** Hébergement prêt à publier : domaine, compte et jeton présents. */
  configure(): boolean {
    return !!this.#domaine() && !!this.#settings.secret("CLOUDFLARE_ACCOUNT_ID") && !!this.#settings.secret("CLOUDFLARE_API_TOKEN");
  }

  #client(): Cloudflare {
    const accountId = this.#settings.secret("CLOUDFLARE_ACCOUNT_ID");
    const token = this.#settings.secret("CLOUDFLARE_API_TOKEN");
    if (!accountId || !token) throw new HubError("L'hébergement n'est pas configuré : renseignez le compte et le jeton Cloudflare dans Réglages › Hébergement.", 400);
    return new Cloudflare({ accountId, token, fetch: this.#fetch });
  }

  #wrangler(): Wrangler {
    return new Wrangler({
      configDir: this.dirHebergement(),
      workerFile: join(process.cwd(), "apps", "hub", "hebergement", "worker", "src", "worker.ts"),
      binary: this.#settings.get("hebergement.wranglerBin").trim() || null,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: this.#settings.secret("CLOUDFLARE_ACCOUNT_ID") ?? "",
        CLOUDFLARE_API_TOKEN: this.#settings.secret("CLOUDFLARE_API_TOKEN") ?? "",
        WRANGLER_SEND_METRICS: "false",
      },
      spawner: this.#spawner,
    });
  }

  /** Enregistre (ou retire, valeur null) une clé dans .data/settings/secrets.json ; l'environnement reste prioritaire. */
  enregistrerSecret(nom: NomSecret, valeur: string | null): void {
    const def = SECRETS[nom];
    const v = valeur?.trim() || null;
    if (v && !def.format.test(v)) throw new HubError(`${def.libelle} : format inattendu (vérifiez le copier-coller)`);
    const dir = join(this.#dataDir, "settings");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "secrets.json");
    const actuel = existsSync(file) ? parseJson<Record<string, unknown>>(readFileSync(file, "utf8"), {}) : {};
    if (v) actuel[nom] = v;
    else delete actuel[nom];
    writeFileSync(`${file}.tmp`, JSON.stringify(actuel, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    this.#events.append({ type: "settings.secret", message: `${def.libelle} ${v ? "enregistrée" : "retirée"}` });
  }

  /** Secret HMAC des jetons d'aperçu (généré une fois, partagé avec le Worker via `wrangler secret bulk`). */
  #apercuSecret(): string {
    const existant = this.#settings.secret("CLOUDFLARE_DEMOS_APERCU_SECRET");
    if (existant) return existant;
    const nouveau = randomBytes(32).toString("hex");
    this.enregistrerSecret("CLOUDFLARE_DEMOS_APERCU_SECRET", nouveau);
    return nouveau;
  }

  /** Jeton d'aperçu d'un slug : HMAC-SHA256(secret, slug), le même calcul que le Worker (WebCrypto). */
  apercuJeton(slug: string): string {
    return createHmac("sha256", this.#apercuSecret()).update(slug).digest("hex");
  }

  // ── État, démos ──────────────────────────────────────────────────────────

  demos(): Demo[] {
    return (this.#db.prepare(`${SELECT_DEMOS} ORDER BY d.publie_le DESC`).all() as Record<string, unknown>[]).map(fromRow);
  }

  demoDe(siteId: string): Demo | null {
    const row = this.#db.prepare(`${SELECT_DEMOS} WHERE d.site_id = ?`).get(siteId) as Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  etat() {
    const demo = (d: Demo) => ({ ...d, apercuUrl: d.etat === "en_ligne" ? `${d.url}?apercu=${this.apercuJeton(d.slug)}` : null });
    return {
      domaine: this.#domaine(),
      wranglerBin: this.#settings.get("hebergement.wranglerBin"),
      configure: this.configure(),
      comptePresent: !!this.#settings.secret("CLOUDFLARE_ACCOUNT_ID"),
      jetonPresent: !!this.#settings.secret("CLOUDFLARE_API_TOKEN"),
      demos: this.demos().map(demo),
    };
  }

  /** Ce qui manque avant de pouvoir publier (phrases courtes pour le bouton grisé). */
  manques(): string[] {
    const m: string[] = [];
    if (!this.#domaine()) m.push("le domaine n'est pas renseigné (Réglages › Hébergement)");
    if (!this.#settings.secret("CLOUDFLARE_ACCOUNT_ID")) m.push("l'identifiant du compte Cloudflare n'est pas renseigné");
    if (!this.#settings.secret("CLOUDFLARE_API_TOKEN")) m.push("le jeton Cloudflare n'est pas renseigné");
    return m;
  }

  // ── Tester la connexion ─────────────────────────────────────────────────

  /** Vérifie le jeton, ses permissions, la zone : dit précisément ce qui manque (rien n'est créé). */
  async tester(): Promise<{ ok: boolean; points: PointTest[] }> {
    const points: PointTest[] = [];
    const ajoute = (p: PointTest) => points.push(p);
    const domaine = this.#domaine();
    if (!domaine) {
      ajoute({ ok: false, niveau: "erreur", titre: "Domaine", detail: "Aucun domaine : renseignez-le dans Réglages › Hébergement." });
      return { ok: false, points };
    }
    if (!this.#settings.secret("CLOUDFLARE_ACCOUNT_ID") || !this.#settings.secret("CLOUDFLARE_API_TOKEN")) {
      ajoute({ ok: false, niveau: "erreur", titre: "Compte et jeton", detail: "Enregistrez d'abord l'identifiant du compte et le jeton Cloudflare." });
      return { ok: false, points };
    }
    try {
      wranglerDuDepot();
      ajoute({ ok: true, niveau: "ok", titre: "Programme de déploiement", detail: "wrangler est installé dans le dépôt (aucune installation globale)." });
    } catch (err) {
      ajoute({ ok: false, niveau: "erreur", titre: "Programme de déploiement", detail: (err as Error).message });
    }

    const client = this.#client();
    let zoneId: string | null = null;

    try {
      const jeton = await client.verifierJeton();
      ajoute({ ok: true, niveau: "ok", titre: "Jeton Cloudflare", detail: `Jeton reconnu par Cloudflare (statut : ${jeton.statut}).` });
    } catch (err) {
      const e = err as CloudflareError;
      ajoute({ ok: false, niveau: "erreur", titre: "Jeton Cloudflare", detail: e.status === 401 ? "Le jeton est refusé par Cloudflare : vérifiez le copier-coller dans Réglages › Hébergement." : `Impossible de vérifier le jeton : ${e.message}.` });
    }

    try {
      const compte = await client.compte();
      ajoute({ ok: true, niveau: "ok", titre: "Compte", detail: `Le jeton voit le compte « ${compte.name} ».` });
    } catch (err) {
      const e = err as CloudflareError;
      ajoute({ ok: false, niveau: "erreur", titre: "Compte", detail: `Le jeton ne voit pas le compte indiqué (${e.status === 404 ? "identifiant introuvable" : e.message}) : vérifiez l'identifiant du compte dans Réglages › Hébergement.` });
    }

    try {
      const zone = await client.zone(domaine);
      if (!zone) ajoute({ ok: false, niveau: "erreur", titre: `Zone « ${domaine} »`, detail: "Ce domaine n'est pas sur ce compte Cloudflare : ajoutez le site sur dash.cloudflare.com, puis relancez le test." });
      else {
        zoneId = zone.id;
        ajoute({ ok: true, niveau: "ok", titre: `Zone « ${domaine} »`, detail: `Domaine présent sur le compte (zone ${zone.status}).` });
      }
    } catch (err) {
      ajoute({ ok: false, niveau: "erreur", titre: `Zone « ${domaine} »`, detail: `Impossible de consulter la zone : ${(err as Error).message}. Il faut la permission Zone › DNS › Read (et Zone › Zone › Read).` });
    }

    if (zoneId) {
      try {
        const r = await client.enregistrementWildcard(zoneId, `*.demo.${domaine}`);
        ajoute(r.present
          ? { ok: true, niveau: "ok", titre: "Adresses *.demo", detail: `L'enregistrement « *.demo.${domaine} » existe déjà.` }
          : { ok: true, niveau: "avertissement", titre: "Adresses *.demo", detail: `L'enregistrement « *.demo.${domaine} » sera créé à la première publication (permission Zone › DNS › Edit nécessaire).` });
      } catch (err) {
        const e = err as CloudflareError;
        ajoute({ ok: false, niveau: "erreur", titre: "Adresses *.demo", detail: `Impossible de consulter les enregistrements DNS (${e.message}) : il faut la permission Zone › DNS › Read.` });
      }
      try {
        const r = await client.routeWorker(zoneId, `*.demo.${domaine}/*`);
        ajoute(r.present
          ? { ok: true, niveau: "ok", titre: "Route du Worker", detail: "La route « *.demo.<domaine>/* » vers le Worker existe déjà." }
          : { ok: true, niveau: "avertissement", titre: "Route du Worker", detail: "La route sera créée à la première publication (permission Zone › Workers Routes › Edit nécessaire)." });
      } catch (err) {
        const e = err as CloudflareError;
        ajoute({ ok: false, niveau: "erreur", titre: "Route du Worker", detail: `Impossible de consulter les routes (${e.message}) : il faut la permission Zone › Workers Routes › Edit.` });
      }
    }

    try {
      const liste = await client.kvNamespaceList();
      ajoute({ ok: true, niveau: "ok", titre: "Compteur de visites (KV)", detail: liste.some((n) => n.title === "liverdian-demos") ? "L'espace « liverdian-demos » existe déjà." : "L'espace de comptage sera créé à la première publication (permission Account › Workers KV Storage › Edit nécessaire)." });
    } catch (err) {
      const e = err as CloudflareError;
      ajoute({ ok: false, niveau: "erreur", titre: "Compteur de visites (KV)", detail: `Impossible de consulter les espaces KV (${e.message}) : il faut la permission Account › Workers KV Storage › Edit.` });
    }

    try {
      const deja = await client.scriptDeploye();
      ajoute(deja
        ? { ok: true, niveau: "ok", titre: "Worker « liverdian-demos »", detail: "Le Worker est déjà déployé." }
        : { ok: true, niveau: "avertissement", titre: "Worker « liverdian-demos »", detail: "Pas encore déployé : il le sera à la première publication (permission Account › Workers Scripts › Edit nécessaire)." });
    } catch (err) {
      const e = err as CloudflareError;
      ajoute({ ok: false, niveau: "erreur", titre: "Worker « liverdian-demos »", detail: `Impossible de consulter le Worker (${e.message}) : il faut la permission Account › Workers Scripts › Edit.` });
    }

    return { ok: points.every((p) => p.niveau !== "erreur"), points };
  }

  // ── Actions (enfilées comme travaux, reprises après redémarrage) ────────

  /** « Publier » : vérifie la maquette, copie le dist, déploie, vérifie en vrai, puis passe le site en ligne. */
  async demanderPublier(siteId: string): Promise<{ jobId: string }> {
    this.#verifierPublierPossible(siteId);
    const actif = this.#db
      .prepare("SELECT id FROM jobs WHERE type = 'hebergement.publier' AND subject = ? AND state IN ('queued', 'running')")
      .get(`site:${siteId}`);
    if (actif) return { jobId: String((actif as { id: string }).id) };
    const site = this.#sites.get(siteId);
    const job = this.#jobs.enqueue({ type: "hebergement.publier", label: `Mise en ligne de la démo de ${site.companyName}`, subject: `site:${siteId}`, input: { siteId } });
    return { jobId: job.id };
  }

  // ── Vérifications avant publication ─────────────────────────────────────

  #verifierPublierPossible(siteId: string): Site {
    const manques = this.manques();
    if (manques.length) throw new HubError(`Publication impossible : ${manques.join(" ; ")}.`, 400);
    const site = this.#sites.get(siteId);
    if (site.statut === "a_valider") throw new HubError("Cette maquette n'est pas encore validée : validez-la d'abord (elle doit être « Démo prête »).", 409);
    if (site.statut !== "demo_prete" && site.statut !== "demo_en_ligne" && site.statut !== "livre") {
      throw new HubError(`Statut « ${site.statut} » : seules les maquettes validées (ou déjà en ligne) peuvent être publiées.`, 409);
    }
    // Mode démo actif (bandeau + noindex) : lu dans le site.json écrit par l'atelier.
    const siteJson = parseJson<{ demo?: { actif?: boolean } | null } | null>(readFileSync(join(site.dossier, "src", "data", "site.json"), "utf8"), null);
    if (!siteJson?.demo?.actif) throw new HubError("La démo n'est pas activée pour cette maquette (site.json sans demo.actif) : relancez sa fabrication.", 409);
    const index = join(site.dossier, "dist", "index.html");
    if (!existsSync(index)) throw new HubError("Cette maquette n'est pas construite (dist/ absent) : reprenez sa fabrication.", 409);
    const html = readFileSync(index, "utf8");
    if (!html.includes("data-bandeau-demo") || !html.includes("noindex")) {
      throw new HubError("Le bandeau « maquette de démonstration » ou la balise noindex manquent dans la maquette construite : relancez sa fabrication.", 409);
    }
    // Dernier contrôle vert (le kit l'écrit à chaque contrôle).
    const check = parseJson<{ ok?: boolean }>(readFileSync(join(site.dossier, ".check", "check-report.json"), "utf8"), {});
    if (check.ok !== true) throw new HubError("Le dernier contrôle du kit n'est pas vert : reprenez la fabrication jusqu'à ce qu'il passe.", 409);
    // Limites des Static Assets de Cloudflare : refus immédiat, avant tout travail.
    this.#verifierLimites(this.#compterDist(site));
    return site;
  }

  /** Compte les fichiers du dist (taille max et total compris). */
  #compterDist(site: Site): { fichiers: number; plusGros: number; total: number } {
    const dist = join(site.dossier, "dist");
    let fichiers = 0;
    let plusGros = 0;
    let total = 0;
    const compter = (dir: string): void => {
      for (const nom of readdirSync(dir)) {
        const p = join(dir, nom);
        const st = statSync(p);
        if (st.isDirectory()) compter(p);
        else {
          fichiers++;
          plusGros = Math.max(plusGros, st.size);
          total += st.size;
        }
      }
    };
    compter(dist);
    return { fichiers, plusGros, total };
  }

  #verifierLimites(d: { fichiers: number; plusGros: number; total: number }): void {
    if (d.fichiers > LIMITES.fichiers) throw new HubError(`La maquette contient ${d.fichiers} fichiers : Cloudflare en accepte ${LIMITES.fichiers} au plus par déploiement.`, 413);
    if (d.plusGros > LIMITES.tailleFichier) {
      throw new HubError(`Un fichier de la maquette dépasse ${Math.round(LIMITES.tailleFichier / 1048576)} Mio : allégez les images avant de publier.`, 413);
    }
    if (d.total > LIMITES.total) throw new HubError(`La maquette pèse ${(d.total / 1073741824).toFixed(1)} Gio : Cloudflare en accepte 10 au plus.`, 413);
  }

  // ── Travail : publier ───────────────────────────────────────────────────

  async #publier(ctx: JobContext): Promise<Demo> {
    const { siteId } = PublierInput.parse(ctx.job.input);
    const site = this.#verifierPublierPossible(siteId);
    ctx.progress({ label: "Vérification de la maquette…", pct: 5 });

    // Slug : conservé si la démo a déjà été publiée, sinon forgé du nom commercial (unique, sans accents).
    let demo = this.demoDe(siteId);
    const slug = demo?.slug ?? slugUnique(slugifier(site.companyName), new Set(this.demos().map((d) => d.slug)));
    const domaine = this.#domaine();
    const url = `https://${slug}.demo.${domaine}/`;
    // Republication d'une démo en ligne : on garde son échéance ; sinon J+30 à partir d'aujourd'hui.
    const expireLe = demo?.etat === "en_ligne" && demo.expireLe ? demo.expireLe : this.#echeance();
    // La maquette a été fabriquée plus tôt : son bandeau porte « fabrication + 30 j ». On l'aligne sur le retrait réel.
    if (this.#dateBandeau(site) !== expireLe.slice(0, 10)) {
      ctx.progress({ label: "Date de suppression mise à jour sur la maquette…", pct: 10 });
      await this.#dater(site, expireLe, ctx);
    }

    // Assemblage : le dist du site devient le dossier du slug (limites des Static Assets contrôlées avant).
    ctx.progress({ label: "Préparation de la maquette…", pct: 15 });
    this.#copierDist(site, slug);
    ctx.progress({ label: "Déploiement sur Cloudflare…", pct: 35 });

    const client = this.#client();
    const zone = await client.zone(domaine);
    if (!zone) throw new HubError(`La zone « ${domaine} » n'est pas sur le compte Cloudflare : vérifiez la configuration.`, 500);
    if (!(await client.enregistrementWildcard(zone.id, `*.demo.${domaine}`)).present) {
      await client.creerWildcard(zone.id, `*.demo.${domaine}`, domaine);
    }
    if (!(await client.routeWorker(zone.id, `*.demo.${domaine}/*`)).present) {
      await client.creerRoute(zone.id, `*.demo.${domaine}/*`, "liverdian-demos");
    }
    const nsId = await client.kvNamespace();
    this.#settings.set("hebergement.kvNamespaceId", nsId);

    const wrangler = this.#wrangler();
    ecrireConfig(this.dirHebergement(), wrangler.workerFile, nsId, domaine);
    const r = await wrangler.deployer((l) => ctx.log("info", l));
    ctx.log("info", `wrangler : déploiement terminé en ${Math.round(r.dureeMs / 1000)} s`);
    await wrangler.secrets({ APERCU_SECRET: this.#apercuSecret() });
    ctx.progress({ label: "Vérification en ligne…", pct: 75 });

    await this.#verifierEnLigne(url, ctx.signal);

    // La fiche dans KV permet au Worker d'afficher « Cette maquette a expiré » après retrait.
    await client.ecrireMeta(nsId, slug, { etat: "en_ligne", publieLe: this.#now().toISOString(), expireLe, nom: site.companyName });

    const at = now();
    this.#db
      .prepare(
        `INSERT INTO demos (site_id, slug, url, etat, publie_le, expire_le, derniere_publication_le, updated_at) VALUES (?, ?, ?, 'en_ligne', ?, ?, ?, ?)
         ON CONFLICT(site_id) DO UPDATE SET slug = excluded.slug, url = excluded.url, etat = 'en_ligne', retiree_le = NULL,
           publie_le = COALESCE(demos.publie_le, excluded.publie_le), expire_le = excluded.expire_le,
           derniere_publication_le = excluded.derniere_publication_le, updated_at = excluded.updated_at`,
      )
      .run(siteId, slug, url, at, expireLe, at, at);
    this.#sites.update(siteId, { statut: "demo_en_ligne", urlDemo: url });
    this.#events.append({
      type: "hebergement.publie",
      subject: `site:${siteId}`,
      message: `Démo en ligne : ${url} (retirée automatiquement le ${new Date(expireLe).toLocaleDateString("fr-FR")})`,
    });
    ctx.progress({ label: "En ligne", pct: 100 });
    return this.demoDe(siteId)!;
  }

  /** Date de suppression écrite dans le bandeau de la maquette (AAAA-MM-JJ), ou null. */
  #dateBandeau(site: Site): string | null {
    const siteJsonPath = join(site.dossier, "src", "data", "site.json");
    if (!existsSync(siteJsonPath)) return null;
    return parseJson<{ demo?: { dateSuppression?: string } }>(readFileSync(siteJsonPath, "utf8"), {}).demo?.dateSuppression ?? null;
  }

  /**
   * Le bandeau annonce la date de suppression : elle est cuite dans le dist, on la change dans le
   * site.json (format AAAA-MM-JJ exigé par le schéma du kit) puis on reconstruit. Le bandeau ne doit
   * jamais promettre une autre date que celle du retrait réel.
   */
  async #dater(site: Site, echeance: string, ctx: JobContext): Promise<void> {
    const jour = echeance.slice(0, 10);
    const siteJsonPath = join(site.dossier, "src", "data", "site.json");
    const siteJson = parseJson<{ demo?: { dateSuppression?: string } }>(readFileSync(siteJsonPath, "utf8"), {});
    siteJson.demo = { ...(siteJson.demo ?? {}), dateSuppression: jour };
    writeFileSync(siteJsonPath, JSON.stringify(siteJson, null, 2) + "\n", "utf8");

    const astro = join(site.dossier, "node_modules", "astro", "bin", "astro.mjs");
    if (!existsSync(astro)) throw new HubError("Impossible de reconstruire la maquette (Astro absent du site) : relancez sa fabrication.", 500);
    const build = await runProcess({
      binary: process.execPath,
      cmd: [astro, "build"],
      cwd: site.dossier,
      env: { ...process.env, FORCE_COLOR: "0" },
      timeoutMs: 10 * 60_000,
      signal: ctx.signal,
      spawner: this.#spawner,
    });
    if (build.code !== 0) throw new HubError(`Reconstruction de la maquette impossible : ${build.stderr.trim().slice(-500) || "échec du build Astro"}`, 500);
  }

  /** Copie `dist/` dans l'assemblage sous le slug (limites déjà vérifiées au refus initial et au travail). */
  #copierDist(site: Site, slug: string): void {
    this.#verifierLimites(this.#compterDist(site));
    const cible = join(this.dirDemos(), slug);
    rmSync(cible, { recursive: true, force: true });
    cpSync(join(site.dossier, "dist"), cible, { recursive: true });
  }

  /** La démo doit répondre 200 avec son bandeau ; le Worker peut mettre quelques secondes à se propager. */
  async #verifierEnLigne(url: string, signal?: AbortSignal): Promise<void> {
    for (let essai = 1; essai <= 6; essai++) {
      try {
        const res = await this.#fetch(url, { signal: AbortSignal.timeout(10_000) });
        const texte = await res.text();
        if (res.status === 200 && texte.includes("data-bandeau-demo")) return;
        if (res.status === 410) throw new HubError(`La démo répond « expirée » : la fiche KV contredit l'état local. Réessayez dans une minute.`, 502);
      } catch (err) {
        if (err instanceof HubError && err.status !== 409) throw err;
        /* réseau ou pas encore propagé : on retente */
      }
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, 4_000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          rej(new HubError("Publication annulée", 409));
        }, { once: true });
      });
    }
    throw new HubError(`La démo ne répond pas encore à ${url} : réessayez dans une minute (la propagation peut prendre un moment).`, 502);
  }

  // ── Travail : retirer ───────────────────────────────────────────────────

  async demanderRetirer(siteId: string): Promise<{ jobId: string }> {
    const demo = this.demoDe(siteId);
    if (!demo || demo.etat !== "en_ligne") throw new HubError("Aucune démo en ligne pour ce site.", 404);
    const site = this.#sites.get(siteId);
    const job = this.#jobs.enqueue({ type: "hebergement.retirer", label: `Retrait de la démo de ${site.companyName}`, subject: `site:${siteId}`, input: { siteId } });
    return { jobId: job.id };
  }

  async #retirer(ctx: JobContext): Promise<void> {
    const { siteId } = PublierInput.parse(ctx.job.input);
    const demo = this.demoDe(siteId);
    if (!demo || demo.etat !== "en_ligne") throw new HubError("Aucune démo en ligne pour ce site.", 404);
    ctx.progress({ label: "Retrait de la démo…", pct: 20 });
    rmSync(join(this.dirDemos(), demo.slug), { recursive: true, force: true });
    const wrangler = this.#wrangler();
    ecrireConfig(this.dirHebergement(), wrangler.workerFile, this.#settings.get("hebergement.kvNamespaceId"), this.#domaine());
    await wrangler.deployer((l) => ctx.log("info", l));
    const at = this.#now().toISOString();
    try {
      await this.#client().ecrireMeta(this.#settings.get("hebergement.kvNamespaceId"), demo.slug, { etat: "retiree", retireeLe: at, expireLe: demo.expireLe });
    } catch {
      /* la fiche KV est un confort : la page 404 en français reste correcte sans elle */
    }
    this.#db.prepare("UPDATE demos SET etat = 'retiree', retiree_le = ?, updated_at = ? WHERE site_id = ?").run(at, now(), siteId);
    this.#sites.update(siteId, { statut: "demo_prete", urlDemo: null });
    this.#events.append({ type: "hebergement.retire", subject: `site:${siteId}`, message: `Démo retirée : ${demo.url}` });
    ctx.progress({ label: "Retirée", pct: 100 });
  }

  // ── Travail : prolonger ─────────────────────────────────────────────────

  async demanderProlonger(siteId: string): Promise<{ jobId: string }> {
    const demo = this.demoDe(siteId);
    if (!demo || demo.etat !== "en_ligne") throw new HubError("Aucune démo en ligne pour ce site.", 404);
    const site = this.#sites.get(siteId);
    const job = this.#jobs.enqueue({ type: "hebergement.prolonger", label: `Prolongation de la démo de ${site.companyName}`, subject: `site:${siteId}`, input: { siteId } });
    return { jobId: job.id };
  }

  async #prolonger(ctx: JobContext): Promise<Demo> {
    const { siteId } = PublierInput.parse(ctx.job.input);
    const demo = this.demoDe(siteId);
    if (!demo || demo.etat !== "en_ligne") throw new HubError("Aucune démo en ligne pour ce site.", 404);
    const site = this.#sites.get(siteId);
    const nouvelle = this.#echeance();
    ctx.progress({ label: "Nouvelle date sur la maquette…", pct: 15 });
    await this.#dater(site, nouvelle, ctx);

    ctx.progress({ label: "Déploiement de la nouvelle date…", pct: 50 });
    this.#copierDist(site, demo.slug);
    const wrangler = this.#wrangler();
    ecrireConfig(this.dirHebergement(), wrangler.workerFile, this.#settings.get("hebergement.kvNamespaceId"), this.#domaine());
    await wrangler.deployer((l) => ctx.log("info", l));
    await this.#verifierEnLigne(demo.url, ctx.signal);

    try {
      await this.#client().ecrireMeta(this.#settings.get("hebergement.kvNamespaceId"), demo.slug, { etat: "en_ligne", publieLe: demo.publieLe, expireLe: nouvelle, nom: site.companyName });
    } catch {
      /* non bloquant : la date d'expiration locale fait foi */
    }
    this.#db.prepare("UPDATE demos SET expire_le = ?, derniere_publication_le = ?, updated_at = ? WHERE site_id = ?").run(nouvelle, now(), now(), siteId);
    this.#events.append({
      type: "hebergement.prolonge",
      subject: `site:${siteId}`,
      message: `Démo prolongée jusqu'au ${new Date(nouvelle).toLocaleDateString("fr-FR")} : ${demo.url}`,
    });
    ctx.progress({ label: "Prolongée", pct: 100 });
    return this.demoDe(siteId)!;
  }

  // ── Expiration automatique (travail quotidien) ──────────────────────────

  #expirationDue(): Demo[] {
    const limite = this.#now().toISOString();
    return (this.#db.prepare(`${SELECT_DEMOS} WHERE d.etat = 'en_ligne' AND d.expire_le <= ?`).all(limite) as Record<string, unknown>[]).map(fromRow);
  }

  /** Enfile le travail d'expiration s'il n'est pas déjà prévu et que l'hébergement est configuré. */
  planifierExpiration(): void {
    if (!this.configure()) return;
    if (!this.#expirationDue().length) return;
    const actif = this.#db.prepare("SELECT id FROM jobs WHERE type = 'hebergement.expiration' AND state IN ('queued', 'running')").get();
    if (actif) return;
    this.#jobs.enqueue({ type: "hebergement.expiration", label: "Expiration des démos arrivées à échéance", subject: null, input: {} });
  }

  async #expiration(ctx: JobContext): Promise<{ retirees: number }> {
    if (!this.configure()) return { retirees: 0 };
    const dues = this.#expirationDue();
    if (!dues.length) return { retirees: 0 };
    ctx.progress({ label: `Retrait de ${dues.length} démo(s) expirée(s)…`, pct: 20 });
    const wrangler = this.#wrangler();
    const nsId = this.#settings.get("hebergement.kvNamespaceId");
    const client = this.#client();
    for (const demo of dues) {
      rmSync(join(this.dirDemos(), demo.slug), { recursive: true, force: true });
      try {
        await client.ecrireMeta(nsId, demo.slug, { etat: "expiree", expireLe: demo.expireLe, retireeLe: demo.retireeLe });
      } catch {
        /* non bloquant */
      }
      this.#db.prepare("UPDATE demos SET etat = 'expiree', updated_at = ? WHERE site_id = ?").run(now(), demo.siteId);
      this.#sites.update(demo.siteId, { statut: "demo_prete", urlDemo: null });
      this.#events.append({ type: "hebergement.expiree", subject: `site:${demo.siteId}`, message: `Démo arrivée à échéance et retirée : ${demo.url}` });
    }
    ecrireConfig(this.dirHebergement(), wrangler.workerFile, nsId, this.#domaine());
    await wrangler.deployer((l) => ctx.log("info", l));
    ctx.progress({ label: "Expirées", pct: 100 });
    return { retirees: dues.length };
  }

  // ── Relevé des visites ──────────────────────────────────────────────────

  /** Lit les compteurs du Worker (KV) et met la base à jour ; événement à la première ouverture. */
  async releverVisites(): Promise<{ configure: boolean; relevees: number }> {
    if (!this.configure()) return { configure: false, relevees: 0 };
    const nsId = this.#settings.get("hebergement.kvNamespaceId");
    if (!nsId) return { configure: true, relevees: 0 };
    const client = this.#client();
    let relevees = 0;
    for (const demo of this.demos().filter((d) => d.etat === "en_ligne")) {
      try {
        const v = await client.lireVisites(nsId, demo.slug);
        if (!v) continue;
        if (demo.visites === 0 && v.t > 0) {
          this.#events.append({ type: "hebergement.visite", subject: `site:${demo.siteId}`, message: `Première ouverture de la démo ${demo.url}` });
        }
        this.#db
          .prepare("UPDATE demos SET visites = ?, derniere_visite = ?, premiere_ouverture_le = COALESCE(premiere_ouverture_le, ?), updated_at = ? WHERE site_id = ?")
          .run(v.t, v.l, v.f, now(), demo.siteId);
        relevees++;
      } catch {
        /* quota ou panne passagère de l'API : le relevé suivant reprendra */
      }
    }
    return { configure: true, relevees };
  }

  // ── Démarrage / arrêt ───────────────────────────────────────────────────

  start(): void {
    // Expiration des démos à l'échéance : vérifiée au démarrage puis toutes les heures.
    this.planifierExpiration();
    this.#minuteurExpiration = setInterval(() => this.planifierExpiration(), 3600_000);
    this.#minuteurExpiration.unref?.();
    // Relevé des visites toutes les 10 minutes (le KV du Worker fait foi).
    this.#minuteurReleve = setInterval(() => void this.releverVisites(), 10 * 60_000);
    this.#minuteurReleve.unref?.();
  }

  close(): void {
    if (this.#minuteurReleve) clearInterval(this.#minuteurReleve);
    if (this.#minuteurExpiration) clearInterval(this.#minuteurExpiration);
    this.#minuteurReleve = null;
    this.#minuteurExpiration = null;
  }
}
