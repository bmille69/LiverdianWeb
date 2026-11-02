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
