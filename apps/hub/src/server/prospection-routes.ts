import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Hub } from "../hub.ts";
import { PHASE_LABELS } from "../prospection/campagnes.ts";
import { SITE_CRITERE_LABELS } from "../prospection/criteres.ts";
import { SECRETS, type NomSecret } from "../prospection/index.ts";
import { METIERS } from "../prospection/metiers.ts";
import { TRANCHES_EFFECTIF } from "../prospection/sources/recherche-entreprises.ts";

const Ids = z.array(z.string().regex(/^[a-z0-9-]{1,40}$/i)).min(1, "Aucune entreprise sélectionnée").max(2000);

/** API de la prospection (/api/prospection/…) et des clés d'API (/api/secrets). */
export function routesProspection(api: FastifyInstance, hub: Hub): void {
  const p = hub.prospection;

  api.get("/prospection/etat", async () => ({
    ...p.etat(),
    metiers: METIERS.map(({ id, libelle, groupe, naf }) => ({ id, libelle, groupe, naf })),
    siteCriteres: SITE_CRITERE_LABELS,
    phases: PHASE_LABELS,
    effectifs: Object.fromEntries(Object.entries(TRANCHES_EFFECTIF).map(([k, v]) => [k, v.libelle])),
  }));

  // ── Campagnes ──
  api.get("/prospection/campagnes", async () => ({ campagnes: p.campagnes.list().map((c) => ({ ...c, couts: p.compteur.parCampagne(c.id) })) }));
  api.post("/prospection/campagnes", async (req, reply) => {
    const body = z.object({ lancer: z.boolean().optional() }).passthrough().parse(req.body ?? {});
    let c = p.campagnes.creer(body);
    if (body.lancer) c = p.campagnes.lancer(c.id);
    return reply.code(201).send({ campagne: c });
  });
  api.get<{ Params: { id: string } }>("/prospection/campagnes/:id", async (req) => ({ campagne: p.campagnes.get(req.params.id), couts: p.compteur.parCampagne(req.params.id) }));
  api.put<{ Params: { id: string } }>("/prospection/campagnes/:id", async (req) => ({ campagne: p.campagnes.modifier(req.params.id, req.body) }));
  api.delete<{ Params: { id: string } }>("/prospection/campagnes/:id", async (req) => {
    p.campagnes.supprimer(req.params.id);
    return { ok: true };
  });
  api.post<{ Params: { id: string } }>("/prospection/campagnes/:id/lancer", async (req) => ({ campagne: p.campagnes.lancer(req.params.id) }));
  api.post<{ Params: { id: string } }>("/prospection/campagnes/:id/annuler", async (req) => ({ campagne: p.campagnes.annuler(req.params.id) }));

  // ── Prospects ──
  api.get("/prospection/prospects", async (req) => {
    const q = z.object({ campagne: z.string().max(40).optional() }).parse(req.query);
    return { prospects: p.liste({ campagneId: q.campagne }) };
  });
  api.get<{ Params: { id: string } }>("/prospection/prospects/:id", async (req) => p.fiche(req.params.id));
  api.post<{ Params: { id: string } }>("/prospection/prospects/:id/appariement", async (req) => {
    const body = z.object({ source: z.enum(["places", "osm"]), decision: z.enum(["acceptee", "refusee"]) }).parse(req.body);
    return p.decider(req.params.id, body.source, body.decision);
  });
  api.post("/prospection/exclure", async (req) => {
    const body = z.object({ ids: Ids, motif: z.string().trim().min(2, "Indiquez le motif").max(300) }).parse(req.body);
    return p.store.exclure(body.ids, body.motif);
  });

  // ── Maquettes ──
  api.get("/prospection/maquettes", async () => ({ file: p.maquettes.list(), enFabrication: p.maquettes.enFabrication(), parallele: hub.settings.get("prospection.maquettes.parallele") }));
  api.post("/prospection/maquettes", async (req, reply) => {
    const body = z.object({ ids: Ids, campagneId: z.string().max(40).nullable().optional() }).parse(req.body);
    const r = p.maquettes.ajouter(body.ids, body.campagneId ?? null);
    return reply.code(201).send({ ...r, file: p.maquettes.list() });
  });
  api.post<{ Params: { id: string } }>("/prospection/maquettes/:id/annuler", async (req) => {
    p.maquettes.annuler(req.params.id);
    return { file: p.maquettes.list() };
  });

  // ── Grille, RGPD ──
  api.get("/prospection/grille", async () => p.grille());
  api.put("/prospection/grille", async (req) => p.changerGrille((req.body as { grille?: unknown } | null)?.grille));
  api.get("/prospection/registre", async () => ({ markdown: p.registre() }));
  api.post("/prospection/purge", async () => p.purger());
  api.get("/prospection/opposition", async () => p.store.oppositions());
  api.post("/prospection/opposition", async (req) => {
    const body = z
      .object({ siren: z.string().max(20).optional(), telephone: z.string().max(40).optional(), email: z.string().max(200).optional(), motif: z.string().max(300).optional() })
      .refine((b) => b.siren || b.telephone || b.email, "Indiquez un SIREN, un téléphone ou un email")
      .parse(req.body);
    const ajoutees = p.store.ajouterOpposition(body, body.motif ?? "ajout manuel");
    hub.events.append({ type: "prospection.opposition", message: `Liste d'opposition : ${ajoutees} entrée(s) ajoutée(s)` });
    return { ajoutees, ...p.store.oppositions() };
  });
  api.post("/prospection/opposition/verifier", async (req) => {
    const body = z.object({ siren: z.string().max(20).optional(), telephone: z.string().max(40).optional(), email: z.string().max(200).optional() }).parse(req.body);
    return { opposee: p.store.estOpposee(body) };
  });

  // ── Clés d'API (jamais renvoyées) ──
  api.get("/secrets", async () => ({
    secrets: Object.fromEntries(Object.entries(SECRETS).map(([k, v]) => [k, { libelle: v.libelle, configure: !!hub.settings.secret(k), parEnvironnement: !!process.env[k] }])),
  }));
  api.put("/secrets", async (req) => {
    const body = z.object({ nom: z.enum(Object.keys(SECRETS) as [NomSecret, ...NomSecret[]]), valeur: z.string().max(200).nullable() }).parse(req.body);
    p.enregistrerSecret(body.nom, body.valeur);
    return { nom: body.nom, configure: !!hub.settings.secret(body.nom) };
  });
}
