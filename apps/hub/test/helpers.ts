import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { Spawner } from "../src/agents/claude-cli.ts";
import { createHub, type HubOptions } from "../src/hub.ts";

export function tempDir(prefix = "liverdian-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Petite bibliothèque de skills de test, au même format que skills/. */
export function fakeSkills(): string {
  const root = tempDir("skills-");
  const write = (path: string, name: string, body: string) => {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "SKILL.md"), `---\nname: ${name}\ndescription: Test ${name}\n---\n\n${body}\n`);
  };
  write("_shared/regles", "regles", "Rien d'inventé.");
  write("design/couleurs", "couleurs", "Contraste AA.");
  write("dev/astro", "astro", "Utilise le kit.");
  writeFileSync(
    join(root, "agents.json"),
    JSON.stringify({ shared: ["_shared/regles"], agents: { "directeur-artistique": ["design/couleurs"], integrateur: ["dev/astro", "design/couleurs"], redacteur: ["copy/absent"] } }),
  );
  return root;
}

export type SpawnCall = { binary: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin: string; killed: boolean };

/**
 * Faux CLI claude : enregistre l'appel et répond par un flux stream-json minimal.
 * `respond` décide de la réponse (ou ne répond jamais, pour tester l'annulation).
 */
export function fakeSpawner(respond: (call: SpawnCall) => { lines?: object[]; result?: object; hang?: boolean } = () => ({})): { spawner: Spawner; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawner = ((binary: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: Writable; pid: number; kill: () => boolean };
    const call: SpawnCall = { binary, args, cwd: opts.cwd, env: opts.env, stdin: "", killed: false };
    calls.push(call);
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    // Pas de vrai pid : killTree ne doit jamais viser un processus réel pendant les tests.
    child.pid = undefined as unknown as number;
    child.kill = () => {
      call.killed = true;
      return true;
    };
    child.stdin = new Writable({
      write(chunk, _enc, cb) {
        call.stdin += String(chunk);
        cb();
      },
      final(cb) {
        cb();
        const r = respond(call);
        if (r.hang) return;
        setImmediate(() => {
          for (const l of r.lines ?? []) child.stdout.write(JSON.stringify(l) + "\n");
          child.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", total_cost_usd: 0.001, ...r.result }) + "\n");
          child.stdout.end();
          setImmediate(() => child.emit("close", 0));
        });
      },
    });
    return child;
  }) as unknown as Spawner;
  return { spawner, calls };
}

export function testHub(over: Partial<HubOptions> = {}) {
  const dataDir = tempDir();
  return createHub({ dataDir, skillsDir: fakeSkills(), databasePath: ":memory:", ...over });
}
