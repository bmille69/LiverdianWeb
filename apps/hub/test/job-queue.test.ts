import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.ts";
import { Bus, EventLog } from "../src/domain/events.ts";
import { JobQueue } from "../src/jobs/job-queue.ts";

function setup(parallel = 2) {
  const db = openDatabase(":memory:");
  const bus = new Bus();
  const events = new EventLog(db, bus);
  let cap = parallel;
  const queue = new JobQueue(db, bus, events, () => cap);
  return { db, bus, events, queue, setCap: (n: number) => (cap = n) };
}

/** Un travail qu'on termine à la main, pour contrôler le déroulé. */
function gate() {
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; signal: AbortSignal }>();
  return {
    pending,
    handler: {
      run: (ctx: { job: { id: string }; signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          pending.set(ctx.job.id, { resolve, reject, signal: ctx.signal });
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("file de travaux", () => {
  it("exécute un travail et garde sa sortie et sa progression", async () => {
    const { queue } = setup();
    queue.register("t", {
      async run(ctx) {
        ctx.progress({ label: "Étape 1", pct: 50 });
        ctx.log("info", "bonjour");
        return { n: 42 };
      },
    });
    queue.start();
    const job = queue.enqueue({ type: "t", label: "Test" });
    await queue.idle();
    const done = queue.get(job.id);
    expect(done.state).toBe("done");
    expect(done.output).toEqual({ n: 42 });
    expect(done.attempts).toBe(1);
    expect(done.progress.label).toBe("Étape 1");
    expect(done.progress.lines.map((l) => l.text)).toEqual(["bonjour"]);
  });

  it("respecte le plafond de parallélisme, relu à chaud", async () => {
    const { queue, setCap } = setup(2);
    const g = gate();
    queue.register("t", g.handler);
    queue.start();
    const ids = [1, 2, 3, 4].map((i) => queue.enqueue({ type: "t", label: `J${i}` }).id);
    await tick();
    expect(queue.list({ state: "running" })).toHaveLength(2);
    expect(queue.list({ state: "queued" })).toHaveLength(2);
    setCap(3);
    g.pending.get(ids[0]!)!.resolve(null);
    await tick();
    expect(queue.list({ state: "running" })).toHaveLength(3);
    // Ordre d'arrivée respecté.
    expect(queue.get(ids[1]!).state).toBe("running");
    expect(queue.get(ids[3]!).state).toBe("running");
    for (const id of ids.slice(1)) g.pending.get(id)!.resolve(null);
    await queue.idle();
    expect(queue.list({ state: "done" })).toHaveLength(4);
  });

  it("annule un travail en file et un travail en cours (signal transmis)", async () => {
    const { queue } = setup(1);
    const g = gate();
    queue.register("t", g.handler);
    queue.start();
    const a = queue.enqueue({ type: "t", label: "A" });
    const b = queue.enqueue({ type: "t", label: "B" });
    await tick();
    expect(queue.cancel(b.id).state).toBe("cancelled");
    expect(queue.cancel(a.id).state).toBe("cancelled");
    expect(g.pending.get(a.id)!.signal.aborted).toBe(true);
    await queue.idle();
    expect(queue.get(a.id).state).toBe("cancelled");
    expect(queue.get(b.id).state).toBe("cancelled");
    expect(g.pending.has(b.id)).toBe(false);
    expect(() => queue.cancel(a.id)).toThrow(/déjà terminé/);
  });

  it("refait les tentatives prévues puis échoue ; relancer repart de zéro", async () => {
    const { queue } = setup();
    let n = 0;
    queue.register("t", {
      async run() {
        n++;
        throw new Error(`raté ${n}`);
      },
    });
    queue.start();
    const job = queue.enqueue({ type: "t", label: "Fragile", maxAttempts: 3 });
    await queue.idle();
    const failed = queue.get(job.id);
    expect(failed.state).toBe("failed");
    expect(failed.attempts).toBe(3);
    expect(failed.error).toBe("raté 3");
    queue.retry(job.id);
    await queue.idle();
    expect(queue.get(job.id).attempts).toBe(3);
    expect(n).toBe(6);
  });

  it("reprend au démarrage un travail resté « running » (arrêt brutal)", async () => {
    const { db, events, bus } = setup();
    const first = new JobQueue(db, bus, events, () => 1);
    first.register("t", { run: () => new Promise(() => {}) });
    first.start();
    const job = first.enqueue({ type: "t", label: "Long" });
    await tick();
    expect(first.get(job.id).state).toBe("running");
    // Redémarrage : nouvelle file sur la même base, sans arrêt propre de la première.
    const second = new JobQueue(db, bus, events, () => 1);
    second.register("t", {
      async run() {
        return "repris";
      },
    });
    expect(second.start().recovered).toBe(1);
    await second.idle();
    const after = second.get(job.id);
    expect(after.state).toBe("done");
    expect(after.output).toBe("repris");
    expect(after.attempts).toBe(2);
    expect(events.list().some((e) => e.type === "jobs.recovered")).toBe(true);
  });

  it("arrêt propre : le travail en cours reste « running » pour être repris", async () => {
    const { queue } = setup();
    const g = gate();
    queue.register("t", g.handler);
    queue.start();
    const job = queue.enqueue({ type: "t", label: "X" });
    await tick();
    await queue.stop();
    expect(queue.get(job.id).state).toBe("running");
  });

  it("refuse un type inconnu", () => {
    const { queue } = setup();
    expect(() => queue.enqueue({ type: "inconnu", label: "?" })).toThrow(/inconnu/);
  });

  it("publie les changements sur le bus (flux temps réel)", async () => {
    const { queue, bus } = setup();
    const seen: string[] = [];
    bus.subscribe((m) => {
      if (m.kind === "job") seen.push((m.job as { state: string }).state);
    });
    queue.register("t", {
      async run() {
        return 1;
      },
    });
    queue.start();
    queue.enqueue({ type: "t", label: "X" });
    await queue.idle();
    expect(seen).toEqual(expect.arrayContaining(["queued", "running", "done"]));
  });
});
