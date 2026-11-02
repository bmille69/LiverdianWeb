import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer, safeJoin } from "../src/server/http.ts";
import type { Hub } from "../src/hub.ts";
import { fakeSpawner, tempDir, testHub } from "./helpers.ts";

const PORT = 4320;
const HOST = { host: `127.0.0.1:${PORT}` };

let hub: Hub;
let app: FastifyInstance;
let calls: ReturnType<typeof fakeSpawner>["calls"];

beforeEach(async () => {
  const fake = fakeSpawner(() => ({ result: { structured_output: { reponse: "Présent." } } }));
  calls = fake.calls;
  hub = testHub({ spawner: fake.spawner });
  const web = tempDir("web-");
  writeFileSync(join(web, "index.html"), "<!doctype html><title>Liverdian</title>");
  app = await buildServer(hub, { port: PORT, webDist: web });
  hub.jobs.start();
});
afterEach(async () => {
  await app.close();
  await hub.close();
});

const req = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url, payload: payload as object, headers: { ...HOST, ...headers } });

describe("API entreprises", () => {
  it("crée, liste, filtre, modifie et supprime une fiche, avec la source de chaque donnée", async () => {
    const created = await req("POST", "/api/companies", {
      raisonSociale: "Plomberie Martin SARL",
      nomCommercial: "Martin Plomberie",
      siren: "123 456 789",
      naf: "4322a",
      metier: "Plombier",
      telephone: "04 78 00 00 00",
      adresse: { ligne: "3 rue des Lilas", codePostal: "69003", commune: "Lyon" },
      horaires: { lundi: "8h-18h" },
      google: { valeur: 4.7, nombre: 38, url: "https://maps.google.com/x" },
      zone: { commune: "Lyon", voisines: ["Villeurbanne", "Bron"] },
      sources: { siren: "sirene", naf: "sirene", google: "places" },
    });
    expect(created.statusCode).toBe(201);
    const c = created.json().company;
    expect(c.siren).toBe("123456789");
    expect(c.naf).toBe("43.22A");
    expect(c.statut).toBe("prospect");
    expect(c.sources).toEqual({
      raisonSociale: "saisie",
      nomCommercial: "saisie",
      siren: "sirene",
      naf: "sirene",
      metier: "saisie",
      telephone: "saisie",
      adresse: "saisie",
      horaires: "saisie",
      google: "places",
      zone: "saisie",
    });

    expect((await req("GET", "/api/companies?q=martin")).json().companies).toHaveLength(1);
    expect((await req("GET", "/api/companies?statut=client")).json().companies).toHaveLength(0);

    const patched = (await req("PATCH", `/api/companies/${c.id}`, { statut: "qualifie", telephone: "", email: "Contact@Martin.fr", sources: { email: "audit" } })).json().company;
    expect(patched.statut).toBe("qualifie");
    expect(patched.telephone).toBeNull();
    expect(patched.email).toBe("contact@martin.fr");
    expect(patched.sources.telephone).toBeUndefined();
    expect(patched.sources.email).toBe("audit");
    expect(patched.siren).toBe("123456789");

    const detail = (await req("GET", `/api/companies/${c.id}`)).json();
    expect(detail.activite.map((e: { message: string }) => e.message)).toContain("Plomberie Martin SARL : Prospect → Qualifié");

    expect((await req("DELETE", `/api/companies/${c.id}`)).statusCode).toBe(200);
    expect((await req("GET", `/api/companies/${c.id}`)).statusCode).toBe(404);
  });

  it("refuse les données invalides avec un message en français", async () => {
    const r = await req("POST", "/api/companies", { raisonSociale: "", siren: "12", email: "pas-un-email" });
    expect(r.statusCode).toBe(400);
    const msg = r.json().error as string;
    expect(msg).toContain("La raison sociale est obligatoire");
    expect(msg).toContain("Le SIREN compte 9 chiffres");
    const dup = { raisonSociale: "A", siren: "111111111" };
    expect((await req("POST", "/api/companies", dup)).statusCode).toBe(201);
    const second = await req("POST", "/api/companies", { ...dup, raisonSociale: "B" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toContain("déjà");
    expect((await req("GET", "/api/companies/inconnue")).json().error).toBe("Entreprise introuvable");
  });
});

describe("API sites, travaux, agents", () => {
  it("crée un site rattaché à une entreprise et change son statut", async () => {
    const c = (await req("POST", "/api/companies", { raisonSociale: "Élec Dupont" })).json().company;
    const s = (await req("POST", "/api/sites", { companyId: c.id })).json().site;
    expect(s).toMatchObject({ companyId: c.id, companyName: "Élec Dupont", recette: "vitrine-artisan", statut: "brouillon" });
    const after = (await req("PATCH", `/api/sites/${s.id}`, { statut: "a_valider", qualiteNote: 92 })).json().site;
    expect(after.statut).toBe("a_valider");
    expect((await req("GET", "/api/overview")).json().aValider).toHaveLength(1);
    expect((await req("POST", "/api/sites", { companyId: "nope" })).statusCode).toBe(404);
  });

  it("lance l'essai d'un agent en travail, suivi jusqu'au bout", async () => {
    const r = await req("POST", "/api/agents/redacteur/essai", { question: "Es-tu là ?" });
    expect(r.statusCode).toBe(202);
    const id = r.json().job.id;
    await hub.jobs.idle();
    const job = (await req("GET", `/api/jobs/${id}`)).json();
    expect(job.job.state).toBe("done");
    expect(job.job.output.reponse).toBe("Présent.");
    expect(job.calls).toHaveLength(1);
    expect(calls[0]!.stdin).toBe("Es-tu là ?");
    expect((await req("POST", `/api/jobs/${id}/cancel`)).statusCode).toBe(409);
  });

  it("liste les agents avec leurs skills, change un modèle, lit un skill", async () => {
    const agents = (await req("GET", "/api/agents")).json().agents;
    expect(agents.map((a: { id: string }) => a.id)).toEqual(["directeur", "directeur-artistique", "redacteur", "integrateur", "controleur-qa", "relecteur-ux", "eclaireur"]);
    const integ = agents.find((a: { id: string }) => a.id === "integrateur");
    expect(integ.skills.map((s: { name: string }) => s.name)).toEqual(["regles", "astro", "couleurs"]);
    const after = (await req("PUT", "/api/agents/integrateur/model", { model: "sonnet" })).json().agents;
    expect(after.find((a: { id: string }) => a.id === "integrateur").modele).toBe("sonnet");
    expect((await req("PUT", "/api/agents/integrateur/model", { model: "rm -rf" })).statusCode).toBe(400);
    const skill = (await req("GET", "/api/skills/design/couleurs")).json().skill;
    expect(skill.body).toContain("Contraste AA.");
    expect((await req("GET", "/api/skills")).json().skills.find((s: { path: string }) => s.path === "_shared/regles").agents).toHaveLength(agents.length);
  });

  it("réglages : clés connues et valeurs bornées seulement", async () => {
    expect((await req("PATCH", "/api/settings", { "jobs.parallel": 3 })).json().settings["jobs.parallel"]).toBe(3);
    expect((await req("PATCH", "/api/settings", { "jobs.parallel": 99 })).statusCode).toBe(400);
    expect((await req("PATCH", "/api/settings", { "pirate": 1 })).json().error).toContain("Réglage inconnu");
  });
});

describe("sécurité et fichiers", () => {
  it("refuse un hôte inconnu (DNS rebinding) et une origine étrangère", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health", headers: { host: "evil.com" } })).statusCode).toBe(403);
    const r = await req("POST", "/api/companies", { raisonSociale: "X" }, { origin: "https://evil.com" });
    expect(r.statusCode).toBe(403);
    expect((await req("POST", "/api/companies", { raisonSociale: "X" }, { origin: `http://localhost:${PORT}` })).statusCode).toBe(201);
  });

  it("sert les fichiers d'un site sans permettre d'en sortir", async () => {
    const c = (await req("POST", "/api/companies", { raisonSociale: "X" })).json().company;
    const s = (await req("POST", "/api/sites", { companyId: c.id })).json().site;
    mkdirSync(join(s.dossier, "captures"), { recursive: true });
    writeFileSync(join(s.dossier, "captures", "mobile.png"), "PNG");
    mkdirSync(join(s.dossier, ".claude"), { recursive: true });
    writeFileSync(join(s.dossier, ".claude", "x.json"), "{}");
    const ok = await req("GET", `/files/sites/${s.id}/captures/mobile.png`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect((await req("GET", `/files/sites/${s.id}/..%2F..%2Fliverdian.db`)).statusCode).toBe(403);
    expect((await req("GET", `/files/sites/${s.id}/%2e%2e/%2e%2e/x`)).statusCode).not.toBe(200);
    expect((await req("GET", `/files/sites/${s.id}/.claude/x.json`)).statusCode).toBe(403);
    expect((await req("GET", `/files/sites/${s.id}/absent.png`)).statusCode).toBe(404);
  });

  it("safeJoin reste dans la racine", () => {
    const root = tempDir();
    expect(safeJoin(root, "a/b.png")).toBe(join(root, "a", "b.png"));
    expect(safeJoin(root, "../x")).toBeNull();
    expect(safeJoin(root, "..\\x")).toBeNull();
    expect(safeJoin(root, "/etc/passwd")).toBe(join(root, "etc", "passwd"));
    expect(safeJoin(root, "C:/Windows/win.ini")).toBeNull();
    expect(safeJoin(root, "a\0.png")).toBeNull();
  });

  it("sert l'interface (fallback SPA) mais pas pour /api", async () => {
    const page = await req("GET", "/entreprises/abc");
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Liverdian");
    expect((await req("GET", "/api/inconnu")).statusCode).toBe(404);
    // Un fichier manquant n'est jamais remplacé par index.html (le navigateur refuserait le script).
    expect((await req("GET", "/assets/absent-123.js")).statusCode).toBe(404);
  });

  it("sert un fichier de l'interface ajouté après le démarrage (interface reconstruite)", async () => {
    const web = tempDir("web2-");
    writeFileSync(join(web, "index.html"), "<!doctype html>");
    const other = await buildServer(hub, { port: PORT, webDist: web });
    mkdirSync(join(web, "assets"));
    writeFileSync(join(web, "assets", "index-neuf.js"), "export {}");
    const r = await other.inject({ method: "GET", url: "/assets/index-neuf.js", headers: HOST });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("javascript");
    await other.close();
  });
});
