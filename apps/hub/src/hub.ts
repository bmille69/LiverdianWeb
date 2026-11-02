import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { AgentService } from "./agents/agent-service.ts";
import { ClaudeCli, type Spawner } from "./agents/claude-cli.ts";
import { DeepSeekClient, type FetchLike } from "./agents/deepseek.ts";
import { getAgent } from "./agents/registry.ts";
import { SiteKit, type KitRunner } from "./atelier/kit.ts";
import { Atelier } from "./atelier/moteur.ts";
import type { Recette } from "./atelier/recette.ts";
import { RECETTES_ATELIER } from "./atelier/recettes/index.ts";
import { SkillLibrary } from "./agents/skills.ts";
import { openDatabase, type Db } from "./db/database.ts";
import { CompanyService } from "./domain/companies.ts";
import { Bus, EventLog } from "./domain/events.ts";
import { HubError } from "./domain/errors.ts";
import { Settings } from "./domain/settings.ts";
import { SiteService } from "./domain/sites.ts";
import { JobQueue } from "./jobs/job-queue.ts";

export type HubOptions = {
  dataDir: string;
  skillsDir: string;
  /** Base en mémoire pour les tests. */
  databasePath?: string;
  claudeBinary?: string;
  spawner?: Spawner;
  fetch?: FetchLike;
  /** Kit de sites (défaut : packages/site-kit à côté de skills/). */
  kitDir?: string;
  /** Tests : kit simulé (génération, contrôles), agents simulés, recettes de test, horloge. */
  kit?: KitRunner;
  atelierAgents?: ConstructorParameters<typeof Atelier>[0]["agents"];
  recettes?: Recette[];
  now?: () => Date;
};

export type Hub = ReturnType<typeof createHub>;

export const EssaiInput = z.object({
  agent: z.string().min(1),
  question: z.string().trim().min(3, "Posez une vraie question").max(2000),
  model: z.string().max(40).optional(),
});

export function createHub(opts: HubOptions) {
  mkdirSync(opts.dataDir, { recursive: true });
  const db: Db = openDatabase(opts.databasePath ?? join(opts.dataDir, "liverdian.db"));
  const bus = new Bus();
  const events = new EventLog(db, bus);
  const settings = new Settings(db, opts.dataDir);
  const companies = new CompanyService(db, events);
  const sites = new SiteService(db, events, companies, join(opts.dataDir, "sites"));
  const skills = new SkillLibrary(opts.skillsDir);
  const cli = new ClaudeCli({
    workDir: join(opts.dataDir, "claude-work"),
    concurrency: () => settings.get("agents.parallel"),
    binary: opts.claudeBinary,
    spawner: opts.spawner,
  });
  const deepseek = new DeepSeekClient({ apiKey: () => settings.secret("DEEPSEEK_API_KEY"), fetch: opts.fetch });
  const agents = new AgentService({ db, cli, deepseek, skills, settings, events, runsDir: join(opts.dataDir, "runs") });
  const jobs = new JobQueue(db, bus, events, () => settings.get("jobs.parallel"));
  const kit = opts.kit ?? new SiteKit(opts.kitDir ?? join(dirname(opts.skillsDir), "packages", "site-kit"));
  const atelier = new Atelier({
    db,
    bus,
    events,
    jobs,
    sites,
    companies,
    recettes: opts.recettes ?? RECETTES_ATELIER,
    agents: opts.atelierAgents ?? agents,
    kit,
    sitesDir: join(opts.dataDir, "sites"),
    now: opts.now,
  });

  // Essai d'un agent : une question, une réponse structurée. Prouve le câblage depuis l'interface (Équipe).
  jobs.register("agent.essai", {
    async run(ctx) {
      const input = EssaiInput.parse(ctx.job.input);
      const agent = getAgent(input.agent);
      if (!agent) throw new HubError(`Agent inconnu : ${input.agent}`);
      ctx.progress({ label: `${agent.nom} réfléchit…`, pct: 10 });
      ctx.log("info", `Question : ${input.question}`);
      const r = await agents.ask({
        agent: agent.id,
        prompt: input.question,
        schema: z.object({ reponse: z.string().describe("Réponse en français, quelques phrases au plus") }),
        jobId: ctx.job.id,
        signal: ctx.signal,
        model: input.model,
        summary: `Essai : ${input.question.slice(0, 120)}`,
      });
      ctx.log("text", r.data.reponse);
      ctx.progress({ label: "Réponse reçue", pct: 100 });
      return { reponse: r.data.reponse, modele: r.model, coutUsd: r.costUsd, dureeMs: r.durationMs };
    },
  });

  return {
    db,
    bus,
    events,
    settings,
    companies,
    sites,
    skills,
    cli,
    deepseek,
    agents,
    jobs,
    kit,
    atelier,
    dataDir: opts.dataDir,
    /** Démarre la file puis rattrape les fabrications interrompues (ordre important). */
    start() {
      const r = jobs.start();
      const fabrications = atelier.reprendreApresDemarrage();
      return { ...r, fabrications };
    },
    async close() {
      atelier.close();
      await jobs.stop();
      db.close();
    },
  };
}
