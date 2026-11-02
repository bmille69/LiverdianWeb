import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { createReadStream, existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { z } from "zod";
import { AGENTS } from "../agents/registry.ts";
import { JOURS, SOURCED_FIELDS, SOURCES, STATUT_LABELS, STATUTS } from "../domain/companies.ts";
import { HubError } from "../domain/errors.ts";
import { isSettingKey, type SettingKey } from "../domain/settings.ts";
import { RECETTES, SITE_STATUT_LABELS, SITE_STATUTS } from "../domain/sites.ts";
import { prerequisMaquette } from "../atelier/brief.ts";
import { lireUnicite } from "../atelier/registre.ts";
import { EssaiInput, type Hub } from "../hub.ts";
import { JOB_STATES } from "../jobs/job-queue.ts";
import { Grille } from "../prospection/scoring.ts";
import { routesProspection } from "./prospection-routes.ts";

z.config(z.locales.fr());

export type ServerOptions = {
  port: number;
  /** Port du serveur d'aperçu des sites (<id>.localhost:<port>). */
  previewPort?: number;
  /** Dossier de l'interface construite (apps/web/dist) ; absent = API seule. */
  webDist?: string;
  version?: string;
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

const SettingValidators: { [K in SettingKey]: z.ZodType } = {
  "jobs.parallel": z.number().int().min(1, "Au moins 1").max(8, "8 au plus"),
  "agents.parallel": z.number().int().min(1, "Au moins 1").max(6, "6 au plus"),
  "agents.models": z.record(z.string(), z.string().regex(/^[a-z0-9.\-[\]]{2,60}$/i, "Nom de modèle invalide")),
  "atelier.timeoutMinutes": z.number().int().min(5).max(180),
  "prospection.grille": Grille.nullable(),
  "prospection.places.plafondMensuel": z.number().int().min(0, "0 au moins").max(100_000, "100 000 au plus"),
  "prospection.maquettes.parallele": z.number().int().min(1, "Au moins 1").max(4, "4 au plus"),
  "prospection.purge.mois": z.number().int().min(1, "1 mois au moins").max(36, "36 mois au plus"),
};

/** Fichier demandé sous un dossier racine, ou null s'il en sort (« .. », lien, chemin absolu). */
export function safeJoin(root: string, decoded: string): string | null {
  // Le chemin arrive déjà décodé par le routeur. Octet nul, lecteur Windows (« C: ») ou flux NTFS (« a:b ») : refusés.
  if (decoded.includes("\0") || decoded.includes(":")) return null;
  const base = resolve(root);
  const target = resolve(base, "." + sep + decoded.replace(/^[/\\]+/, ""));
  if (target !== base && !target.startsWith(base + sep)) return null;
  if (!existsSync(target)) return target;
  // Un lien symbolique ne doit pas mener hors du dossier.
  const real = realpathSync(target);
  const realBase = realpathSync(base);
  if (real !== realBase && !real.startsWith(realBase + sep)) return null;
  return target;
}

/**
 * Serveur HTTP local (ADR-02) : écoute sur 127.0.0.1 seulement, sans authentification.
 * Protections : en-tête Host vérifié (DNS rebinding) et origine vérifiée sur toute modification
 * (une page web ouverte dans le navigateur ne peut rien envoyer au hub).
 */
export async function buildServer(hub: Hub, options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const allowedHosts = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`]);

  app.addHook("onRequest", async (req, reply) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) return reply.code(403).send({ error: "Hôte non autorisé" });
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = String(req.headers.origin ?? "");
      if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, "").toLowerCase())) return reply.code(403).send({ error: "Origine non autorisée" });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) {
      const first = err.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.join(".")} : ${i.message}` : i.message));
      return reply.code(400).send({ error: first.join(" ; "), issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HubError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 400 && (err as { code?: string }).code === "FST_ERR_CTP_INVALID_JSON_BODY") return reply.code(400).send({ error: "Corps de requête JSON invalide" });
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    hub.events.append({ type: "server.error", message: `Erreur interne : ${(err as Error).message.slice(0, 200)}` });
    return reply.code(500).send({ error: `Erreur interne : ${(err as Error).message}` });
  });

  app.register(
    async (api) => {
      api.get("/health", async () => ({
        ok: true,
        version: options.version ?? "0.1.0",
        deepseek: hub.deepseek.configured,
        jobs: { running: hub.jobs.runningCount() },
        claude: hub.cli.queue,
      }));

      api.get("/meta", async () => ({
        statuts: STATUTS.map((id) => ({ id, label: STATUT_LABELS[id] })),
        sources: SOURCES,
        champsSources: SOURCED_FIELDS,
        jours: JOURS,
        siteStatuts: SITE_STATUTS.map((id) => ({ id, label: SITE_STATUT_LABELS[id] })),
        recettes: RECETTES,
        recettesAtelier: hub.atelier.recettes().map((r) => ({
          id: r.id,
          nom: r.nom,
          sequence: r.sequence,
          correction: r.correction,
          refaire: r.refaire,
          seuils: r.seuils,
          etapes: Object.values(r.etapes).map((e) => ({ id: e.id, label: e.label, detail: e.detail, agent: e.agent, groupe: e.groupe })),
        })),
        apercuPort: options.previewPort ?? null,
        jobStates: JOB_STATES,
        agents: AGENTS.map((a) => ({ id: a.id, nom: a.nom, couleur: a.couleur, icone: a.icone })),
      }));

      /** Aujourd'hui : ce qui attend une décision, ce qui tourne, ce qui s'est passé. */
      api.get("/overview", async () => {
        const companies = hub.companies.list();
        const parStatut = Object.fromEntries(STATUTS.map((s) => [s, companies.filter((c) => c.statut === s).length]));
        return {
          entreprises: { total: companies.length, parStatut },
          aValider: hub.sites.list({ statut: "a_valider" }),
          enCours: [...hub.jobs.list({ state: "running" }), ...hub.jobs.list({ state: "queued" })],
          echecs: hub.jobs.list({ state: "failed", limit: 5 }),
          activite: hub.events.list({ limit: 30 }),
        };
      });

      // ── Entreprises ──
      api.get("/companies", async (req) => {
        const q = z
          .object({ q: z.string().max(200).optional(), statut: z.enum(STATUTS).optional(), metier: z.string().max(120).optional(), commune: z.string().max(120).optional() })
          .parse(req.query);
        return { companies: hub.companies.list(q) };
      });
      api.get<{ Params: { id: string } }>("/companies/:id", async (req) => ({
        company: hub.companies.get(req.params.id),
        maquette: prerequisMaquette(hub.companies.get(req.params.id)),
        sites: hub.sites.list({ companyId: req.params.id }),
        jobs: hub.jobs.list({ subject: `company:${req.params.id}`, limit: 20 }),
        activite: hub.events.list({ subject: `company:${req.params.id}`, limit: 20 }),
      }));
      api.post("/companies", async (req, reply) => reply.code(201).send({ company: hub.companies.create(req.body) }));
      api.patch<{ Params: { id: string } }>("/companies/:id", async (req) => ({ company: hub.companies.update(req.params.id, req.body) }));
      /** « Créer la maquette » : site neuf + fabrication par la recette (atelier). */
      api.post<{ Params: { id: string } }>("/companies/:id/maquette", async (req, reply) => {
        const body = z.object({ recette: z.string().max(40).optional() }).parse(req.body ?? {});
        return reply.code(201).send(hub.atelier.lancer(req.params.id, body.recette));
      });
      api.delete<{ Params: { id: string } }>("/companies/:id", async (req) => {
        hub.companies.delete(req.params.id);
        return { ok: true };
      });

      // ── Sites ──
      api.get("/sites", async (req) => {
        const q = z.object({ companyId: z.string().max(40).optional(), statut: z.enum(SITE_STATUTS).optional() }).parse(req.query);
        return { sites: hub.sites.list(q).map((s) => ({ ...s, vignette: existsSync(join(s.dossier, ".atelier", "vignette.jpg")) })) };
      });
      api.get<{ Params: { id: string } }>("/sites/:id", async (req) => {
        const site = hub.sites.get(req.params.id);
        const revue = join(site.dossier, ".atelier", "revue");
        return {
          site,
          fabrication: hub.atelier.pourSite(site.id),
          fichiers: {
            apercu: existsSync(join(site.dossier, "dist", "index.html")),
            vignette: existsSync(join(site.dossier, ".atelier", "vignette.jpg")),
            captures: existsSync(revue) ? readdirSync(revue).filter((f) => f.endsWith(".png") && !f.startsWith("zz-")).sort() : [],
            pleinePage: ["capture-375.png", "capture-768.png", "capture-1440.png"].filter((f) => existsSync(join(site.dossier, ".check", f))),
          },
          jobs: hub.jobs.list({ subject: `site:${req.params.id}`, limit: 60 }),
          activite: hub.events.list({ subject: `site:${req.params.id}`, limit: 40 }),
          unicite: lireUnicite(hub.sites.dirOf(site.id)),
        };
      });
      api.get("/fabrications", async (req) => {
        const q = z.object({ etat: z.enum(["en_cours", "a_valider", "validee", "arretee"]).optional() }).parse(req.query);
        return { fabrications: hub.atelier.list(q).map(({ passes, ...f }) => ({ ...f, passes: passes.map(({ sortie: _s, ...x }) => x) })) };
      });
      api.post<{ Params: { id: string } }>("/sites/:id/valider", async (req) => ({ fabrication: hub.atelier.valider(req.params.id) }));
      api.post<{ Params: { id: string } }>("/sites/:id/modifications", async (req) => {
        const body = z.object({ texte: z.string().trim().min(5, "Décrivez la modification demandée").max(4000) }).parse(req.body);
        return { fabrication: hub.atelier.modifier(req.params.id, body.texte) };
      });
      api.post<{ Params: { id: string } }>("/sites/:id/refaire", async (req) => ({ fabrication: hub.atelier.refaire(req.params.id) }));
      api.post<{ Params: { id: string } }>("/sites/:id/reprendre", async (req) => ({ fabrication: hub.atelier.reprendre(req.params.id) }));
      api.post("/sites", async (req, reply) => reply.code(201).send({ site: hub.sites.create(req.body) }));
      api.patch<{ Params: { id: string } }>("/sites/:id", async (req) => ({ site: hub.sites.update(req.params.id, req.body) }));

      // ── Travaux ──
      api.get("/jobs", async (req) => {
        const q = z.object({ state: z.enum(JOB_STATES).optional(), subject: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
        return { jobs: hub.jobs.list(q) };
      });
      api.get<{ Params: { id: string } }>("/jobs/:id", async (req) => ({ job: hub.jobs.get(req.params.id), calls: hub.agents.calls({ limit: 50 }).filter((c) => c.jobId === req.params.id) }));
      api.post<{ Params: { id: string } }>("/jobs/:id/cancel", async (req) => ({ job: hub.jobs.cancel(req.params.id) }));
      api.post<{ Params: { id: string } }>("/jobs/:id/retry", async (req) => ({ job: hub.jobs.retry(req.params.id) }));

      // ── Agents et skills ──
      api.get("/agents", async () => ({ agents: hub.agents.list() }));
      api.get("/agents/calls", async (req) => {
        const q = z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), agent: z.string().max(40).optional() }).parse(req.query);
        return { calls: hub.agents.calls(q) };
      });
      api.put<{ Params: { id: string } }>("/agents/:id/model", async (req) => {
        const body = z.object({ model: z.string().regex(/^[a-z0-9.\-[\]]{2,60}$/i, "Nom de modèle invalide").nullable() }).parse(req.body);
        if (!AGENTS.some((a) => a.id === req.params.id)) throw new HubError("Agent introuvable", 404);
        const models = { ...hub.settings.get("agents.models") };
        if (body.model) models[req.params.id] = body.model;
        else delete models[req.params.id];
        hub.settings.set("agents.models", models);
        hub.events.append({ type: "agent.model", message: `Modèle de ${AGENTS.find((a) => a.id === req.params.id)!.nom} : ${hub.agents.modelFor(req.params.id)}` });
        return { agents: hub.agents.list() };
      });
      api.post<{ Params: { id: string } }>("/agents/:id/essai", async (req, reply) => {
        const body = EssaiInput.omit({ agent: true }).parse(req.body);
        const agent = AGENTS.find((a) => a.id === req.params.id);
        if (!agent) throw new HubError("Agent introuvable", 404);
        const job = hub.jobs.enqueue({ type: "agent.essai", label: `Essai de ${agent.nom}`, subject: `agent:${agent.id}`, input: { ...body, agent: agent.id } });
        return reply.code(202).send({ job });
      });
      api.get("/skills", async () => {
        const map = hub.skills.map();
        return {
          skills: hub.skills.list().map(({ body: _b, ...s }) => ({
            ...s,
            agents: map.shared.includes(s.path) ? AGENTS.map((a) => a.id) : Object.entries(map.agents).filter(([, l]) => l.includes(s.path)).map(([id]) => id),
          })),
        };
      });
      api.get<{ Params: { "*": string } }>("/skills/*", async (req) => ({ skill: hub.skills.get(req.params["*"]) }));

      // ── Journal, réglages ──
      api.get("/events", async (req) => {
        const q = z.object({ limit: z.coerce.number().int().min(1).max(500).optional(), before: z.coerce.number().int().optional(), subject: z.string().max(80).optional() }).parse(req.query);
        return { events: hub.events.list(q) };
      });
      api.get("/settings", async () => ({ settings: hub.settings.all(), deepseek: hub.deepseek.configured, dataDir: hub.dataDir }));
      api.patch("/settings", async (req) => {
        const body = z.record(z.string(), z.unknown()).parse(req.body);
        const clean: [SettingKey, unknown][] = [];
        for (const [k, v] of Object.entries(body)) {
          if (!isSettingKey(k)) throw new HubError(`Réglage inconnu : ${k}`);
          clean.push([k, SettingValidators[k].parse(v)]);
        }
        for (const [k, v] of clean) hub.settings.set(k, v as never);
        if (clean.length) hub.events.append({ type: "settings.updated", message: `Réglages modifiés : ${clean.map(([k]) => k).join(", ")}` });
        return { settings: hub.settings.all() };
      });

      // ── Prospection ──
      routesProspection(api, hub);

      // ── Flux temps réel ──
      api.get("/stream", (req, reply) => {
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
        res.write("retry: 3000\n\n");
        const unsubscribe = hub.bus.subscribe((msg) => res.write(`event: ${msg.kind}\ndata: ${JSON.stringify(msg)}\n\n`));
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.raw.on("close", () => {
          clearInterval(ping);
          unsubscribe();
        });
      });
    },
    { prefix: "/api" },
  );

  // Fichiers d'un site (captures, aperçu) : seulement sous son dossier, jamais au-delà.
  app.get<{ Params: { id: string; "*": string } }>("/files/sites/:id/*", async (req, reply) => {
    if (!/^[a-z0-9-]{1,40}$/i.test(req.params.id)) return reply.code(400).send({ error: "Identifiant invalide" });
    const site = hub.sites.get(req.params.id);
    const file = safeJoin(site.dossier, req.params["*"] || "index.html");
    if (!file) return reply.code(403).send({ error: "Chemin refusé" });
    let target = file;
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target) || !statSync(target).isFile()) return reply.code(404).send({ error: "Fichier introuvable" });
    if (/[\\/]\.(claude|env)/i.test(target.slice(site.dossier.length))) return reply.code(403).send({ error: "Chemin refusé" });
    reply.header("content-type", MIME[extname(target).toLowerCase()] ?? "application/octet-stream");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(createReadStream(target));
  });

  if (options.webDist && existsSync(join(options.webDist, "index.html"))) {
    // Fichiers résolus à chaque requête (wildcard) : une interface reconstruite est servie sans redémarrer le hub.
    await app.register(fastifyStatic, { root: options.webDist, wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0] ?? "";
      // Une route de l'interface (pas un fichier manquant comme /assets/x.js) reçoit index.html.
      const isPage = !path.startsWith("/api/") && !path.startsWith("/files/") && !/\.[a-z0-9]{1,8}$/i.test(path);
      if (req.method === "GET" && isPage) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Introuvable" });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "Introuvable (interface non construite : lancez « npm run build »)" }));
  }
  return app;
}

