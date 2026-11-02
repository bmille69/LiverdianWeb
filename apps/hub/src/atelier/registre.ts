import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { now, parseJson, type Db } from "../db/database.ts";
import type { EventLog } from "../domain/events.ts";
import type { SiteService } from "../domain/sites.ts";
import { trouverCommune } from "./communes.ts";
import type { KitRunner } from "./kit.ts";
import { rendu } from "./rendu.ts";
import { distanceKm, normaliserTexte, type Autre, type Empreinte } from "./unicite.ts";

/**
 * Registre des sites produits (brief D) : une empreinte par site (métier, commune, thème et teintes, polices,
 * mise en page, variantes et ordre, photos, signature, élément sur mesure, textes). Rempli à chaque fabrication
 * réussie, et rattrapé au démarrage du hub (exemples du kit + maquettes déjà en base) ; l'opération est idempotente.
 * Les agents le lisent (DA : sites proches ; Rédacteur : phrases déjà employées) et le contrôle d'unicité s'y compare.
 */
export type EntreeRegistre = {
  id: string;
  origine: "exemple" | "maquette";
  companyId: string | null;
  nom: string;
  metier: string;
  commune: string;
  lat: number | null;
  lon: number | null;
  empreinte: Empreinte;
  /** Texte rendu de la page d'accueil (dist), pour mémoire ; la similarité se calcule sur les textes écrits. */
  texte: string;
  updatedAt: string;
};

type SiteJson = Record<string, any>;

/** Textes écrits pour un site (titres d'un côté, phrases de l'autre), tirés de son site.json. */
export function textesDe(site: SiteJson): { titres: string[]; phrases: string[] } {
  const titres: string[] = [];
  const phrases: string[] = [];
  const ajouter = (liste: string[], v: unknown) => {
    if (typeof v === "string" && v.trim()) liste.push(v.trim());
  };
  for (const s of (site.sections ?? []) as SiteJson[]) {
    const c = (s.contenu ?? {}) as SiteJson;
    ajouter(titres, c.titre);
    for (const k of ["surtitre", "sousTitre", "intro", "texte"]) ajouter(phrases, c[k]);
    for (const r of c.reperes ?? []) ajouter(phrases, r);
    for (const it of [...(c.items ?? []), ...(c.elements ?? [])] as SiteJson[]) {
      ajouter(titres, it.titre);
      ajouter(phrases, it.texte);
      ajouter(phrases, it.detail);
      for (const p of it.points ?? []) ajouter(phrases, p);
    }
    for (const im of (c.images ?? []) as SiteJson[]) ajouter(phrases, im.legende);
  }
  ajouter(titres, site.seo?.titre);
  ajouter(phrases, site.seo?.description);
  ajouter(phrases, site.pied?.phrase);
  ajouter(phrases, site.zone?.precision);
  return { titres, phrases };
}

/** Noms à remplacer par des jetons avant de comparer les textes (entreprise, communes). */
function remplacements(site: SiteJson) {
  const e = site.entreprise ?? {};
  return {
    nom: [e.nomCommercial, e.raisonSociale].filter(Boolean) as string[],
    communes: [site.zone?.commune?.nom, e.adresse?.commune, ...((site.zone?.voisines ?? []) as SiteJson[]).map((v) => v.nom)].filter(Boolean) as string[],
  };
}

export function motsDe(site: SiteJson): string[] {
  const t = textesDe(site);
  return normaliserTexte([...t.titres, ...t.phrases], remplacements(site));
}

export class Registre {
  readonly #db: Db;
  readonly #kit: KitRunner;
  readonly #sites: SiteService;
  readonly #events: EventLog | null;
  /** Rattrapage du démarrage : les étapes qui lisent le registre l'attendent. */
  pret: Promise<void> = Promise.resolve();
  /** Travaux de fond en cours (rattrapage, inscriptions) : la fermeture du hub les attend avant de fermer la base. */
  readonly #taches = new Set<Promise<unknown>>();
  #ferme = false;

  #suivre<T>(p: Promise<T>): Promise<T> {
    this.#taches.add(p);
    void p.finally(() => this.#taches.delete(p)).catch(() => undefined);
    return p;
  }

