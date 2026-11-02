import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

/**
 * Migrations appliquées dans l'ordre (ADR-03). Ne jamais modifier une migration publiée :
 * en ajouter une nouvelle à la fin de la liste.
 */
export const MIGRATIONS: string[] = [
  `
  -- La fiche entreprise unique : prospect, puis client. Les données structurées (horaires, note Google,
  -- zone, sources par champ) sont en JSON ; ce qui se filtre ou se trie est en colonne.
  CREATE TABLE companies (
    id TEXT PRIMARY KEY,
    raison_sociale TEXT NOT NULL,
    nom_commercial TEXT,
    siren TEXT,
    naf TEXT,
    metier TEXT,
    date_creation TEXT,
    dirigeant TEXT,
    telephone TEXT,
    email TEXT,
    site_actuel TEXT,
    adresse_ligne TEXT,
    code_postal TEXT,
    commune TEXT,
    horaires_json TEXT,
    google_json TEXT,
    zone_json TEXT,
    statut TEXT NOT NULL DEFAULT 'prospect'
      CHECK (statut IN ('prospect', 'qualifie', 'maquette', 'contacte', 'client', 'perdu', 'exclu')),
    score REAL,
    notes TEXT,
    sources_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX companies_siren ON companies (siren) WHERE siren IS NOT NULL;
  CREATE INDEX companies_statut ON companies (statut, updated_at);

  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    recette TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'en_fabrication', 'a_valider', 'demo_en_ligne', 'livre', 'archive')),
    dossier TEXT NOT NULL,
    qualite_note REAL,
    url_demo TEXT,
    url_prod TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX sites_company ON sites (company_id);

  -- File de travaux persistante (ADR-04).
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT,
    label TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 1,
    input_json TEXT NOT NULL DEFAULT '{}',
    output_json TEXT,
    progress_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX jobs_state ON jobs (state, created_at);
  CREATE INDEX jobs_subject ON jobs (subject);

  CREATE TABLE agent_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    agent TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    mode TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    cost_usd REAL,
    ok INTEGER NOT NULL,
    job_id TEXT,
    summary TEXT,
    error TEXT
  );
  CREATE INDEX agent_calls_at ON agent_calls (at);
  CREATE INDEX agent_calls_agent ON agent_calls (agent, at);

  -- Journal d'activité, en français, pour le fil de l'interface.
  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    type TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    data_json TEXT
  );
  CREATE INDEX events_subject ON events (subject, seq);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  -- Atelier (brief C) : deux statuts de site de plus (démo prête après validation, à revoir après un arrêt).
  -- SQLite ne modifie pas une contrainte CHECK : la table est reconstruite à l'identique, avec ses données.
  CREATE TABLE sites_v2 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    recette TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'brouillon'
      CHECK (statut IN ('brouillon', 'en_fabrication', 'a_valider', 'a_revoir', 'demo_prete', 'demo_en_ligne', 'livre', 'archive')),
    dossier TEXT NOT NULL,
    qualite_note REAL,
    url_demo TEXT,
    url_prod TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO sites_v2 SELECT id, company_id, recette, statut, dossier, qualite_note, url_demo, url_prod, created_at, updated_at FROM sites;
  DROP TABLE sites;
  ALTER TABLE sites_v2 RENAME TO sites;
  CREATE INDEX sites_company ON sites (company_id);

  -- Fabrication d'un site par une recette : la machine à états de l'atelier (ADR-09).
  -- etape/job_id : étape en cours et son travail. passes : chaque passage d'étape (tour, état, durée, résumé).
  -- cycle : résultats des contrôles du passage en cours. tours : historique des tours de correction.
  CREATE TABLE fabrications (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    recette TEXT NOT NULL,
    etat TEXT NOT NULL CHECK (etat IN ('en_cours', 'a_valider', 'validee', 'arretee')),
    etape TEXT,
    job_id TEXT,
    tour INTEGER NOT NULL DEFAULT 0,
    motif TEXT,
    motif_type TEXT,
    refaire INTEGER NOT NULL DEFAULT 0,
    cycle_json TEXT NOT NULL DEFAULT '[]',
    renvois_json TEXT NOT NULL DEFAULT '{}',
    exigences_json TEXT NOT NULL DEFAULT '[]',
    passes_json TEXT NOT NULL DEFAULT '[]',
    tours_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX fabrications_site ON fabrications (site_id, created_at);
  CREATE INDEX fabrications_etat ON fabrications (etat, updated_at);
  `,
  `
  -- Prospection (brief E). Une campagne = des critères enregistrés et relançables ; sa progression (phase) permet
  -- la reprise après un redémarrage. Les entreprises trouvées vont dans companies ; prospects garde ce qui ne sert
  -- qu'à la prospection (relevés Sirene utiles, appariements Places/OSM, audit, détail du score).
  CREATE TABLE campagnes (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    criteres_json TEXT NOT NULL,
    etat TEXT NOT NULL DEFAULT 'brouillon' CHECK (etat IN ('brouillon', 'en_cours', 'terminee', 'erreur', 'annulee')),
    phase TEXT,
    job_id TEXT,
    compteurs_json TEXT NOT NULL DEFAULT '{}',
    erreur TEXT,
    lancee_le TEXT,
    finie_le TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE prospects (
    company_id TEXT PRIMARY KEY REFERENCES companies (id) ON DELETE CASCADE,
    siret TEXT,
    lat REAL,
    lon REAL,
    sirene_json TEXT,
    places_json TEXT,
    osm_json TEXT,
    audit_json TEXT,
    score_json TEXT,
    exclusion_json TEXT,
    site_statut TEXT,
    qualifie INTEGER NOT NULL DEFAULT 0,
    source_le TEXT NOT NULL,
    enrichi_le TEXT,
    audite_le TEXT,
    note_le TEXT,
    updated_at TEXT NOT NULL
  );

  -- Appartenance d'une entreprise à une campagne, et l'étape atteinte pour elle (source → enrichi → audite → note | ecarte).
  CREATE TABLE campagne_prospects (
    campagne_id TEXT NOT NULL REFERENCES campagnes (id) ON DELETE CASCADE,
    company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    distance_km REAL,
    etape TEXT NOT NULL,
    motif TEXT,
    ajoute_le TEXT NOT NULL,
    maj_le TEXT NOT NULL,
    PRIMARY KEY (campagne_id, company_id)
  );
  CREATE INDEX campagne_prospects_etape ON campagne_prospects (campagne_id, etape);

  -- Liste d'opposition à vie : empreintes (SHA-256) du SIREN, du téléphone ou de l'email, jamais la donnée en clair.
  CREATE TABLE opposition (
    cle TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('siren', 'telephone', 'email')),
    motif TEXT,
    created_at TEXT NOT NULL
  );

  -- Réponses des API mises en cache : une même requête n'est jamais repayée pendant sa durée de validité.
  CREATE TABLE api_cache (
    cle TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    reponse_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expire_le TEXT NOT NULL
  );

  -- Appels réellement envoyés (hors cache) : compteur, coût estimé, plafond mensuel de Google Places.
  CREATE TABLE api_appels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    source TEXT NOT NULL,
    campagne_id TEXT,
    cout_usd REAL NOT NULL DEFAULT 0,
    statut INTEGER
  );
  CREATE INDEX api_appels_source ON api_appels (source, at);

  -- File des maquettes lancées depuis la prospection (plafond de fabrications simultanées).
  CREATE TABLE maquettes_file (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    campagne_id TEXT,
    etat TEXT NOT NULL CHECK (etat IN ('en_attente', 'lancee', 'annulee', 'refusee')),
    site_id TEXT,
    message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX maquettes_file_etat ON maquettes_file (etat, created_at);
  `,
  `
  -- Registre des sites produits (brief D) : l'empreinte de chaque site (design, texte, photos), lue par les agents
  -- et par le contrôle d'unicité. id = id du site, ou « exemple:<dossier> » pour les exemples du kit.
  CREATE TABLE registre_sites (
    id TEXT PRIMARY KEY,
    origine TEXT NOT NULL CHECK (origine IN ('exemple', 'maquette')),
    company_id TEXT,
    nom TEXT NOT NULL,
    metier TEXT NOT NULL,
    commune TEXT NOT NULL,
    lat REAL,
    lon REAL,
    empreinte_json TEXT NOT NULL,
    texte TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX registre_sites_metier ON registre_sites (metier);
  `,
  `
  -- Hébergement des démos (brief F) : une fiche par site publié. Le slug est stable une fois choisi (unique) ;
  -- l'état suit le cycle en_ligne → expiree (J+30) / retiree (manuel). Les visites sont relevées depuis le KV
  -- du Worker (compteur total + dates), jamais stockées individuellement.
  CREATE TABLE demos (
    site_id TEXT PRIMARY KEY REFERENCES sites (id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    etat TEXT NOT NULL DEFAULT 'en_ligne' CHECK (etat IN ('en_ligne', 'expiree', 'retiree')),
    publie_le TEXT,
    expire_le TEXT,
    retiree_le TEXT,
    visites INTEGER NOT NULL DEFAULT 0,
    derniere_visite TEXT,
    premiere_ouverture_le TEXT,
    derniere_publication_le TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX demos_etat ON demos (etat, expire_le);

  -- Attente du quota (brief F) : une fabrication peut se mettre « en attente » (limite du quota Claude atteinte)
  -- puis reprendre seule. SQLite ne modifie pas une contrainte CHECK : la table est reconstruite avec ses données.
  CREATE TABLE fabrications_v2 (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    recette TEXT NOT NULL,
    etat TEXT NOT NULL CHECK (etat IN ('en_cours', 'a_valider', 'validee', 'arretee', 'en_attente')),
    etape TEXT,
    job_id TEXT,
    tour INTEGER NOT NULL DEFAULT 0,
    motif TEXT,
    motif_type TEXT,
    refaire INTEGER NOT NULL DEFAULT 0,
    cycle_json TEXT NOT NULL DEFAULT '[]',
    renvois_json TEXT NOT NULL DEFAULT '{}',
    exigences_json TEXT NOT NULL DEFAULT '[]',
    passes_json TEXT NOT NULL DEFAULT '[]',
    tours_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  INSERT INTO fabrications_v2 SELECT id, site_id, recette, etat, etape, job_id, tour, motif, motif_type, refaire, cycle_json, renvois_json, exigences_json, passes_json, tours_json, created_at, updated_at, finished_at FROM fabrications;
  DROP TABLE fabrications;
  ALTER TABLE fabrications_v2 RENAME TO fabrications;
  CREATE INDEX fabrications_site ON fabrications (site_id, created_at);
  CREATE INDEX fabrications_etat ON fabrications (etat, updated_at);
  `,
  `
  -- Moteur des agents (brief F, ADR-16) : chaque appel enregistre le moteur réellement utilisé.
  -- « abonnement » (Claude Code Max) ou « deepseek » (le même CLI branché sur DeepSeek).
  ALTER TABLE agent_calls ADD COLUMN engine TEXT NOT NULL DEFAULT 'abonnement';
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function schemaVersion(db: Db): number {
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  return row?.version ?? 0;
}

export function migrate(db: Db, migrations: string[] = MIGRATIONS): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
  if (version > migrations.length) {
    throw new Error(`Base plus récente que ce hub (schéma ${version}, connu jusqu'à ${migrations.length}) : mettez le hub à jour.`);
  }
  while (version < migrations.length) {
    const sql = migrations[version]!;
    transaction(db, () => {
      db.exec(sql);
      db.prepare("UPDATE schema_version SET version = ?").run(version + 1);
    });
    version++;
  }
}

/** Exécute fn dans une transaction ; annule si fn lève une exception. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const now = (): string => new Date().toISOString();

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