/**
 * Serveur d'aperçu des sites construits : chaque site est servi à la racine de son propre sous-domaine local
 * (`http://<id>.localhost:<port>/`), ainsi ses chemins absolus (/_astro/…, /mentions-legales/) marchent tels quels,
 * et une page de site ne partage pas l'origine de l'interface (elle ne peut pas appeler l'API du hub).
 * Lecture seule, `dist/` du site uniquement.
 */
export async function buildPreviewServer(hub: Hub, options: { port: number }): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const hostRe = new RegExp(`^([a-z0-9-]{1,40})\\.localhost:${options.port}$`);
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "GET" && req.method !== "HEAD") return reply.code(405).send("Lecture seule");
    if (!hostRe.test((req.headers.host ?? "").toLowerCase())) return reply.code(403).send("Hôte non autorisé");
  });
  app.get("/*", async (req, reply) => {
    const id = hostRe.exec((req.headers.host ?? "").toLowerCase())![1]!;
    let dossier: string;
    try {
      dossier = hub.sites.get(id).dossier;
    } catch {
      return reply.code(404).type("text/plain; charset=utf-8").send("Site inconnu");
    }
    const dist = join(dossier, "dist");
    let chemin: string;
    try {
      chemin = decodeURIComponent((req.url.split("?")[0] ?? "/").replace(/^\/+/, ""));
    } catch {
      return reply.code(400).send("Chemin invalide");
    }
    const file = safeJoin(dist, chemin || "index.html");
    if (!file) return reply.code(403).send("Chemin refusé");
    let target = file;
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.html");
    if (!existsSync(target) || !statSync(target).isFile()) {
      const page404 = join(dist, "404.html");
      if (existsSync(page404)) return reply.code(404).type(MIME[".html"]!).send(createReadStream(page404));
      return reply.code(404).type("text/plain; charset=utf-8").send(existsSync(dist) ? "Page introuvable" : "Ce site n'est pas encore construit");
    }
    reply.header("content-type", MIME[extname(target).toLowerCase()] ?? "application/octet-stream");
    reply.header("x-content-type-options", "nosniff");
    reply.header("cache-control", "no-store");
    return reply.send(createReadStream(target));
  });
  return app;
}
