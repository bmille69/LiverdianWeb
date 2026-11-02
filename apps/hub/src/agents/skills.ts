import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { HubError, notFound } from "../domain/errors.ts";

export type Skill = {
  /** Chemin relatif à `skills/`, avec des « / » : `design/web-design-pro`. */
  path: string;
  name: string;
  description: string;
  /** Catégorie : premier dossier (`design`, `copy`, `_shared`…). */
  category: string;
  /** Corps du SKILL.md, sans le frontmatter. */
  body: string;
};

export type AgentSkillMap = { shared: string[]; agents: Record<string, string[]> };

/** Sépare le frontmatter YAML (entre deux lignes `---`) du corps d'un SKILL.md. */
export function parseSkillFile(raw: string): { meta: Record<string, unknown>; body: string } {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  let meta: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]!) as unknown;
    if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
  } catch {
    /* frontmatter illisible : traité comme absent */
  }
  return { meta, body: m[2]!.trim() };
}

/**
 * Bibliothèque de skills (ADR-06) : lit `skills/**\/SKILL.md` et `skills/agents.json`.
 * Relue à chaque appel (les fichiers sont petits) : une modification d'un skill vaut tout de suite.
 */
export class SkillLibrary {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  list(): Skill[] {
    if (!existsSync(this.root)) return [];
    const out: Skill[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "SKILL.md") {
          const path = relative(this.root, dir).split(sep).join("/");
          const { meta, body } = parseSkillFile(readFileSync(full, "utf8"));
          out.push({
            path,
            name: typeof meta.name === "string" && meta.name ? meta.name : basename(dir),
            description: typeof meta.description === "string" ? meta.description : "",
            category: path.split("/")[0] ?? "",
            body,
          });
        }
      }
    };
    walk(this.root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  get(path: string): Skill {
    const skill = this.list().find((s) => s.path === path);
    if (!skill) throw notFound(`Skill « ${path} »`);
    return skill;
  }

  map(): AgentSkillMap {
    const file = join(this.root, "agents.json");
    if (!existsSync(file)) return { shared: [], agents: {} };
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentSkillMap>;
      return { shared: Array.isArray(raw.shared) ? raw.shared : [], agents: raw.agents && typeof raw.agents === "object" ? raw.agents : {} };
    } catch (err) {
      throw new HubError(`skills/agents.json illisible : ${(err as Error).message}`, 500);
    }
  }

  /** Skills hérités par un agent : les communs d'abord, puis les siens, sans doublon. Un chemin inconnu est signalé. */
  forAgent(agentId: string): { skills: Skill[]; missing: string[] } {
    const map = this.map();
    const wanted = [...new Set([...map.shared, ...(map.agents[agentId] ?? [])])];
    const all = new Map(this.list().map((s) => [s.path, s]));
    const skills: Skill[] = [];
    const missing: string[] = [];
    for (const p of wanted) {
      const s = all.get(p);
      if (s) skills.push(s);
      else missing.push(p);
    }
    return { skills, missing };
  }

  /** Contenu des skills à injecter dans un prompt système (appels sans outils). */
  promptFor(agentId: string): string {
    const { skills } = this.forAgent(agentId);
    if (!skills.length) return "";
    return [
      "# Skills de référence",
      "Ces documents font autorité pour ton travail. Applique-les.",
      ...skills.map((s) => `\n<skill name="${s.name}">\n${s.body}\n</skill>`),
    ].join("\n");
  }

  /**
   * Copie les skills d'un agent dans `<dossier>/.claude/skills/<nom>/` pour que Claude Code les charge
   * nativement en mode atelier. Le dossier `.claude/skills` est remplacé entièrement : il ne contient
   * que les skills voulus, rien de ce qu'un passage précédent y aurait laissé.
   */
  installInto(agentId: string, workDir: string): string[] {
    const { skills } = this.forAgent(agentId);
    const target = join(workDir, ".claude", "skills");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    const names: string[] = [];
    for (const s of skills) {
      const src = join(this.root, ...s.path.split("/"));
      const name = basename(src);
      if (names.includes(name)) throw new HubError(`Deux skills portent le même nom de dossier : ${name}`, 500);
      cpSync(src, join(target, name), { recursive: true, filter: (p) => !statSync(p).isSymbolicLink() });
      names.push(name);
    }
    return names;
  }
}
