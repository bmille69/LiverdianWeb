import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { coutDeepseek, TARIF_DEEPSEEK } from "../src/agents/agent-service.ts";
import { fakeSpawner, tempDir, testHub } from "./helpers.ts";

/** Réponse du CLI quand la limite de l'abonnement est atteinte. */
const QUOTA = { subtype: "error", is_error: true, result: "Usage limit reached for subscription." };
/** Réponse réussie avec l'usage exact : le coût DeepSeek s'en déduit (le CLI annoncerait le tarif Claude). */
const OK_USAGE = { result: "ok", usage: { input_tokens: 1000, output_tokens: 200 } };

describe("coût DeepSeek", () => {
  it("recalcule le coût aux tarifs DeepSeek, pas à celui annoncé par le CLI", () => {
    expect(coutDeepseek({ input: 1_000_000, output: 1_000_000 })).toBeCloseTo(TARIF_DEEPSEEK.entree + TARIF_DEEPSEEK.sortie);
    expect(coutDeepseek({ input: 1000, output: 200 })).toBeCloseTo((1000 * 0.27 + 200 * 1.1) / 1_000_000, 10);
  });
});

describe("moteur des agents (ADR-16)", () => {
  const saved = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = saved;
  });

  it("moteur « deepseek » : le CLI part avec l'environnement DeepSeek, l'appel est journalisé avec son coût", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-cle-deepseek";
    const { spawner, calls } = fakeSpawner(() => ({ result: OK_USAGE }));
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "deepseek");
    const r = await hub.agents.ask({ agent: "redacteur", prompt: "Écris une phrase" });
    const call = calls[0]!;
    expect(call.env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(call.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-cle-deepseek");
    expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
    const log = hub.agents.calls()[0]!;
    expect(log).toMatchObject({ agent: "redacteur", engine: "deepseek", ok: true });
    expect(log.costUsd).toBeCloseTo(coutDeepseek({ input: 1000, output: 200 }), 10);
    expect(r.costUsd).toBe(log.costUsd);
  });

  it("moteur « deepseek » : la vision reste sur l'abonnement (jamais un contrôle à l'aveugle)", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-cle";
    const { spawner, calls } = fakeSpawner(() => ({ result: { structured_output: { ok: true } } }));
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "deepseek");
    const dir = tempDir("captures-");
    writeFileSync(join(dir, "a.png"), "x");
    await hub.agents.ask({ agent: "relecteur-ux", prompt: "Relis", imagesDir: dir, schema: z.object({ ok: z.boolean() }) });
    expect(calls[0]!.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(calls[0]!.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(hub.agents.calls()[0]!.engine).toBe("abonnement");
  });

  it("moteur « deepseek » sans clé : refus clair, rien n'est lancé", async () => {
    const { spawner, calls } = fakeSpawner();
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "deepseek");
    await expect(hub.agents.ask({ agent: "redacteur", prompt: "x" })).rejects.toThrow(/clé DEEPSEEK_API_KEY est absente/);
    expect(calls).toHaveLength(0);
  });

  it("moteur « automatique » : limite de l'abonnement → l'appel repart aussitôt sur DeepSeek, les deux sont journalisés", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-cle";
    const { spawner, calls } = fakeSpawner((call) => (calls.length === 1 ? { result: QUOTA } : { result: OK_USAGE }));
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "automatique");
    const r = await hub.agents.ask({ agent: "redacteur", prompt: "Écris" });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.env.ANTHROPIC_BASE_URL).toBeUndefined(); // premier essai : abonnement
    expect(calls[1]!.env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    const log = hub.agents.calls();
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ engine: "abonnement", ok: false }); // l'échec quota est journalisé avant le repli
    expect(log[0]).toMatchObject({ engine: "deepseek", ok: true });
    expect(r.costUsd).toBeCloseTo(coutDeepseek({ input: 1000, output: 200 }), 10);
  });

  it("moteur « automatique » sans clé DeepSeek : erreur claire, l'échec de l'abonnement est journalisé", async () => {
    const { spawner, calls } = fakeSpawner(() => ({ result: QUOTA }));
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "automatique");
    await expect(hub.agents.ask({ agent: "redacteur", prompt: "x" })).rejects.toThrow(/aucune clé DeepSeek n'est enregistrée/);
    expect(calls).toHaveLength(1);
    const log = hub.agents.calls();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ engine: "abonnement", ok: false });
  });

  it("moteur « automatique » : la vision n'est jamais déléguée à DeepSeek, même à la limite", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-cle";
    const { spawner, calls } = fakeSpawner(() => ({ result: QUOTA }));
    const hub = testHub({ spawner });
    hub.settings.set("agents.moteur", "automatique");
    const dir = tempDir("captures-");
    writeFileSync(join(dir, "a.png"), "x");
    await expect(hub.agents.ask({ agent: "relecteur-ux", prompt: "x", imagesDir: dir, schema: z.object({ ok: z.boolean() }) })).rejects.toThrow(/Limite de l'abonnement Claude atteinte/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(hub.agents.calls()[0]!.engine).toBe("abonnement");
  });

  it("moteur « abonnement » : la limite atteinte remonte telle quelle, sans repli", async () => {
    const { spawner, calls } = fakeSpawner(() => ({ result: QUOTA }));
    const hub = testHub({ spawner });
    await expect(hub.agents.ask({ agent: "redacteur", prompt: "x" })).rejects.toThrow(/Limite de l'abonnement Claude atteinte/);
    expect(calls).toHaveLength(1);
    expect(hub.agents.calls()[0]).toMatchObject({ engine: "abonnement", ok: false });
  });

  it("par défaut, chaque appel est journalisé « abonnement »", async () => {
    const { spawner } = fakeSpawner(() => ({ result: OK_USAGE }));
    const hub = testHub({ spawner });
    await hub.agents.ask({ agent: "redacteur", prompt: "x" });
    expect(hub.agents.calls()[0]!.engine).toBe("abonnement");
  });
});
