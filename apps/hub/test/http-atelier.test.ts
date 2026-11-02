import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPreviewServer, buildServer } from "../src/server/http.ts";
import { fakeSpawner, testHub } from "./helpers.ts";

const PORT = 4320;
const HOST = { host: `127.0.0.1:${PORT}` };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

async function setup() {
  // Les agents ne répondent jamais : on teste l'API, pas la chaîne (voir atelier.test.ts).
  const hub = testHub({ spawner: fakeSpawner(() => ({ hang: true })).spawner });
  const app = await buildServer(hub, { port: PORT, previewPort: PORT + 1 });
  const preview = await buildPreviewServer(hub, { port: PORT + 1 });
  closers.push(async () => {
    await app.close();
    await preview.close();
    await hub.close();
  });
  const req = (method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object, headers: HOST });
  return { hub, app, preview, req };
}

describe("API de l'atelier", () => {
  it("dit ce qui manque pour créer la maquette, puis la lance", async () => {
    const { req, hub } = await setup();
    const c = (await req("POST", "/api/companies", { raisonSociale: "Lumen Élec", naf: "43.21A" })).json().company;
    const fiche = (await req("GET", `/api/companies/${c.id}`)).json();
    expect(fiche.maquette.possible).toBe(false);
    expect(fiche.maquette.manques.join(" ")).toMatch(/commune.*téléphone/);
    const refus = await req("POST", `/api/companies/${c.id}/maquette`, {});
    expect(refus.statusCode).toBe(400);
    expect(refus.json().error).toMatch(/il manque/);

    hub.companies.update(c.id, { telephone: "04 72 00 00 00", adresse: { ligne: "2 avenue Franklin Roosevelt", codePostal: "69500", commune: "Bron" } });
    // File non démarrée : la fabrication reste « en cours » sur sa première étape.
    const ok = await req("POST", `/api/companies/${c.id}/maquette`, {});
    expect(ok.statusCode).toBe(201);
    const { site, fabrication } = ok.json();
    expect(fabrication.etat).toBe("en_cours");
    expect((await req("POST", `/api/companies/${c.id}/maquette`, {})).statusCode).toBe(409);

    const detail = (await req("GET", `/api/sites/${site.id}`)).json();
    expect(detail.fabrication.id).toBe(fabrication.id);
    expect(detail.fichiers).toMatchObject({ apercu: false, captures: [] });
    expect((await req("GET", "/api/fabrications?etat=en_cours")).json().fabrications).toHaveLength(1);
    // Valider n'est possible qu'une fois à valider ; modifier pas pendant la fabrication.
    expect((await req("POST", `/api/sites/${site.id}/valider`)).statusCode).toBe(409);
    expect((await req("POST", `/api/sites/${site.id}/modifications`, { texte: "Plus grand" })).statusCode).toBe(409);
    expect((await req("POST", `/api/sites/${site.id}/modifications`, { texte: "" })).statusCode).toBe(400);
    const meta = (await req("GET", "/api/meta")).json();
    expect(meta.apercuPort).toBe(PORT + 1);
    expect(meta.recettesAtelier[0].sequence[0]).toBe("brief");
  });

  it("aperçu : chaque site à la racine de son sous-domaine local, dist seulement", async () => {
    const { hub, preview } = await setup();
    const c = hub.companies.create({ raisonSociale: "X" });
    const s = hub.sites.create({ companyId: c.id });
    const dist = join(s.dossier, "dist");
    mkdirSync(join(dist, "_astro"), { recursive: true });
    mkdirSync(join(dist, "mentions-legales"), { recursive: true });
    writeFileSync(join(dist, "index.html"), "<h1>Accueil</h1>");
    writeFileSync(join(dist, "_astro", "a.css"), "body{}");
    writeFileSync(join(dist, "mentions-legales", "index.html"), "<h1>Mentions</h1>");
    writeFileSync(join(s.dossier, "brief.json"), "{}");
    const get = (url: string, host = `${s.id}.localhost:${PORT + 1}`, method: "GET" | "POST" = "GET") => preview.inject({ method, url, headers: { host } });
    const home = await get("/");
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain("Accueil");
    expect(home.headers["cache-control"]).toBe("no-store");
    expect((await get("/_astro/a.css")).headers["content-type"]).toMatch(/text\/css/);
    expect((await get("/mentions-legales/")).body).toContain("Mentions");
    // Hors de dist : refusé ou introuvable, jamais servi.
    expect((await get("/../brief.json")).body).not.toContain("{}");
    expect((await get("/%2e%2e/brief.json")).statusCode).not.toBe(200);
    expect((await get("/", `inconnu.localhost:${PORT + 1}`)).statusCode).toBe(404);
    expect((await get("/", `127.0.0.1:${PORT + 1}`)).statusCode).toBe(403);
    expect((await get("/", `${s.id}.localhost:${PORT + 1}`, "POST")).statusCode).toBe(405);
  });
});
