#!/usr/bin/env node
/**
 * Test réel de l'hébergement des démos (brief F), contre le VRAI compte Cloudflare.
 *
 * À lancer une fois l'hébergement configuré (Réglages › Hébergement, « Tester la connexion » tout vert)
 * et le hub démarré. Utilisation :
 *
 *   node scripts/test-hebergement-reel.mjs [nom-de-l-entreprise]
 *
 * Le hub est interrogé sur http://127.0.0.1:4320 (ou LIVERDIAN_PORT). Le script :
 *   1. trouve le site « <nom> » (défaut : Lumen Élec) prêt à publier ou déjà en ligne ;
 *   2. le publie (si besoin) et attend la fin du travail ;
 *   3. charge la démo comme un navigateur : page 200, noindex, en-têtes de sécurité ;
 *   4. vérifie le compteur de visites (un navigateur compte, un robot non, le lien d'aperçu non) ;
 *   5. prolonge de 30 jours puis retire la démo, et vérifie la page « maquette expirée ».
 *
 * Il ne retire jamais les secrets ni ne modifie le hub : uniquement des appels HTTP.
 * Le compteur KV peut mettre jusqu'à une minute à se propager : le script patiente.
 */

const port = process.env.LIVERDIAN_PORT ?? "4320";
const base = `http://127.0.0.1:${port}`;
const nom = process.argv[2] ?? "Lumen Élec";
const UA_NAVIGATEUR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const UA_ROBOT = "curl/8.5.0";

let echecs = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const ko = (m) => {
  echecs++;
  console.error(`  ✗ ${m}`);
};
const etape = (m) => console.log(`\n— ${m}`);

