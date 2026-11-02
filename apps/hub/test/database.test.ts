import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, migrate, openDatabase, schemaVersion } from "../src/db/database.ts";
import { tempDir } from "./helpers.ts";

describe("migrations", () => {
  it("crée toutes les tables sur une base neuve", () => {
    const db = openDatabase(":memory:");
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ["companies", "sites", "jobs", "agent_calls", "events", "settings"]) expect(tables).toContain(t);
  });

  it("est rejouable sans effet et applique seulement les nouvelles migrations", () => {
    const path = join(tempDir(), "t.db");
    openDatabase(path).close();
    const db = new DatabaseSync(path);
    migrate(db); // rien de neuf
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    migrate(db, [...MIGRATIONS, "CREATE TABLE ajout (x INTEGER);"]);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length + 1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ajout'").get()).toBeTruthy();
  });

  it("annule une migration en erreur sans changer la version", () => {
    const db = openDatabase(":memory:");
    expect(() => migrate(db, [...MIGRATIONS, "CREATE TABLE ok (x INTEGER); CREATE TABLE ko (;"])).toThrow();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
  });

  it("refuse une base plus récente que le hub", () => {
    const db = openDatabase(":memory:");
    expect(() => migrate(db, MIGRATIONS.slice(0, 0))).toThrow(/plus récente/);
  });

  it("contraint les statuts", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      db.prepare("INSERT INTO companies (id, raison_sociale, statut, created_at, updated_at) VALUES ('a', 'X', 'inconnu', 'now', 'now')").run(),
    ).toThrow();
  });
});
