import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkillFile, SkillLibrary } from "../src/agents/skills.ts";
import { fakeSkills, tempDir } from "./helpers.ts";

describe("chargeur de skills", () => {
  it("lit le frontmatter et le corps", () => {
    const { meta, body } = parseSkillFile("﻿---\r\nname: x\r\ndescription: Une description, simple\r\n---\r\n\r\n# Titre\r\nTexte");
    expect(meta).toEqual({ name: "x", description: "Une description, simple" });
    expect(body).toBe("# Titre\nTexte");
    expect(parseSkillFile("Sans frontmatter").meta).toEqual({});
  });

  it("liste les skills et ceux d'un agent (communs d'abord, chemins manquants signalés)", () => {
    const lib = new SkillLibrary(fakeSkills());
    expect(lib.list().map((s) => s.path)).toEqual(["_shared/regles", "design/couleurs", "dev/astro"]);
    expect(lib.forAgent("integrateur").skills.map((s) => s.name)).toEqual(["regles", "astro", "couleurs"]);
    expect(lib.forAgent("redacteur").missing).toEqual(["copy/absent"]);
    expect(lib.forAgent("inconnu").skills.map((s) => s.name)).toEqual(["regles"]);
    const prompt = lib.promptFor("directeur-artistique");
    expect(prompt).toContain('<skill name="couleurs">');
    expect(prompt).toContain("Rien d'inventé.");
  });

  it("copie exactement les skills de l'agent dans .claude/skills (et retire les anciens)", () => {
    const lib = new SkillLibrary(fakeSkills());
    const site = tempDir("site-");
    mkdirSync(join(site, ".claude", "skills", "vieux"), { recursive: true });
    writeFileSync(join(site, ".claude", "skills", "vieux", "SKILL.md"), "x");
    expect(lib.installInto("integrateur", site)).toEqual(["regles", "astro", "couleurs"]);
    expect(readdirSync(join(site, ".claude", "skills")).sort()).toEqual(["astro", "couleurs", "regles"]);
    expect(readFileSync(join(site, ".claude", "skills", "astro", "SKILL.md"), "utf8")).toContain("Utilise le kit.");
    expect(existsSync(join(site, ".claude", "skills", "vieux"))).toBe(false);
  });

  it("charge la vraie bibliothèque du dépôt : chaque chemin de agents.json existe", () => {
    const lib = new SkillLibrary(resolve(import.meta.dirname, "../../../skills"));
    const map = lib.map();
    expect(lib.list().length).toBeGreaterThan(5);
    for (const id of Object.keys(map.agents)) expect(lib.forAgent(id).missing, id).toEqual([]);
    for (const s of lib.list()) expect(s.description, s.path).not.toBe("");
  });
});