  /** Inscription en tâche de fond après une fabrication réussie ; une erreur devient un événement. */
  inscrireEnFond(siteId: string): void {
    if (this.#ferme) return;
    this.#suivre(
      this.inscrire(siteId).catch((e: Error) => {
        if (!this.#ferme) this.#events?.append({ type: "registre.erreur", subject: `site:${siteId}`, message: `Inscription au registre impossible : ${e.message}` });
      }),
    );
  }

  async fermer(): Promise<void> {
    this.#ferme = true;
    await Promise.allSettled([...this.#taches]);
  }

  constructor(deps: { db: Db; kit: KitRunner; sites: SiteService; events?: EventLog }) {
    this.#db = deps.db;
    this.#kit = deps.kit;
    this.#sites = deps.sites;
    this.#events = deps.events ?? null;
  }

  /** Empreinte d'un site à partir de son site.json (et du design.json pour décrire l'élément sur mesure). */
  async empreinte(site: SiteJson, design?: { surMesure?: { element?: string; composant?: string } } | null): Promise<Empreinte> {
    const t = await this.#kit.resoudreTheme(site.theme);
    const sections = (site.sections ?? []) as SiteJson[];
    const hero = sections.find((s) => s.type === "hero");
    const fichier = (cle: unknown) => (typeof cle === "string" ? ((site.images?.[cle]?.fichier as string | undefined) ?? null) : null);
    const sm = sections.find((s) => s.type === "surmesure");
    const commune = (site.zone?.commune ?? {}) as { nom?: string; lat?: number; lon?: number };
    const connue = trouverCommune(commune.nom ?? site.entreprise?.adresse?.commune);
    const textes = textesDe(site);
    return {
      nom: site.entreprise?.nomCommercial ?? site.entreprise?.raisonSociale ?? "?",
      metier: site.entreprise?.metier ?? "autre",
      commune: commune.nom ?? site.entreprise?.adresse?.commune ?? "?",
      lat: commune.lat ?? connue?.lat ?? null,
      lon: commune.lon ?? connue?.lon ?? null,
      preset: site.theme?.preset ?? "?",
      couleurs: { accent: t.couleurs.accent!, sombre: t.couleurs.sombre!, fond: t.couleurs.fond! },
      polices: t.polices,
      paire: site.theme?.polices?.paire ?? null,
      rayon: t.rayon,
      signature: t.signature,
      mise: t.mise,
      entete: site.entete?.variante ?? "simple",
      pied: site.pied?.variante ?? "complet",
      sections: sections.map((s) => `${s.type}:${s.variante}`),
      heroImage: fichier(hero?.contenu?.image),
      images: [...new Set(Object.values((site.images ?? {}) as Record<string, { fichier: string }>).map((i) => i.fichier))],
      surMesure: sm ? { composant: String(sm.composant), element: design?.surMesure?.element ?? String(sm.composant) } : null,
      titres: textes.titres,
      phrases: textes.phrases,
      remplacements: remplacements(site),
    };
  }

  #ecrire(e: Omit<EntreeRegistre, "updatedAt">): void {
    const at = now();
    this.#db
      .prepare(
        `INSERT INTO registre_sites (id, origine, company_id, nom, metier, commune, lat, lon, empreinte_json, texte, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET origine = excluded.origine, company_id = excluded.company_id, nom = excluded.nom, metier = excluded.metier,
           commune = excluded.commune, lat = excluded.lat, lon = excluded.lon, empreinte_json = excluded.empreinte_json, texte = excluded.texte, updated_at = excluded.updated_at`,
      )
      .run(e.id, e.origine, e.companyId, e.nom, e.metier, e.commune, e.lat, e.lon, JSON.stringify(e.empreinte), e.texte, at, at);
  }

  /** Inscrit (ou met à jour) un site fabriqué, d'après son dossier. Rend false si le site n'a pas encore de site.json. */
  async inscrire(siteId: string): Promise<boolean> {
    const site = this.#sites.get(siteId);
    const dir = this.#sites.dirOf(siteId);
    const fichier = join(dir, "src", "data", "site.json");
    if (!existsSync(fichier)) return false;
    const json = JSON.parse(readFileSync(fichier, "utf8")) as SiteJson;
    const design = existsSync(join(dir, "design.json")) ? parseJson<Record<string, any>>(readFileSync(join(dir, "design.json"), "utf8"), {}) : null;
    const empreinte = await this.empreinte(json, design);
    let texte = "";
    try {
      texte = existsSync(join(dir, "dist")) ? rendu(dir) : "";
    } catch {
      texte = "";
    }
    this.#ecrire({ id: siteId, origine: "maquette", companyId: site.companyId, nom: empreinte.nom, metier: empreinte.metier, commune: empreinte.commune, lat: empreinte.lat, lon: empreinte.lon, empreinte, texte });
    return true;
  }

  /**
   * Retire un site du registre : son design est remis en chantier (direction artistique relancée). Il y revient dès
   * qu'il repasse le contrôle d'unicité ; sans cela, une fabrication parallèle se comparerait à un design abandonné.
   */
  retirer(siteId: string): void {
    this.#db.prepare("DELETE FROM registre_sites WHERE id = ?").run(siteId);
  }

  /** Inscrit les exemples du kit (`examples/<dossier>/site.json`). */
  async inscrireExemples(): Promise<number> {
    const dossier = join(this.#kit.root, "examples");
    if (!existsSync(dossier)) return 0;
    let n = 0;
    for (const d of readdirSync(dossier)) {
      const f = join(dossier, d, "site.json");
      if (!existsSync(f)) continue;
      const json = JSON.parse(readFileSync(f, "utf8")) as SiteJson;
      const empreinte = await this.empreinte(json);
      this.#ecrire({ id: `exemple:${d}`, origine: "exemple", companyId: null, nom: empreinte.nom, metier: empreinte.metier, commune: empreinte.commune, lat: empreinte.lat, lon: empreinte.lon, empreinte, texte: textesDe(json).titres.concat(textesDe(json).phrases).join("\n") });
      n++;
    }
    return n;
  }

  /**
   * Rattrapage (idempotent) : exemples du kit + toutes les maquettes déjà construites en base. Lancé au démarrage du
   * hub ; une erreur sur un site n'empêche pas les autres (elle est journalisée).
   */
  rattraper(): Promise<{ exemples: number; maquettes: number; erreurs: string[] }> {
    const run = (async () => {
      const erreurs: string[] = [];
      let exemples = 0;
      try {
        exemples = await this.inscrireExemples();
      } catch (e) {
        erreurs.push(`exemples : ${(e as Error).message}`);
      }
      let maquettes = 0;
      const ids = (this.#db.prepare("SELECT id FROM sites ORDER BY created_at").all() as { id: string }[]).map((r) => r.id);
      for (const id of ids) {
        if (this.#ferme) break;
        try {
          if (await this.inscrire(id)) maquettes++;
        } catch (e) {
          erreurs.push(`site ${id} : ${(e as Error).message}`);
        }
      }
      if (erreurs.length && !this.#ferme) this.#events?.append({ type: "registre.erreur", message: `Registre des sites : ${erreurs.length} site(s) non inscrit(s)`, data: { erreurs } });
      return { exemples, maquettes, erreurs };
    })();
    this.pret = run.then(() => undefined);
    return this.#suivre(run);
  }

  liste(): EntreeRegistre[] {
    const rows = this.#db.prepare("SELECT * FROM registre_sites ORDER BY created_at").all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      origine: r.origine as EntreeRegistre["origine"],
      companyId: (r.company_id as string | null) ?? null,
      nom: String(r.nom),
      metier: String(r.metier),
      commune: String(r.commune),
      lat: (r.lat as number | null) ?? null,
      lon: (r.lon as number | null) ?? null,
      empreinte: parseJson<Empreinte>(r.empreinte_json, {} as Empreinte),
      texte: String(r.texte ?? ""),
      updatedAt: String(r.updated_at),
    }));
  }

  /**
   * Sites auxquels un site se compare : tous, sauf lui-même et les autres maquettes de la même entreprise
   * (ce sont des versions du même client, pas des concurrents).
   */
  autres(siteId: string, companyId: string | null): (EntreeRegistre & { mots: string[] })[] {
    return this.liste()
      .filter((e) => e.id !== siteId && (!companyId || e.companyId !== companyId))
      .map((e) => ({ ...e, mots: normaliserTexte([...(e.empreinte.titres ?? []), ...(e.empreinte.phrases ?? [])], e.empreinte.remplacements ?? { nom: [e.nom], communes: [e.commune] }) }));
  }

  /** Pour le contrôle : les autres sites au format attendu par `verifierUnicite`. */
  comparables(siteId: string, companyId: string | null): Autre[] {
    return this.autres(siteId, companyId).map((e) => ({ id: e.id, nom: e.nom, commune: e.commune, origine: e.origine === "exemple" ? "exemple du kit" : "maquette", empreinte: e.empreinte, mots: e.mots }));
  }

  /** Usage de chaque photo de la banque : quels sites l'emploient, en hero ou ailleurs, et à quelle distance. */
  usagePhotos(siteId: string, companyId: string | null, depuis: { lat: number | null; lon: number | null }): Map<string, { site: string; commune: string; km: number | null; hero: boolean; metier: string }[]> {
    const m = new Map<string, { site: string; commune: string; km: number | null; hero: boolean; metier: string }[]>();
    for (const e of this.autres(siteId, companyId)) {
      const km = distanceKm(depuis, e);
      for (const f of e.empreinte.images ?? []) {
        m.set(f, [...(m.get(f) ?? []), { site: e.nom, commune: e.commune, km, hero: f === e.empreinte.heroImage, metier: e.metier }]);
      }
    }
    return m;
  }
}

/** Dernière mesure d'unicité d'un site (`.atelier/unicite.json`), résumée pour l'écran du site. */
export function lireUnicite(dossier: string) {
  const f = join(dossier, ".atelier", "unicite.json");
  if (!existsSync(f)) return null;
  const u = parseJson<Record<string, any> | null>(readFileSync(f, "utf8"), null);
  if (!u) return null;
  return {
    ok: !!u.ok,
    mesureLe: String(u.mesureLe ?? ""),
    plusProche: u.plusProche ?? null,
    texteMax: u.texteMax ?? null,
    conflits: Array.isArray(u.conflits) ? u.conflits.length : 0,
    comparaisons: Array.isArray(u.comparaisons) ? u.comparaisons.length : 0,
  };
}