async function appel(methode, chemin, corps) {
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: corps === undefined ? {} : { "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Erreur ${r.status} sur ${methode} ${chemin}`);
  return data;
}

/** Attend que le travail finisse (réussite ou échec) et renvoie son état final. */
async function attendreTravail(jobId, delaiMs = 10 * 60_000) {
  const t0 = Date.now();
  for (;;) {
    const { job } = await appel("GET", `/api/jobs/${jobId}`);
    if (job.state === "done") return job;
    if (job.state === "failed" || job.state === "cancelled") throw new Error(`${job.label} : ${job.error ?? job.state}`);
    if (Date.now() - t0 > delaiMs) throw new Error(`${job.label} : toujours en cours après ${Math.round(delaiMs / 1000)} s`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Relève les visites puis relit la fiche du site, en patientant (propagation du KV). */
async function releverEtRelire(siteId, delaiMs = 90_000) {
  const t0 = Date.now();
  for (;;) {
    await appel("POST", "/api/hebergement/relever");
    const { site } = await appel("GET", `/api/sites/${siteId}`);
    if (Date.now() - t0 > delaiMs) return site;
    await new Promise((r) => setTimeout(r, 5000));
    const avant = site.demo?.visites ?? 0;
    const { site: apres } = await appel("GET", `/api/sites/${siteId}`);
    if ((apres.demo?.visites ?? 0) !== avant) return apres;
  }
}

async function main() {
  etape(`Recherche du site « ${nom} »`);
  const { sites } = await appel("GET", "/api/sites");
  const site = sites.find((s) => s.companyName === nom);
  if (!site) throw new Error(`Aucun site pour « ${nom} ». Utilisation : node scripts/test-hebergement-reel.mjs [nom-de-l-entreprise]`);
  if (site.statut === "a_valider") throw new Error(`« ${nom} » est « À valider » : validez d'abord la maquette dans le hub.`);
  if (site.statut !== "demo_prete" && site.statut !== "demo_en_ligne" && site.statut !== "livre") {
    throw new Error(`Statut « ${site.statut} » : la maquette de « ${nom} » n'est pas publiable.`);
  }
  ok(`site ${site.id} (statut ${site.statut})`);

  etape("Configuration Cloudflare");
  const detail = await appel("GET", `/api/sites/${site.id}`);
  if (!detail.hebergement.configure) {
    throw new Error(`Hébergement non configuré : ${detail.hebergement.manques.join(" ; ")}. Réglez-le dans Réglages › Hébergement.`);
  }
  ok("hébergement configuré");

  if (site.statut === "demo_prete") {
    etape("Publication");
    const { jobId } = await appel("POST", `/api/sites/${site.id}/publier`);
    await attendreTravail(jobId);
    ok("publication terminée");
  } else {
    ok("déjà en ligne, publication sautée");
  }

  const { site: publie, demo } = await appel("GET", `/api/sites/${site.id}`);
  if (demo?.etat !== "en_ligne") throw new Error("La démo n'est pas en ligne après la publication.");
  ok(`en ligne : ${demo.url}`);

  etape("La démo répond comme un vrai site");
  const reponse = await fetch(demo.url, { headers: { "user-agent": UA_NAVIGATEUR } });
  const corps = await reponse.text();
  reponse.status === 200 && corps.includes("<html") ? ok("page 200 en HTML") : ko(`page ${reponse.status}, HTML attendu`);
  const robots = reponse.headers.get("x-robots-tag");
  (robots ?? "").includes("noindex") ? ok(`x-robots-tag: ${robots}`) : ko("x-robots-tag: noindex absent");
  for (const h of ["content-security-policy", "x-content-type-options", "referrer-policy", "strict-transport-security"]) {
    reponse.headers.get(h) ? ok(`${h} présent`) : ko(`${h} absent`);
  }

  etape("Compteur de visites");
  await new Promise((r) => setTimeout(r, 3000)); // laisse le Worker écrire son compteur
  let relu = await releverEtRelire(site.id);
  const visites1 = relu.demo?.visites ?? 0;
  visites1 >= 1 ? ok(`visite du navigateur comptée (total : ${visites1})`) : ko("la visite du navigateur n'a pas été comptée");

  const robot = await fetch(demo.url, { headers: { "user-agent": UA_ROBOT } });
  robot.status === 200 ? ok("un robot reçoit la page (200)") : ko(`robot : ${robot.status}`);
  relu = await releverEtRelire(site.id);
  (relu.demo?.visites ?? 0) === visites1 ? ok("la visite du robot n'a pas été comptée") : ko("le robot a été compté");

  if (demo.apercuUrl) {
    const apercu = await fetch(demo.apercuUrl, { headers: { "user-agent": UA_NAVIGATEUR } });
    apercu.status === 200 ? ok("le lien d'aperçu répond (200)") : ko(`aperçu : ${apercu.status}`);
    relu = await releverEtRelire(site.id);
    (relu.demo?.visites ?? 0) === visites1 ? ok("la visite du propriétaire (aperçu) n'a pas été comptée") : ko("l'aperçu a été compté");
  } else {
    ko("lien d'aperçu absent");
  }

  etape("Prolongation de 30 jours");
  const avant = new Date(demo.expireLe ?? "").getTime();
  const { jobId: jp } = await appel("POST", `/api/sites/${site.id}/prolonger-demo`);
  await attendreTravail(jp);
  const { site: prolonge } = await appel("GET", `/api/sites/${site.id}`);
  const apres = new Date(prolonge.demo?.expireLe ?? "").getTime();
  apres > avant ? ok(`échéance repoussée au ${prolonge.demo.expireLe}`) : ko("l'échéance n'a pas bougé");

  etape("Retrait de la démo");
  const { jobId: jr } = await appel("POST", `/api/sites/${site.id}/retirer-demo`);
  await attendreTravail(jr);
  const { site: retire } = await appel("GET", `/api/sites/${site.id}`);
  retire.demo?.etat === "retiree" && retire.statut === "demo_prete" ? ok("démo retirée, le site redevient « Démo prête »") : ko(`état inattendu : ${retire.demo?.etat} / ${retire.statut}`);
  const fin = await fetch(demo.url, { headers: { "user-agent": UA_NAVIGATEUR } });
  const corpsFin = await fin.text();
  corpsFin.includes("Cette maquette a expiré") ? ok(`la page « Cette maquette a expiré » répond (${fin.status})`) : ko(`page inattendue après retrait (${fin.status})`);

  console.log(echecs === 0 ? "\nTout est vert : l'hébergement des démos fonctionne de bout en bout.\n" : `\n${echecs} vérification(s) en échec : voir ci-dessus.\n`);
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nArrêt : ${err.message}\n`);
  process.exit(1);
});
