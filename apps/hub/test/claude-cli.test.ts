import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { assertSafeArgs, ATELIER_COMMANDS, buildAtelierArgs, buildChatArgs, childEnv, ClaudeCli } from "../src/agents/claude-cli.ts";
import { fakeSpawner, tempDir, testHub } from "./helpers.ts";

const DANGEROUS = ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "bypassPermissions", "acceptEdits", "auto"];

/** Valeur qui suit une option dans une liste d'arguments. */
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("arguments du CLI claude", () => {
  it("chat / structured : aucun outil, isolé, sortie structurée transmise", () => {
    const args = buildChatArgs({ model: "haiku", systemPromptFile: "C:/x/sys.md", jsonSchema: { type: "object" } });
    for (const flag of ["-p", "--restricted", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"]) expect(args).toContain(flag);
    expect(after(args, "--tools")).toBe("");
    expect(after(args, "--model")).toBe("haiku");
    expect(after(args, "--system-prompt-file")).toBe("C:/x/sys.md");
    expect(JSON.parse(after(args, "--json-schema")!)).toEqual({ type: "object" });
    expect(args).not.toContain("--allowedTools");
    for (const d of DANGEROUS) expect(args).not.toContain(d);
  });

  it("vision : Read seulement, sur le seul dossier d'images", () => {
    const args = buildChatArgs({ model: "opus", systemPromptFile: "s", imagesDir: "C:/captures" });
    expect(after(args, "--tools")).toBe("Read");
    expect(after(args, "--allowedTools")).toBe("Read");
    expect(after(args, "--add-dir")).toBe("C:/captures");
    expect(args).toContain("--restricted");
    expect(after(args, "--permission-mode")).toBe("dontAsk");
  });

  it("atelier : outils de fichiers bornés au dossier, commandes en liste fermée, jamais de contournement", () => {
    const args = buildAtelierArgs({ model: "opus", appendSystemPromptFile: "s", maxTurns: 50 });
    expect(after(args, "--permission-mode")).toBe("dontAsk");
    expect(after(args, "--permission-prompts")).toBe("none");
    expect(after(args, "--setting-sources")).toBe("project");
    expect(args).toContain("--strict-mcp-config");
    expect(after(args, "--tools")!.split(",")).toEqual(["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill"]);
    const allowed = after(args, "--allowedTools")!.split(",");
    expect(allowed).toContain("Edit(./**)");
    expect(allowed).toContain("Write(./**)");
    expect(allowed).not.toContain("Edit");
    expect(allowed).not.toContain("Bash");
    const bash = allowed.filter((a) => a.startsWith("Bash"));
    expect(bash).toEqual(ATELIER_COMMANDS.map((c) => `Bash(${c})`));
    expect(bash.every((b) => /^Bash\((npm run build|npx astro (build|check)|node scripts\/\*)\)$/.test(b))).toBe(true);
    const denied = after(args, "--disallowedTools")!.split(",");
    expect(denied).toContain("Edit(./.claude/**)");
    expect(denied).toContain("Write(./.claude/**)");
    for (const d of DANGEROUS) expect(args).not.toContain(d);
  });

  it("refuse toute option de contournement", () => {
    for (const d of DANGEROUS) expect(() => assertSafeArgs(["-p", d])).toThrow(/interdite/);
  });

  it("retire ANTHROPIC_API_KEY de l'environnement de l'enfant (quelle que soit la casse)", () => {
    const env = childEnv({ ANTHROPIC_API_KEY: "sk-secret", anthropic_api_key: "x", PATH: "/bin", ANTHROPIC_MODEL: "m" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.anthropic_api_key).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.ANTHROPIC_MODEL).toBe("m");
  });
});

describe("appel réel du processus (faux binaire)", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("structured : prompt sur stdin, sans clé d'API, sortie validée, appel journalisé", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ne-doit-pas-passer";
    const { spawner, calls } = fakeSpawner(() => ({ result: { structured_output: { reponse: "bonjour" }, total_cost_usd: 0.002 } }));
    const hub = testHub({ spawner });
    const r = await hub.agents.ask({ agent: "redacteur", prompt: "Dis bonjour", schema: z.object({ reponse: z.string() }) });
    expect(r.data).toEqual({ reponse: "bonjour" });
    const call = calls[0]!;
    expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(call.stdin).toBe("Dis bonjour");
    expect(after(call.args, "--model")).toBe("sonnet");
    expect(after(call.args, "--tools")).toBe("");
    const logged = hub.agents.calls();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ agent: "redacteur", model: "sonnet", provider: "claude", mode: "structured", ok: true, costUsd: 0.002 });
  });

  it("rejette une sortie non conforme au schéma et l'enregistre comme échec", async () => {
    const { spawner } = fakeSpawner(() => ({ result: { structured_output: { autre: 1 } } }));
    const hub = testHub({ spawner });
    await expect(hub.agents.ask({ agent: "directeur", prompt: "x", schema: z.object({ reponse: z.string() }) })).rejects.toThrow(/non conforme/);
    expect(hub.agents.calls()[0]!.ok).toBe(false);
  });

  it("vision : Read seul, et le hub donne les chemins exacts des images dans le prompt", async () => {
    const { spawner, calls } = fakeSpawner(() => ({ result: { structured_output: { ok: true } } }));
    const hub = testHub({ spawner });
    const dir = tempDir("captures-");
    writeFileSync(join(dir, "b-mobile.png"), "x");
    writeFileSync(join(dir, "a-bureau.png"), "x");
    writeFileSync(join(dir, "notes.txt"), "x");
    await hub.agents.ask({ agent: "relecteur-ux", prompt: "Relis", imagesDir: dir, schema: z.object({ ok: z.boolean() }) });
    const call = calls[0]!;
    expect(after(call.args, "--tools")).toBe("Read");
    expect(after(call.args, "--add-dir")).toBe(dir);
    expect(call.stdin).toContain(`- ${join(dir, "a-bureau.png")}\n- ${join(dir, "b-mobile.png")}`);
    expect(call.stdin).not.toContain("notes.txt");
    expect(hub.agents.calls()[0]!.mode).toBe("vision");
    await expect(hub.agents.ask({ agent: "relecteur-ux", prompt: "x", imagesDir: tempDir("vide-") })).rejects.toThrow(/Aucune image/);
  });

  it("le modèle choisi dans les réglages remplace celui du registre", async () => {
    const { spawner, calls } = fakeSpawner();
    const hub = testHub({ spawner });
    hub.settings.set("agents.models", { directeur: "haiku" });
    await hub.agents.ask({ agent: "directeur", prompt: "x" });
    expect(after(calls[0]!.args, "--model")).toBe("haiku");
  });

  it("atelier : skills copiés dans le dossier, réglages locaux retirés, progression relayée", async () => {
    const { spawner, calls } = fakeSpawner(() => ({
      lines: [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: "src/index.astro" } }, { type: "text", text: "Fait." }] } }],
      result: { permission_denials: [{ tool_name: "Bash", tool_input: { command: "curl x" } }] },
    }));
    const hub = testHub({ spawner });
    const site = tempDir("site-");
    mkdirSync(join(site, ".claude"), { recursive: true });
    writeFileSync(join(site, ".claude", "settings.local.json"), '{"permissions":{"allow":["Bash"]}}');
    const seen: string[] = [];
    const r = await hub.agents.atelier({ agent: "integrateur", dir: site, prompt: "Construis", onEvent: (e) => seen.push(`${e.kind}:${e.text}`) });
    expect(calls[0]!.cwd).toBe(site);
    expect(calls[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(after(calls[0]!.args, "--model")).toBe("opus");
    expect(readdirSync(join(site, ".claude", "skills")).sort()).toEqual(["astro", "couleurs", "regles"]);
    expect(existsSync(join(site, ".claude", "settings.local.json"))).toBe(false);
    expect(seen).toEqual(["tool:Écrit src/index.astro", "text:Fait."]);
    expect(r.denials).toEqual([{ tool: "Bash", input: { command: "curl x" } }]);
    expect(hub.events.list().some((e) => e.type === "agent.denials")).toBe(true);
  });

  it("annulation : l'appel en cours est interrompu et rejeté", async () => {
    const { spawner, calls } = fakeSpawner(() => ({ hang: true }));
    const cli = new ClaudeCli({ workDir: tempDir(), concurrency: 1, spawner });
    const controller = new AbortController();
    const p = cli.run({ mode: "chat", model: "haiku", systemPrompt: "s", prompt: "p", signal: controller.signal });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    controller.abort();
    await expect(p).rejects.toThrow(/annulé/);
  });

  it("plafond de concurrence : le deuxième appel attend le premier", async () => {
    let release: (() => void) | null = null;
    const { spawner, calls } = fakeSpawner(() => (calls.length === 1 ? { hang: true } : {}));
    const cli = new ClaudeCli({ workDir: tempDir(), concurrency: 1, spawner });
    const c1 = new AbortController();
    const p1 = cli.run({ mode: "chat", model: "haiku", systemPrompt: "s", prompt: "1", signal: c1.signal }).catch(() => "annulé");
    const p2 = cli.run({ mode: "chat", model: "haiku", systemPrompt: "s", prompt: "2" });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(1);
    expect(cli.queue).toEqual({ active: 1, waiting: 1 });
    release = () => c1.abort();
    release();
    expect(await p1).toBe("annulé");
    expect((await p2).text).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("délai maximum dépassé : erreur claire", async () => {
    const { spawner } = fakeSpawner(() => ({ hang: true }));
    const cli = new ClaudeCli({ workDir: tempDir(), concurrency: 1, spawner });
    await expect(cli.run({ mode: "chat", model: "haiku", systemPrompt: "s", prompt: "p", timeoutMs: 30 })).rejects.toThrow(/n'a pas répondu/);
  });
});
