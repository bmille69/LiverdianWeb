import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentService } from "../agents/agent-service.ts";
import type { DeepSeekClient } from "../agents/deepseek.ts";
import { prerequisMaquette } from "../atelier/brief.ts";
import type { Atelier } from "../atelier/moteur.ts";
import { parseJson, type Db } from "../db/database.ts";
import type { Company, CompanyService } from "../domain/companies.ts";
import { HubError, notFound } from "../domain/errors.ts";
import type { Bus, EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import type { JobQueue } from "../jobs/job-queue.ts";
import type { ExtracteurFlou, LighthouseRunner } from "./audit.ts";
import { Campagnes } from "./campagnes.ts";
import { ProspectStore } from "./donnees.ts";
import { extracteurEclaireur, lighthouseParDefaut } from "./eclaireur.ts";
import { FileMaquettes } from "./maquettes.ts";
import { registreMarkdown } from "./registre.ts";
import { ApiCache, Compteur, Reseau, type HttpFetch } from "./reseau.ts";
import { Grille, GRILLE_DEFAUT, grilleComplete, libelleRegle } from "./scoring.ts";
import { Geo } from "./sources/geo.ts";
import { OpenStreetMap } from "./sources/osm.ts";
import { GooglePlaces, PLACES_COUT_USD, PLACES_QUOTA_GRATUIT } from "./sources/places.ts";
import { RechercheEntreprises } from "./sources/recherche-entreprises.ts";

export type ProspectionOptions = {
  fetch?: HttpFetch;
  /** Tests : adresses des faux serveurs. */
  sireneBase?: string;
  geoBase?: string;
  placesBase?: string;
  overpass?: string[];
  /** false = aucune attente entre les requêtes (tests). */
  pause?: boolean;
  /** Lighthouse : null = jamais ; absent = celui du kit s'il est installé. */
  lighthouse?: LighthouseRunner | null;
  /** Éclaireur : null = jamais d'agent ; absent = DeepSeek ou Claude haiku. */
  flou?: ExtracteurFlou | null;
};

/** Clés que l'interface peut enregistrer dans .data/settings/secrets.json (jamais renvoyées, jamais journalisées). */
export const SECRETS = {
  GOOGLE_PLACES_API_KEY: { libelle: "Clé Google Places", format: /^[A-Za-z0-9_-]{30,60}$/ },
  DEEPSEEK_API_KEY: { libelle: "Clé DeepSeek", format: /^[A-Za-z0-9_-]{20,100}$/ },
} as const;
export type NomSecret = keyof typeof SECRETS;

export type LigneProspect = {
  id: string;
  nom: string;
  raisonSociale: string;
  metier: string | null;
  naf: string | null;
  commune: string | null;
  codePostal: string | null;
  telephone: string | null;
  email: string | null;
  siteActuel: string | null;
  google: { valeur: number | null; nombre: number | null } | null;
  dateCreation: string | null;
  statut: Company["statut"];
  score: number | null;
  scoreBrut: number | null;
  qualifie: boolean;
  aVerifier: boolean;
  siteStatut: string | null;
  distanceKm: number | null;
  etape: string | null;
  motif: string | null;
  douteux: ("places" | "osm")[];
  maquettePossible: boolean;
  updatedAt: string;
};

export class Prospection {
  readonly store: ProspectStore;
  readonly campagnes: Campagnes;
  readonly places: GooglePlaces;
  readonly maquettes: FileMaquettes;
  readonly cache: ApiCache;
  readonly compteur: Compteur;
  readonly lighthouseDisponible: boolean;
  readonly #db: Db;
  readonly #settings: Settings;
  readonly #events: EventLog;
  readonly #companies: CompanyService;
  readonly #deepseek: Pick<DeepSeekClient, "configured">;
  readonly #dataDir: string;
  readonly #now: () => Date;
  #minuteur: ReturnType<typeof setInterval> | null = null;

  constructor(deps: {
    db: Db;
    bus: Bus;
    events: EventLog;
    settings: Settings;
    companies: CompanyService;
    jobs: JobQueue;
    atelier: Pick<Atelier, "lancer">;
    agents: Pick<AgentService, "ask">;
    deepseek: Pick<DeepSeekClient, "configured">;
    dataDir: string;
    kitDir: string;
    options?: ProspectionOptions;
    now?: () => Date;
  }) {
    const o = deps.options ?? {};
    this.#db = deps.db;
    this.#settings = deps.settings;
    this.#events = deps.events;
    this.#companies = deps.companies;
    this.#deepseek = deps.deepseek;
    this.#dataDir = deps.dataDir;
    this.#now = deps.now ?? (() => new Date());
    const reseau = new Reseau({
      fetch: o.fetch,
      pause: o.pause ?? true,
      // Intervalles minimum entre deux requêtes vers un même hôte (politesse et limites publiées).
      intervalles: { "recherche-entreprises.api.gouv.fr": 220, "geo.api.gouv.fr": 120, "places.googleapis.com": 150, "*": 1000 },
    });
    this.cache = new ApiCache(deps.db, this.#now);
    this.compteur = new Compteur(deps.db, this.#now);
    this.store = new ProspectStore({ db: deps.db, companies: deps.companies, events: deps.events, now: this.#now });
    this.places = new GooglePlaces({ reseau, cache: this.cache, compteur: this.compteur, cle: () => deps.settings.secret("GOOGLE_PLACES_API_KEY"), plafond: () => deps.settings.get("prospection.places.plafondMensuel"), base: o.placesBase });
    const lighthouse = o.lighthouse === undefined ? lighthouseParDefaut(deps.kitDir) : o.lighthouse;
    this.lighthouseDisponible = !!lighthouse;
    this.campagnes = new Campagnes({
      db: deps.db,
      bus: deps.bus,
      events: deps.events,
      settings: deps.settings,
      jobs: deps.jobs,
      store: this.store,
      sirene: new RechercheEntreprises({ reseau, cache: this.cache, compteur: this.compteur, base: o.sireneBase }),
      geo: new Geo(reseau, this.cache, o.geoBase),
      osm: new OpenStreetMap({ reseau, cache: this.cache, compteur: this.compteur, serveurs: o.overpass }),
      places: this.places,
      compteur: this.compteur,
      audit: { reseau, lighthouse, flou: o.flou === undefined ? extracteurEclaireur(deps.agents, deps.deepseek) : o.flou, maintenant: this.#now },
      now: this.#now,
    });
    this.maquettes = new FileMaquettes({ db: deps.db, bus: deps.bus, events: deps.events, settings: deps.settings, atelier: deps.atelier });
  }

  /** Démarrage : purge RGPD tout de suite, puis toutes les 12 heures ; la file des maquettes repart. */
  start(): void {
    this.purger();
    this.maquettes.pomper();
    this.#minuteur = setInterval(() => this.purger(), 12 * 3600_000);
    this.#minuteur.unref?.();
  }

  close(): void {
    if (this.#minuteur) clearInterval(this.#minuteur);
    this.campagnes.close();
    this.maquettes.close();
  }

  purger(): { supprimees: number; avant: string; cacheExpire: number } {
    const r = this.store.purger(this.#settings.get("prospection.purge.mois"));
    return { ...r, cacheExpire: this.cache.nettoyer() };
  }

  etat() {
    const usage = this.places.usage();
    return {
      places: { configure: this.places.configure, ...usage, coutParAppelUsd: PLACES_COUT_USD, quotaGratuit: PLACES_QUOTA_GRATUIT, parEnvironnement: !!process.env.GOOGLE_PLACES_API_KEY },
      deepseek: { configure: this.#deepseek.configured, parEnvironnement: !!process.env.DEEPSEEK_API_KEY },
      lighthouse: this.lighthouseDisponible,
      purgeMois: this.#settings.get("prospection.purge.mois"),
      maquettesParallele: this.#settings.get("prospection.maquettes.parallele"),
      enFabrication: this.maquettes.enFabrication(),
      ...this.store.compter(),
      oppositions: this.store.oppositions().total,
    };
  }

  // ── Prospects ───────────────────────────────────────────────────────────

  liste(filtre: { campagneId?: string } = {}): LigneProspect[] {
    const sql = filtre.campagneId
      ? `SELECT c.*, p.site_statut, p.qualifie, json_extract(p.score_json, '$.total') AS score_brut, json_extract(p.score_json, '$.aVerifier') AS a_verifier,
           json_extract(p.places_json, '$.appariement.statut') AS pl_statut, json_extract(p.places_json, '$.decision') AS pl_decision,
           json_extract(p.osm_json, '$.appariement.statut') AS osm_statut, json_extract(p.osm_json, '$.decision') AS osm_decision,
           cp.distance_km, cp.etape, cp.motif
         FROM campagne_prospects cp JOIN companies c ON c.id = cp.company_id LEFT JOIN prospects p ON p.company_id = c.id
         WHERE cp.campagne_id = ?`
      : `SELECT c.*, p.site_statut, p.qualifie, json_extract(p.score_json, '$.total') AS score_brut, json_extract(p.score_json, '$.aVerifier') AS a_verifier,
           json_extract(p.places_json, '$.appariement.statut') AS pl_statut, json_extract(p.places_json, '$.decision') AS pl_decision,
           json_extract(p.osm_json, '$.appariement.statut') AS osm_statut, json_extract(p.osm_json, '$.decision') AS osm_decision,
           (SELECT MIN(distance_km) FROM campagne_prospects x WHERE x.company_id = c.id) AS distance_km, NULL AS etape, NULL AS motif
         FROM prospects p JOIN companies c ON c.id = p.company_id`;
    const rows = this.#db.prepare(`${sql} ORDER BY c.score DESC, c.raison_sociale LIMIT 5000`).all(...(filtre.campagneId ? [filtre.campagneId] : [])) as Record<string, unknown>[];
    return rows.map((r) => {
      const s = (k: string) => (r[k] as string | null) ?? null;
      const google = parseJson<{ valeur: number | null; nombre: number | null } | null>(r.google_json, null);
      const douteux: LigneProspect["douteux"] = [];
      if (r.pl_statut === "douteux" && !r.pl_decision) douteux.push("places");
      if (r.osm_statut === "douteux" && !r.osm_decision) douteux.push("osm");
      const c = { raisonSociale: String(r.raison_sociale), nomCommercial: s("nom_commercial"), naf: s("naf"), metier: s("metier"), telephone: s("telephone"), adresse: { ligne: s("adresse_ligne"), codePostal: s("code_postal"), commune: s("commune") } };
      return {
        id: String(r.id),
        nom: c.nomCommercial ?? c.raisonSociale,
        raisonSociale: c.raisonSociale,
        metier: c.metier,
        naf: c.naf,
        commune: c.adresse.commune,
        codePostal: c.adresse.codePostal,
        telephone: c.telephone,
        email: s("email"),
        siteActuel: s("site_actuel"),
        google: google ? { valeur: google.valeur, nombre: google.nombre } : null,
        dateCreation: s("date_creation"),
        statut: r.statut as Company["statut"],
        score: (r.score as number | null) ?? null,
        scoreBrut: r.score_brut == null ? null : Number(r.score_brut),
        qualifie: Number(r.qualifie) === 1,
        aVerifier: Number(r.a_verifier) === 1,
        siteStatut: s("site_statut"),
        distanceKm: (r.distance_km as number | null) ?? null,
        etape: s("etape"),
        motif: s("motif"),
        douteux,
        maquettePossible: prerequisMaquette(c as unknown as Company).possible,
        updatedAt: String(r.updated_at),
      };
    });
  }

  fiche(companyId: string) {
    const company = this.#companies.get(companyId);
    const prospect = this.store.get(companyId);
    if (!prospect) throw notFound("Prospect");
    const campagnes = (
      this.#db.prepare("SELECT cp.campagne_id, c.nom, cp.etape, cp.motif, cp.distance_km FROM campagne_prospects cp JOIN campagnes c ON c.id = cp.campagne_id WHERE cp.company_id = ? ORDER BY cp.ajoute_le DESC").all(companyId) as Record<string, unknown>[]
    ).map((r) => ({ id: String(r.campagne_id), nom: String(r.nom), etape: String(r.etape), motif: (r.motif as string | null) ?? null, distanceKm: (r.distance_km as number | null) ?? null }));
    return {
      company,
      prospect,
      faits: this.campagnes.faits(company),
      campagnes,
      maquette: prerequisMaquette(company),
      file: this.maquettes.list().filter((m) => m.companyId === companyId),
      sites: (this.#db.prepare("SELECT id, statut, created_at FROM sites WHERE company_id = ? ORDER BY created_at DESC").all(companyId) as { id: string; statut: string; created_at: string }[]).map((s) => ({ id: s.id, statut: s.statut, createdAt: s.created_at })),
    };
  }

  /** Décision du propriétaire sur un appariement douteux (ou contestation d'un appariement fusionné). */
  decider(companyId: string, source: "places" | "osm", decision: "acceptee" | "refusee") {
    const p = this.store.get(companyId);
    const entree = source === "places" ? p?.places : p?.osm;
    if (!p || !entree) throw new HubError("Aucun appariement à trancher", 404);
    this.store.maj(companyId, { [source]: { ...entree, decision } });
    if (decision === "acceptee") {
      if (source === "places" && p.places?.fiche) this.campagnes.fusionnerPlaces(companyId, p.places.fiche);
      if (source === "osm" && p.osm?.lieu) this.store.fusionnerChamps(companyId, "osm", { telephone: p.osm.lieu.telephone, siteActuel: p.osm.lieu.site });
    }
    this.campagnes.noter(this.#companies.get(companyId));
    this.#events.append({ type: "prospection.appariement", subject: `company:${companyId}`, message: `Appariement ${source === "places" ? "Google Places" : "OpenStreetMap"} ${decision === "acceptee" ? "accepté" : "refusé"}` });
    return this.fiche(companyId);
  }

  // ── Grille ──────────────────────────────────────────────────────────────

  grille() {
    const g = grilleComplete(this.#settings.get("prospection.grille"));
    return { grille: g, defaut: GRILLE_DEFAUT, libelles: Object.fromEntries(g.regles.map((r) => [r.id, libelleRegle(r)])) };
  }

  /** Nouvelle grille : enregistrée puis appliquée tout de suite à tous les prospects déjà audités. */
  changerGrille(raw: unknown) {
    const g = Grille.parse(raw);
    this.#settings.set("prospection.grille", g);
    const ids = (this.#db.prepare("SELECT company_id FROM prospects WHERE audite_le IS NOT NULL").all() as { company_id: string }[]).map((r) => r.company_id);
    let qualifies = 0;
    for (const id of ids) {
      const c = this.store.company(id);
      if (c && this.campagnes.noter(c).qualifie) qualifies++;
    }
    this.#events.append({ type: "prospection.grille", message: `Grille de score modifiée : ${ids.length} prospect(s) recalculé(s), ${qualifies} qualifié(s)` });
    return { ...this.grille(), recalcules: ids.length, qualifies };
  }

  registre(): string {
    const derniere = this.#db.prepare("SELECT nom, lancee_le FROM campagnes WHERE lancee_le IS NOT NULL ORDER BY lancee_le DESC LIMIT 1").get() as { nom: string; lancee_le: string } | undefined;
    const n = this.store.compter();
    return registreMarkdown({
      genereLe: this.#now().toISOString(),
      purgeMois: this.#settings.get("prospection.purge.mois"),
      placesConfigure: this.places.configure,
      deepseekConfigure: this.#deepseek.configured,
      ...n,
      oppositions: this.store.oppositions().total,
      derniereCampagne: derniere ? `${derniere.nom} (${new Date(derniere.lancee_le).toLocaleDateString("fr-FR")})` : null,
    });
  }

  // ── Clés ────────────────────────────────────────────────────────────────

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
}
