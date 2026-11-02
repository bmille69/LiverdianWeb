import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assembler, attribuer, verifierCoherence, type Refus } from "../assemblage.ts";
import { buildBrief, type Brief } from "../brief.ts";
import { readJson, writeJson, type CheckReport } from "../kit.ts";
import type { Consigne, EtapeContexte, EtapeDef, Issue, Recette } from "../recette.ts";
import { pisteDeDepart } from "../piste.ts";
import { motsDe } from "../registre.ts";
import { rendu } from "../rendu.ts";
import { ContenuSchema, DesignSchema, FaitsSchema, UxSchema, VARIANTES, VisuelSchema, type Contenu, type Design } from "../schemas.ts";
import { distanceKm, messageConflits, oklab, verifierUnicite, type SeuilsUnicite, type VerdictUnicite } from "../unicite.ts";

/**
 * Recette « Vitrine artisan 1 page » : brief → direction artistique → rédaction → assemblage → unicité → élément
 * sur mesure → contrôles automatiques → unicité → faits → revue visuelle → relecture UX ; correction (Intégrateur)
 * jusqu'à 3 tours, puis arrêt « à revoir ».
 *
 * Fichiers du dossier du site (entrées et sorties exactes de chaque étape) :
 *   brief.json, unicite-design.json, unicite-textes.json (registre), design.json, content.json, site.json (assemblé),
 *   src/data/site.json (projet), src/sections/custom/ (élément sur mesure), dist/,
 *   .check/ (rapport + captures du kit), .atelier/ (candidats du DA, captures découpées, unicité, faits, revues, corrections).
 */
const SEUILS = {
  lighthouse: 95,
  visuelMoyenne: 4,
  visuelMin: 3,
  toursMax: 3,
  // Unicité (ADR-14) : calibrés sur les sites réels du registre (voir l'ADR pour les mesures).
  uniciteZoneKm: 30,
  uniciteDistanceVoisin: 0.55,
  uniciteDistanceMetier: 0.45,
  uniciteDistanceZone: 0.35,
  uniciteTexteMetier: 0.04,
  uniciteTexteAutre: 0.06,
  uniciteTeinteVoisin: 25,
};

const SEUILS_UNICITE: SeuilsUnicite = {
  zoneKm: SEUILS.uniciteZoneKm,
  distanceVoisin: SEUILS.uniciteDistanceVoisin,
  distanceMetier: SEUILS.uniciteDistanceMetier,
  distanceZone: SEUILS.uniciteDistanceZone,
  texteMetier: SEUILS.uniciteTexteMetier,
  texteAutre: SEUILS.uniciteTexteAutre,
  teinteVoisin: SEUILS.uniciteTeinteVoisin,
};

/** Un refus d'unicité peut revenir deux fois au même agent (il a des choix à refaire, pas une faute de forme). */
const RENVOIS_UNICITE = 2;

const MIN = 60_000;
const p = (ctx: EtapeContexte, ...parts: string[]) => join(ctx.siteDir, ...parts);
const lire = (f: string) => readFileSync(f, "utf8");
/** Un fichier passé à un agent : son chemin exact et son contenu exact. */
const fichier = (chemin: string, nom: string) => `<fichier chemin="${nom}">\n${lire(chemin).trim()}\n</fichier>`;

/** Journal en direct de l'Intégrateur, avec des chemins relatifs au dossier du site (plus lisibles). */
function relayer(ctx: EtapeContexte) {
  // Claude Code écrit les chemins avec « / » ou « \ » selon l'outil : les deux formes sont retirées.
  const dossier = ctx.siteDir.replace(/[\\/]+$/, "");
  const prefixes = [dossier + "\\", dossier.replace(/\\/g, "/") + "/"];
  return (e: { kind: "text" | "tool" | "error"; text: string }) => {
    let t = e.text;
    for (const pre of prefixes) t = t.split(pre).join("");
    ctx.job.log(e.kind, t);
  };
}

// ── Registre : ce que les agents reçoivent ──────────────────────────────────

const RELATIONS = { voisin: "même métier, même zone", metier: "même métier, autre zone", zone: "autre métier, même zone" } as const;

/**
 * Écrit les extraits du registre lus par les agents : `unicite-design.json` (DA : empreintes des sites du même métier
 * et de la zone, interdits) et `unicite-textes.json` (Rédacteur : titres et phrases des sites du même métier).
 */
function ecrireRegistre(ctx: EtapeContexte, b: Brief): { proches: number; phrases: number } {
  const siege = b.zone.siege.valeur;
  const metier = b.entreprise.metier.kit;
  const zoneKm = SEUILS.uniciteZoneKm;
  const autres = ctx.registre.autres(ctx.siteId, ctx.company.id).map((e) => {
    const km = distanceKm(siege, e);
    const proche = km !== null && km <= zoneKm;
    const relation = e.metier === metier ? (proche ? "voisin" : "metier") : proche ? "zone" : null;
    return { e, km, relation };
  });
  const proches = autres
    .filter((x): x is typeof x & { relation: keyof typeof RELATIONS } => x.relation !== null)
    .sort((x, y) => ["voisin", "metier", "zone"].indexOf(x.relation) - ["voisin", "metier", "zone"].indexOf(y.relation) || (x.km ?? 999) - (y.km ?? 999));
  const voisins = proches.filter((x) => x.relation === "voisin");
  const teinte = (hex: string) => Math.round(oklab(hex).h);
  writeJson(p(ctx, "unicite-design.json"), {
    regle: `Sites déjà produits par Liverdian du même métier (${b.entreprise.metier.libelle}) ou à moins de ${zoneKm} km de ${siege.nom}. Le tien doit se distinguer de chacun au premier coup d'œil (skill unicite-des-sites). Le hub mesure une distance de design pondérée : minimum ${SEUILS.uniciteDistanceVoisin} avec un site du même métier dans la zone, ${SEUILS.uniciteDistanceMetier} avec un site du même métier ailleurs, ${SEUILS.uniciteDistanceZone} avec un autre métier dans la zone (0 = identique, 1 = tout diffère).`,
    poidsDuCalcul: "accent 3 · police des titres 2 · variante du hero 2 · ordre des sections 2 · sombre 1,5 · signature 1,5 · photo du hero 1,5 · police du texte 1 · variantes des sections 1 · mise en page (échelle, densité, images, cadre, boutons, rythme, casse, surtitres) 0,4 à 0,6 chacun · en-tête, pied, fond clair 0,5 · rayon 0,4",
    sitesProches: proches.map(({ e, km, relation }) => ({
      site: e.nom,
      commune: e.commune,
      km,
      relation: RELATIONS[relation],
      origine: e.origine === "exemple" ? "exemple du kit" : "maquette",
      accent: `${e.empreinte.couleurs.accent} (teinte ${teinte(e.empreinte.couleurs.accent)}°)`,
      sombre: `${e.empreinte.couleurs.sombre} (teinte ${teinte(e.empreinte.couleurs.sombre)}°)`,
      fond: e.empreinte.couleurs.fond,
      polices: `${e.empreinte.polices.titres} / ${e.empreinte.polices.corps}${e.empreinte.paire ? ` (paire ${e.empreinte.paire})` : ""}`,
      signature: e.empreinte.signature,
      rayon: e.empreinte.rayon,
      mise: e.empreinte.mise,
      entete: e.empreinte.entete,
      pied: e.empreinte.pied,
      sections: e.empreinte.sections.join(" → "),
      photoHero: e.empreinte.heroImage,
      surMesure: e.empreinte.surMesure?.element ?? null,
    })),
    // Tirée au sort par le code (graine : le site), pondérée pour s'écarter des choix des sites proches.
    pisteDeDepart: pisteDeDepart(`${ctx.siteId}${ctx.refaire ? ":refaire" : ""}`, proches.map((x) => x.e.empreinte)),
    interdits: {
      photosHero: b.banqueImages.filter((i) => i.exclueHero).map((i) => `${i.fichier} : ${i.exclueHero}`),
      pairesDePolices: voisins.map(({ e }) => `${e.empreinte.polices.titres} / ${e.empreinte.polices.corps} (${e.nom})`),
      teintesAccent: voisins.map(({ e }) => `${teinte(e.empreinte.couleurs.accent)}° (${e.empreinte.couleurs.accent}, ${e.nom}) : rester à ${SEUILS.uniciteTeinteVoisin}° au moins, ou changer franchement de luminosité`),
    },
  });
  const memeMetier = autres.filter((x) => x.e.metier === metier);
  const unique = (l: string[]) => [...new Set(l)];
  const titres = unique(memeMetier.flatMap((x) => x.e.empreinte.titres ?? [])).slice(0, 200);
  const phrases = unique(memeMetier.flatMap((x) => x.e.empreinte.phrases ?? [])).slice(0, 300);
  writeJson(p(ctx, "unicite-textes.json"), {
    regle: `Titres et phrases déjà employés par les sites ${b.entreprise.metier.libelle.toLowerCase()} de Liverdian (${memeMetier.map((x) => `${x.e.nom}, ${x.e.commune}`).join(" ; ") || "aucun"}). N'en reprends aucun, même reformulé de près, ni leur structure (skill unicite-des-sites). Le hub compare les textes par suites de 5 mots (nom de l'entreprise et communes neutralisés) : similarité maximale ${SEUILS.uniciteTexteMetier}.`,
    titres,
    phrases,
  });
  return { proches: proches.length, phrases: titres.length + phrases.length };
}

// ── 1. Brief ────────────────────────────────────────────────────────────────

const brief: EtapeDef = {
  id: "brief",
  label: "Brief",
  detail: "Données de la fiche, sources, prestations du NAF, communes, banque d'images et son usage, registre des sites",
  agent: null,
  groupe: "fabrication",
  async run(ctx) {
    mkdirSync(ctx.siteDir, { recursive: true });
    await ctx.registre.pret;
    const entree = { company: ctx.company, siteId: ctx.siteId, recette: ctx.recette.id, now: ctx.now(), credits: ctx.kit.credits(), zoneKm: SEUILS.uniciteZoneKm };
    // Le siège n'est connu qu'une fois le brief calculé : un premier passage le donne, le second ajoute l'usage des photos.
    const siege = buildBrief(entree).zone.siege.valeur;
    const b = buildBrief({ ...entree, usagePhotos: ctx.registre.usagePhotos(ctx.siteId, ctx.company.id, siege) });
    writeJson(p(ctx, "brief.json"), b);
    const reg = ecrireRegistre(ctx, b);
    // Photos candidates copiées dans un dossier lisible par la vision du Directeur artistique (Read seulement).
    const cand = p(ctx, ".atelier", "candidats");
    rmSync(cand, { recursive: true, force: true });
    mkdirSync(cand, { recursive: true });
    for (const im of b.banqueImages.filter((i) => i.candidate)) {
      copyFileSync(join(ctx.kit.root, im.fichier), join(cand, im.fichier.replace(/^stock\//, "").replace(/\//g, "__")));
    }
    const n = b.banqueImages.filter((i) => i.candidate).length;
    const exclues = b.banqueImages.filter((i) => i.candidate && i.exclueHero).length;
    return {
      issue: "suite",
      resume: `${b.entreprise.metier.libelle} à ${b.zone.siege.valeur.nom} · ${b.activite.prestationsPlausibles.length} prestations plausibles (NAF ${b.activite.naf}) · ${b.zone.voisines ? `${b.zone.voisines.valeur.length} communes voisines saisies` : `${b.zone.candidates.length} communes candidates`} · ${n} photos candidates (${exclues} exclue(s) du hero) · ${reg.proches} site(s) proche(s) au registre · démo supprimée le ${b.demo.dateSuppression.valeur}`,
      sortie: { metier: b.entreprise.metier.libelle, commune: b.zone.siege.valeur.nom, photos: n, photosExcluesHero: exclues, sitesProches: reg.proches, phrasesConnues: reg.phrases, dateSuppression: b.demo.dateSuppression.valeur },
    };
  },
};

// ── 2. Direction artistique ─────────────────────────────────────────────────

const liste = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `  - ${k} : ${v}`)
    .join("\n");

async function promptDA(ctx: EtapeContexte, b: Brief): Promise<string> {
  const cat = await ctx.kit.catalogue();
  const precedent = ctx.refaire && existsSync(p(ctx, "design-precedent.json")) ? p(ctx, "design-precedent.json") : null;
  const paires = Object.entries(cat.paires)
    .map(([id, d]) => `  - ${id} [${d.caractere}] ${d.titres} / ${d.corps} : ${d.description} (convient : ${d.metiers.join(", ")})`)
    .join("\n");
  return [
    `Tu conçois la direction artistique de la maquette d'un site vitrine d'une page pour « ${b.entreprise.nomAffiche} », ${b.entreprise.metier.libelle.toLowerCase()} à ${b.zone.siege.valeur.nom}.`,
    "Cette maquette sera montrée à l'artisan pour le convaincre : elle doit être au niveau d'une agence (skill web-design-pro), propre à cette entreprise, et ne ressembler à AUCUN autre site produit par Liverdian (skill unicite-des-sites).",
    "Un artisan qui verrait ce site à côté de ceux du registre doit croire à des agences différentes : pars de ce que l'entreprise a de singulier (nom, commune, ancienneté, prestations, quartier), pas du préréglage du métier.",
    "",
    "## Entrées (fichiers exacts)",
    fichier(p(ctx, "brief.json"), "brief.json"),
    fichier(p(ctx, "unicite-design.json"), "unicite-design.json"),
    "",
    "## Photos",
    "Les photos candidates (banqueImages avec candidate=true) sont copiées pour toi : le nom du fichier image est le chemin de la banque où « / » est remplacé par « __ » (ex. electricien__tableau-electrique-01.jpg = stock/electricien/tableau-electrique-01.jpg).",
    "Regarde CHAQUE photo avec l'outil Read avant de choisir. Juge la lumière, la netteté, la cohérence entre elles, la place libre pour un texte, la crédibilité pour un artisan de la région lyonnaise (pas de décor exotique). Les descriptions du brief peuvent être approximatives : seul ce que tu vois compte.",
    "La photo du hero doit dire le métier sans ambiguïté au premier coup d'œil et s'accorder à la palette. Une photo marquée « exclueHero » ne peut PAS servir de hero (déjà en hero chez un site proche) ; elle reste possible ailleurs.",
    "Hero « photo » seulement si une photo est excellente ET calme du côté du texte ; sinon « scinde », « panorama », « encart » (photo sans texte dessus) ou « typo » (aucune photo).",
    "Moins mais mieux : 3 à 6 photos cohérentes entre elles valent mieux que 8 moyennes. N'utilise que des photos candidates.",
    "",
    "## Ce que le kit te permet de composer (catalogue exact)",
    "Variantes de section :",
    ...Object.entries(cat.variantes).map(([t, v]) => `- ${t}\n${liste(v)}`),
    `En-têtes :\n${liste(cat.entetes)}`,
    `Pieds de page :\n${liste(cat.pieds)}`,
    `Signatures (motif de fond, marqueur de surtitre, cadre par défaut) :\n${liste(cat.signatures)}`,
    "Mise en page (theme.mise, indépendante des couleurs) :",
    ...Object.entries(cat.mise).map(([k, v]) => `- ${k}\n${liste(v)}`),
    "Palette (theme.palette) : le code calcule les 14 couleurs à partir de tes intentions et garantit les contrastes AA.",
    ...Object.entries(cat.palette).map(([k, v]) => (typeof v === "string" ? `- ${k} : ${v}` : `- ${k}\n${liste(v)}`)),
    `Paires de polices (theme.polices.paire) :\n${paires}`,
    "Rayon (theme.rayon) : 0, 2, 4, 6, 8, 12 ou 16 px.",
    "",
    "## Piste de départ (unicite-design.json > pisteDeDepart)",
    "Le hub a tiré au sort, pour ce site, une piste qui s'écarte des sites proches : variante du hero, variantes et ordre des sections, en-tête, pied, signature, paire de polices, rayon, mise en page, palette et une famille d'idée pour l'élément sur mesure.",
    "PARS DE CETTE PISTE. Elle existe parce que des directeurs artistiques laissés libres convergent tous vers les mêmes choix. Tu peux changer un choix s'il dessert vraiment ce site (photos qui ne s'y prêtent pas, incohérence avec le métier) : dis lequel et pourquoi dans « ajustements ». Garde au moins les deux tiers des choix.",
    "Tu restes maître de tout le reste : quelles photos, combien d'éléments, les fonds imposés, l'élément sur mesure lui-même, et la cohérence d'ensemble au niveau d'une agence.",
    "",
    "## Unicité (bloquant, contrôlé par le code dès ta sortie)",
    "- Lis unicite-design.json : pour chaque site proche, ne reprends ni sa paire de polices, ni sa teinte d'accent (au moins 25° d'écart sur le cercle, ou un accent de luminosité franchement différente), ni sa photo de hero, ni sa variante de hero ET son ordre de sections.",
    "- Varie franchement les axes : variante du hero, ordre et variantes des sections, paire de polices, signature, mise en page (échelle, boutons, traitement des photos, rythme, casse des titres), en-tête et pied. Change au moins 3 choix structurants par rapport au site le plus proche.",
    "- Ne pars pas d'un préréglage tel quel : la palette est la tienne (teinte des neutres, teinte d'accent, sombre), choisie pour cette entreprise.",
    "",
    "## Élément sur mesure (obligatoire)",
    "Imagine UN élément qui n'existe dans aucun autre site : une section, un traitement graphique ou une interaction sobre conçue pour CETTE entreprise (ex. frise « de la panne à la remise en service » pour un dépanneur, schéma SVG d'un tableau électrique annoté pour un électricien qui fait des mises aux normes, nuancier de tuiles pour un couvreur, carte des communes avec repères du quartier, illustration d'un détail du métier).",
    "Il doit rester vrai : aucun fait, chiffre, délai ou label hors du brief ; un schéma pédagogique du métier est permis s'il ne prétend rien sur l'entreprise.",
    "Place-le dans sections (type « surmesure », variante « composant », nombreItems si l'élément a des éléments) et décris-le dans surMesure : nom, composant (PascalCase), description assez précise pour être codée sans deviner (composition au bureau, à 768 et à 375 px, jetons du thème, ce qui est SVG/décor), textes à écrire par le Rédacteur, et pourquoi il appartient à cette entreprise.",
    "L'Intégrateur le codera avec les mêmes jetons et les mêmes exigences de qualité (Lighthouse, accessibilité, revue visuelle).",
    ...(precedent ? ["", "## Refaire demandé", "Le propriétaire a demandé de refaire la maquette. Voici le design précédent : propose une direction nettement différente (palette, polices, hero, composition, élément sur mesure).", fichier(precedent, "design-precedent.json")] : []),
    "",
    "## Ce que tu rends (design.json)",
    `- intention : exactement 3 phrases (pour qui, quelle impression, ce qui distingue ce site).`,
    "- theme : preset (caractère de départ), palette (toutes les intentions), polices.paire, rayon, signature, mise (les 8 axes) ; couleurs : seulement une surcharge précise si nécessaire (elle sera vérifiée).",
    "- ajustements : ce qui distingue ce site de chaque site proche du registre, et pourquoi ces choix.",
    "- entete, pied : une variante du catalogue.",
    "- images : clé courte, chemin exact « stock/… », alt qui décrit ce que montre vraiment la photo, focale si le sujet n'est pas centré, justification.",
    "- sections dans l'ordre. Règles du kit : hero en premier (exactement un), une section devis, une section surmesure, jamais deux sections du même type à la suite, « avis » seulement si la note Google existe, zone « carte » seulement si brief.zone.carteDisponible ; fond facultatif pour imposer un fond.",
    "  Indique nombreItems pour services (3 à 6, choisis parmi activite.prestationsPlausibles), pourquoi (2 à 4 arguments VÉRIFIABLES dans le brief ; s'il n'y en a pas assez, supprime la section) et surmesure (si l'élément en a).",
    "  images : réalisations = clés dans l'ordre (mosaïque : 5 idéal ; grille : 3, 6 ou 8 ; bande : 4 à 8 ; diptyque : 2 à 6) ; services « bandes » = une image par service (2 à 4) ; services « liste » = image du 1er service ; pourquoi « encadre » = image requise.",
    `- zoneVoisines : ${b.zone.voisines ? "ne rien mettre (la fiche a ses communes voisines)." : "4 à 8 noms exacts choisis dans brief.zone.candidates."}`,
    "- signature : l'élément signature du site (motif, traitement des titres, mot géant…) et pourquoi il convient.",
    "- surMesure : voir plus haut.",
    ...(ctx.renvoi ? ["", "## Refus à corriger (message exact du contrôle)", ctx.renvoi, "Corrige ces points précisément, sans changer ce qui était bon."] : []),
  ].join("\n");
}

function verifierDesign(b: Brief, d: Design): string[] {
  const refus: string[] = [];
  const candidates = new Set(b.banqueImages.filter((i) => i.candidate).map((i) => i.fichier));
  const exclues = new Map(b.banqueImages.filter((i) => i.exclueHero).map((i) => [i.fichier, i.exclueHero!]));
  const cles = new Set(d.images.map((i) => i.cle));
  const fichierDe = (cle: string | undefined) => d.images.find((i) => i.cle === cle)?.fichier;
  for (const im of d.images) if (!candidates.has(im.fichier)) refus.push(`images.${im.cle} : « ${im.fichier} » n'est pas une photo candidate`);
  d.sections.forEach((s, i) => {
    if (!VARIANTES[s.type].includes(s.variante)) refus.push(`sections[${i}] (${s.type}) : variante « ${s.variante} » inconnue (${VARIANTES[s.type].join(" | ")})`);
    for (const k of [s.image, ...(s.images ?? [])]) if (k && !cles.has(k)) refus.push(`sections[${i}] : image « ${k} » absente de « images »`);
    if (i > 0 && d.sections[i - 1]!.type === s.type) refus.push(`sections[${i}] : deux sections « ${s.type} » à la suite`);
    if (s.type === "avis" && !b.entreprise.noteGoogle) refus.push(`sections[${i}] : « avis » sans note Google`);
    if (s.type === "zone" && s.variante === "carte" && !b.zone.carteDisponible) refus.push(`sections[${i}] : zone « carte » impossible (coordonnées manquantes)`);
    if ((s.type === "hero" && s.variante !== "typo" && !s.image) || (s.type === "services" && s.variante === "bandes" && !(s.images?.length && s.images.length <= 4)) || (s.type === "pourquoi" && s.variante === "encadre" && !s.image)) {
      refus.push(`sections[${i}] (${s.type} ${s.variante}) : image(s) manquante(s)`);
    }
    if (s.type === "hero" && s.image) {
      const f = fichierDe(s.image);
      if (f && exclues.has(f)) refus.push(`sections[${i}] (hero) : la photo « ${f} » est exclue du hero (${exclues.get(f)}) ; choisis une autre photo de hero`);
    }
    const n = s.images?.length ?? 0;
    if (s.type === "realisations" && (n < (s.variante === "diptyque" ? 2 : 3) || n > (s.variante === "diptyque" ? 6 : 8))) refus.push(`sections[${i}] (réalisations ${s.variante}) : ${s.variante === "diptyque" ? "2 à 6" : "3 à 8"} images`);
  });
  if (d.sections[0]?.type !== "hero") refus.push("sections[0] : le hero doit être la première section");
  if (!d.sections.some((s) => s.type === "devis")) refus.push("sections : il manque la section devis");
  const sm = d.sections.filter((s) => s.type === "surmesure").length;
  if (sm !== 1) refus.push(`sections : il faut exactement une section « surmesure » pour l'élément sur mesure (${sm} reçue(s))`);
  return refus;
}

/** site.json provisoire tiré du design seul (sans textes), pour mesurer l'unicité du design dès la sortie du DA. */
function siteProvisoire(b: Brief, d: Design): Record<string, unknown> {
  const hero = d.sections.find((s) => s.type === "hero");
  return {
    entreprise: { raisonSociale: b.entreprise.raisonSociale.valeur, nomCommercial: b.entreprise.nomCommercial?.valeur, metier: b.entreprise.metier.kit, adresse: b.entreprise.adresse.valeur },
    zone: { commune: { nom: b.zone.siege.valeur.nom, ...(b.zone.siege.valeur.lat !== null ? { lat: b.zone.siege.valeur.lat, lon: b.zone.siege.valeur.lon } : {}) }, voisines: [] },
    theme: d.theme,
    images: Object.fromEntries(d.images.map((i) => [i.cle, { fichier: i.fichier }])),
    entete: d.entete,
    pied: d.pied,
    sections: d.sections.map((s) => ({ type: s.type, variante: s.variante, ...(s.type === "surmesure" ? { composant: d.surMesure.composant } : {}), contenu: s === hero && s.image ? { image: s.image } : {} })),
  };
}

const da: EtapeDef = {
  id: "da",
  label: "Direction artistique",
  detail: "Palette, polices, mise en page, variantes et ordre des sections, photos, signature, élément sur mesure",
  agent: "directeur-artistique",
  groupe: "fabrication",
  essais: 2,
  async run(ctx) {
    const b = readJson<Brief>(p(ctx, "brief.json"));
    await ctx.registre.pret;
    // Nouveau design en chantier : l'ancien ne doit plus servir de référence aux fabrications parallèles.
    ctx.registre.retirer(ctx.siteId);
    // Le registre a pu changer depuis le brief (un autre site validé entre-temps) : extraits rafraîchis.
    ecrireRegistre(ctx, b);
    ctx.job.progress({ label: "Le Directeur artistique regarde les photos et compose le site…" });
    const r = await ctx.agents.ask({
      agent: "directeur-artistique",
      prompt: await promptDA(ctx, b),
      schema: DesignSchema,
      imagesDir: p(ctx, ".atelier", "candidats"),
      jobId: ctx.job.job.id,
      signal: ctx.job.signal,
      timeoutMs: 20 * MIN,
      summary: `Direction artistique : ${b.entreprise.nomAffiche}`,
    });
    const design = r.data;
    writeJson(p(ctx, "design.json"), design);
    // Contrôles du design par le code : photos, variantes, règles du kit, contrastes, puis unicité du design.
    const refus = [...verifierDesign(b, design)];
    refus.push(...(await ctx.kit.contrastes(design.theme)).map((e) => `theme : ${e}`));
    const sortie = {
      intention: design.intention,
      theme: design.theme,
      ajustements: design.ajustements,
      signature: design.signature,
      sections: design.sections.map((s) => `${s.type} ${s.variante}`),
      images: design.images.map((i) => ({ cle: i.cle, fichier: i.fichier, justification: i.justification })),
      surMesure: design.surMesure,
    };
    if (refus.length) {
      return { issue: "renvoi", vers: "da", cle: "da:design", message: refus.map((m) => `- ${m}`).join("\n"), resume: `Design refusé par le contrôle du hub (${refus.length} point(s))`, sortie: { ...sortie, refus } };
    }
    const moi = await ctx.registre.empreinte(siteProvisoire(b, design), design);
    const v = verifierUnicite(moi, [], ctx.registre.comparables(ctx.siteId, ctx.company.id), SEUILS_UNICITE);
    if (!v.ok) {
      return {
        issue: "renvoi",
        vers: "da",
        cle: "unicite:directeur-artistique",
        max: RENVOIS_UNICITE,
        message: `Contrôle d'unicité du design (registre des sites) :\n${messageConflits(v.conflits)}`,
        resume: `Design trop proche d'un site existant : ${v.conflits.map((c) => c.site.nom).join(", ")}`,
        sortie: { ...sortie, unicite: resumeUnicite(v) },
      };
    }
    return {
      issue: "suite",
      resume: `${design.theme.polices.paire} · accent ${moi.couleurs.accent} · ${design.sections.map((s) => `${s.type} ${s.variante}`).join(" → ")} · sur mesure : ${design.surMesure.element}${v.plusProche ? ` · le plus proche : ${v.plusProche.nom} (${v.plusProche.distance.toFixed(2)})` : ""}`,
      sortie: { ...sortie, unicite: resumeUnicite(v) },
    };
  },
};

// ── 3. Rédaction ────────────────────────────────────────────────────────────

const CHAMPS_REDACTION = `Champs à remplir par type de section (longueurs maximales en caractères ; tout le reste est interdit) :
- hero : titre (H1 unique, 4 à 9 mots, métier + commune, ≤ 90), titreAccent? (extrait EXACT du titre, ≤ 60), sousTitre (1 phrase, ≤ 220), surtitre? (≤ 60), afficherNote? (true si note Google), reperes? (≤ 3 faits courts SOURCÉS, ≤ 48 chacun), boutonAppel? (≤ 24), boutonDevis? (≤ 28), motSignature? (hero typo seulement : un mot ≤ 16, ex. « Courant »)
- services : surtitre? (≤ 48), titre (≤ 90), intro? (≤ 320), items [{ titre (2 à 4 mots, ≤ 48), texte (1 à 2 phrases, ≤ 280), icone (nom Lucide : zap, plug, plug-zap, lightbulb, lamp-ceiling, shield-check, circuit-board, cable, house, fan, thermometer, car, wrench, droplets, flame, hammer, paint-roller, ruler…), points? (≤ 4 × 80, variantes liste/bandes/index/tuiles seulement) }]
- pourquoi : surtitre?, titre (≤ 110), intro? (≤ 320), items [{ titre (≤ 60), texte (≤ 260), icone? }]
- realisations : surtitre?, titre (≤ 90), intro? (≤ 320), legendes (une par image du design, ≤ 90 ; décrire ce que montre la photo : ce sont des photos d'illustration, ne pas prétendre que ce sont les chantiers de l'entreprise)
- avis : surtitre?, titre (≤ 90), texte? (≤ 260) — jamais de texte d'avis inventé ; la note et le nombre exacts du brief
- zone : surtitre?, titre (≤ 90), intro? (≤ 320)
- appel : titre (≤ 90), texte? (≤ 220)
- devis : surtitre?, titre (≤ 90), intro (ce qui se passe après l'envoi, sans délai inventé, ≤ 320), besoins? (≤ 10 × 48), boutonEnvoyer? (≤ 28)
- surmesure (élément sur mesure, voir design.surMesure.textes) : surtitre? (≤ 48), titre (≤ 90), intro? (≤ 320), elements? [{ titre (≤ 60), texte? (≤ 260), detail? (≤ 80) }] (nombreItems du design), boutonAppel? (≤ 24), boutonDevis? (≤ 28) ; rien d'autre
Hors sections : seo.titre? (≤ 60, « Métier à Commune | Nom »), seo.description (140 à 160 caractères, avec commune et service principal), piedPhrase? (≤ 200),
zonePrecision? (≤ 120, affiché avec la carte), horairesNote? (≤ 120, seulement si les horaires du brief l'exigent), enteteBoutonDevis? (≤ 24).`;

const redaction: EtapeDef = {
  id: "redaction",
  label: "Rédaction",
  detail: "Textes de chaque section et de l'élément sur mesure, SEO local, rien d'inventé, aucune phrase déjà employée",
  agent: "redacteur",
  groupe: "fabrication",
  essais: 2,
  async run(ctx) {
    const b = readJson<Brief>(p(ctx, "brief.json"));
    const prompt = [
      `Tu écris tous les textes de la maquette du site de « ${b.entreprise.nomAffiche} », ${b.entreprise.metier.libelle.toLowerCase()} à ${b.zone.siege.valeur.nom}.`,
      "Le Directeur artistique a fixé les sections, leur ordre et leurs variantes (design.json) : tu rends exactement les mêmes sections, dans le même ordre, avec le nombre d'éléments demandé (nombreItems, une légende par image).",
      "",
      "## Entrées (fichiers exacts)",
      fichier(p(ctx, "brief.json"), "brief.json"),
      fichier(p(ctx, "design.json"), "design.json"),
      fichier(p(ctx, "unicite-textes.json"), "unicite-textes.json"),
      "",
      "## Règles",
      "- Chaque fait vient du brief (voir brief.regles). Les prestations sont choisies dans activite.prestationsPlausibles, reformulées en mots du quotidien ; pas d'autre prestation.",
      "- Interdits sans source : années d'expérience, nombre de chantiers, délais (« en 1 h », « sous 24 h »), « devis gratuit », garanties, labels, urgences 24/7, prix, « artisan qui répond lui-même » si le brief ne dit pas que l'entreprise est unipersonnelle.",
      "- Permis : l'année de création si brief.entreprise.dateCreation existe (« depuis 2019 »), la commune du siège, les communes de la zone, la note Google exacte et son nombre d'avis, le téléphone, ce que couvre normalement le métier.",
      "- Ancrage local vrai : la commune et ses voisines, le type de logements de l'est lyonnais (appartements, maisons de ville, pavillons) si c'est général et non une affirmation sur l'entreprise.",
      "- Voix : un artisan sérieux qui parle à un particulier ; phrases courtes, concrètes, vouvoiement ; aucun cliché de la liste du skill ; rien qu'on pourrait coller sur le site d'un concurrent.",
      "- Arguments (pourquoi) : uniquement vérifiables dans le brief. Les titres d'argument disent un fait, pas un adjectif.",
      "- Unicité (bloquant, skill unicite-des-sites) : unicite-textes.json liste les titres et phrases des autres sites du même métier. N'en reprends aucun, ni leur structure (« Votre X à Y, du A au B » ne sert qu'une fois). Titre du hero, titres de section et sous-titre : formulations neuves, propres à cette entreprise.",
      "- Élément sur mesure : écris exactement ce que demande design.surMesure.textes, avec la même exigence de vérité.",
      "- Typographie : écris en français normal ; espaces insécables et guillemets sont posés au build.",
      "",
      CHAMPS_REDACTION,
      "",
      "Dans « laisseDeCote », note ce que tu aurais aimé dire mais que le brief ne permet pas (ex. « pas de dirigeant connu : pas de prénom »).",
      ...(ctx.renvoi ? ["", "## Refus à corriger (message exact du contrôle)", ctx.renvoi, "Corrige ces points précisément, sans changer ce qui était bon."] : []),
    ].join("\n");
    ctx.job.progress({ label: "Le Rédacteur écrit les textes…" });
    const r = await ctx.agents.ask({ agent: "redacteur", prompt, schema: ContenuSchema, jobId: ctx.job.job.id, signal: ctx.job.signal, timeoutMs: 15 * MIN, summary: `Rédaction : ${b.entreprise.nomAffiche}` });
    writeJson(p(ctx, "content.json"), r.data);
    const hero = r.data.sections.find((s) => s.type === "hero");
    return { issue: "suite", resume: `« ${hero?.titre ?? "?"} » · ${r.data.sections.length} sections`, sortie: { titre: hero?.titre, sousTitre: hero?.sousTitre, seo: r.data.seo, laisseDeCote: r.data.laisseDeCote } };
  },
};

// ── 4. Assemblage ───────────────────────────────────────────────────────────

const assemblage: EtapeDef = {
  id: "assemblage",
  label: "Assemblage",
  detail: "site.json validé par le schéma du kit, projet Astro généré",
  agent: null,
  groupe: "fabrication",
  async run(ctx) {
    const b = readJson<Brief>(p(ctx, "brief.json"));
    const design = DesignSchema.parse(readJson(p(ctx, "design.json")));
    const contenu: Contenu = ContenuSchema.parse(readJson(p(ctx, "content.json")));
    const renvoyer = (refus: Refus[], source: string): Issue => {
      // L'agent fautif d'abord : le Directeur artistique (ses choix conditionnent les textes), sinon le Rédacteur.
      const agent = refus.some((r) => r.agent === "directeur-artistique") ? "directeur-artistique" : "redacteur";
      const lignes = refus.filter((r) => r.agent === agent).map((r) => `- ${r.message}`);
      return {
        issue: "renvoi",
        vers: agent === "directeur-artistique" ? "da" : "redaction",
        cle: `${agent}:assemblage`,
        message: `${source} :\n${lignes.join("\n")}`,
        resume: `Refusé (${source}) : renvoyé au ${agent === "directeur-artistique" ? "Directeur artistique" : "Rédacteur"} (${lignes.length} point(s))`,
        sortie: { refus },
      };
    };
    const coherence = verifierCoherence(b, design, contenu, ctx.kit.icones());
    if (coherence.length) return renvoyer(coherence, "Contrôle de cohérence du hub");
    const site = assembler(b, design, contenu);
    writeJson(p(ctx, "site.json"), site);
    ctx.job.progress({ label: "Génération du projet Astro…" });
    const r = await ctx.kit.newSite(ctx.siteDir, p(ctx, "site.json"), ctx.job.signal);
    if (!r.ok) {
      const erreurs = r.erreurs.length ? r.erreurs : [r.message];
      const refus: Refus[] = [];
      const orphelines: string[] = [];
      for (const e of erreurs) {
        const agent = attribuer(e, site);
        if (agent) refus.push({ agent, message: e });
        else orphelines.push(e);
      }
      if (orphelines.length) return { issue: "arret", motif: `Le site assemblé par le hub est refusé par le kit (défaut du hub, pas d'un agent) : ${orphelines.join(" ; ")}`, resume: "Refus du kit non attribuable" };
      return renvoyer(refus, `Schéma du kit (${r.message})`);
    }
    // Toutes les photos candidates sont mises à disposition dans le site (new-site ne copie que les photos citées) :
    // en correction, l'Intégrateur peut en changer sans sortir de son dossier.
    for (const im of b.banqueImages.filter((i) => i.candidate)) {
      const cible = p(ctx, ...im.fichier.split("/"));
      if (!existsSync(cible)) {
        mkdirSync(join(cible, ".."), { recursive: true });
        copyFileSync(join(ctx.kit.root, im.fichier), cible);
      }
    }
    return { issue: "suite", resume: `site.json valide · projet généré (${design.sections.length} sections, ${design.images.length} photos)` };
  },
};

// ── 5. Unicité (après l'assemblage, puis à chaque passage des contrôles) ───

/** Ce que l'écran du site affiche : site le plus proche, distance, similarité de texte. */
function resumeUnicite(v: VerdictUnicite) {
  return {
    ok: v.ok,
    plusProche: v.plusProche ? { site: v.plusProche.nom, commune: v.plusProche.commune, origine: v.plusProche.origine, km: v.plusProche.km, distance: v.plusProche.distance, seuil: v.plusProche.seuilDistance } : null,
    texteMax: v.texteMax ? { site: v.texteMax.nom, commune: v.texteMax.commune, similarite: v.texteMax.similarite, seuil: v.texteMax.seuilTexte } : null,
    conflits: v.conflits,
    comparaisons: v.comparaisons,
  };
}

async function controleUnicite(ctx: EtapeContexte, phase: "fabrication" | "controle"): Promise<Issue> {
  await ctx.registre.pret;
  const site = readJson<Record<string, unknown>>(p(ctx, "src", "data", "site.json"));
  const design = existsSync(p(ctx, "design.json")) ? readJson<Design>(p(ctx, "design.json")) : null;
  const moi = await ctx.registre.empreinte(site, design);
  const v = verifierUnicite(moi, motsDe(site), ctx.registre.comparables(ctx.siteId, ctx.company.id), SEUILS_UNICITE);
  const sortie = resumeUnicite(v);
  mkdirSync(p(ctx, ".atelier"), { recursive: true });
  writeJson(p(ctx, ".atelier", "unicite.json"), { mesureLe: ctx.now().toISOString(), seuils: SEUILS_UNICITE, ...sortie });
  const pp = v.plusProche;
  const tm = v.texteMax;
  const resume = pp
    ? `Unicité : site le plus proche = ${pp.nom} (${pp.commune}), distance ${pp.distance.toFixed(2)}${pp.seuilDistance !== null ? ` (min ${pp.seuilDistance})` : ""}, similarité texte ${tm ? `${tm.similarite.toFixed(3)} (${tm.nom})` : "0"}`
    : "Unicité : aucun autre site au registre";
  if (v.ok) {
    // Inscrit tout de suite (et met à jour à chaque passage) : une fabrication menée en parallèle se compare déjà à ce site.
    await ctx.registre.inscrire(ctx.siteId);
    return phase === "controle" ? { issue: "controle", ok: true, resume, sortie, consignes: [] } : { issue: "suite", resume, sortie };
  }
  // Le Directeur artistique d'abord (un nouveau design entraîne de nouveaux textes), sinon le Rédacteur.
  const agent = v.conflits.some((c) => c.agent === "directeur-artistique") ? "directeur-artistique" : "redacteur";
  return {
    issue: "renvoi",
    vers: agent === "directeur-artistique" ? "da" : "redaction",
    cle: `unicite:${agent}`,
    max: RENVOIS_UNICITE,
    message: `Contrôle d'unicité (registre des sites) — ${agent === "directeur-artistique" ? "le design" : "le texte"} est trop proche d'un site existant :\n${messageConflits(v.conflits.filter((c) => c.agent === agent))}`,
    resume: `${resume} — refusé, renvoyé au ${agent === "directeur-artistique" ? "Directeur artistique" : "Rédacteur"}`,
    sortie,
  };
}

const unicite: EtapeDef = {
  id: "unicite",
  label: "Unicité",
  detail: "Distance de design et similarité de texte avec chaque site du registre",
  agent: null,
  groupe: "fabrication",
  run: (ctx) => controleUnicite(ctx, "fabrication"),
};

const uniciteControle: EtapeDef = {
  id: "unicite-controle",
  label: "Unicité (contrôle)",
  detail: "Même mesure, sur le site corrigé",
  agent: null,
  groupe: "controle",
  run: (ctx) => controleUnicite(ctx, "controle"),
};

// ── 6. Élément sur mesure ───────────────────────────────────────────────────

const REGLES_INTEGRATEUR = `Règles :
- Tu travailles dans le dossier du site (projet Astro du kit Liverdian, voir le skill astro-site-kit). Les données sont dans
  src/data/site.json ; les sections dans src/sections/ (copie propre à ce site, modifiable) ; l'élément sur mesure dans
  src/sections/custom/.
- Ne modifie jamais brief.json, design.json, content.json, unicite-*.json ni les dossiers .atelier/ et .check/ (ce sont les entrées et les preuves).
- Aucun fait nouveau : tout texte factuel doit venir de brief.json (règles de la maison).
- Garde les jetons du thème, l'accessibilité (contraste AA, focus visible, cibles ≥ 44 px) et zéro JavaScript inutile.
- Commandes : tu es déjà dans le dossier du site. Seules ces commandes exactes sont permises : \`npm run build\`,
  \`npx astro check\` (sans « cd », sans « && », sans redirection). Toute autre commande shell (ls, cd, cat, cp…) est
  refusée : pour explorer, utilise Glob, Grep et Read. Un refus sur une autre commande ne veut pas dire que le build est interdit.
- Termine par \`npm run build\` et corrige jusqu'à ce qu'il passe sans erreur. Le hub relancera ensuite tous les contrôles
  (Lighthouse, axe, captures, unicité, faits, revue visuelle, UX).
- Compte rendu final court : ce que tu as changé (fichier par fichier), ce que tu n'as pas pu faire et pourquoi.`;

const integration: EtapeDef = {
  id: "integration",
  label: "Élément sur mesure",
  detail: "L'Intégrateur code l'élément propre à ce site (src/sections/custom/)",
  agent: "integrateur",
  groupe: "fabrication",
  essais: 2,
  async run(ctx) {
    const design = DesignSchema.parse(readJson(p(ctx, "design.json")));
    const sm = design.surMesure;
    const cible = `src/sections/custom/${sm.composant}.astro`;
    const site = readJson<{ sections: { type: string }[] }>(p(ctx, "src", "data", "site.json"));
    const section = site.sections.find((s) => s.type === "surmesure");
    const prompt = [
      `Code l'élément sur mesure de ce site : « ${sm.element} ». Il n'existe dans aucun autre site : c'est ce qui rend cette maquette propre à l'entreprise.`,
      "",
      "## Ce que le Directeur artistique a conçu (design.json > surMesure, mot pour mot)",
      `Description : ${sm.description}`,
      `Pourquoi cette entreprise : ${sm.pourquoi}`,
      "",
      "## Ses textes (src/data/site.json, section « surmesure », écrits par le Rédacteur — ne les change pas, n'en ajoute pas)",
      "```json",
      JSON.stringify(section, null, 2),
      "```",
      "",
      "## Contrat du composant",
      `- Fichier : ${cible} (le kit le trouve par son nom ; la page l'affiche à sa place dans l'ordre des sections).`,
      "- Props : `interface Props { section: SectionDe<\"surmesure\">; fond: Fond }` (types de ../../schema.ts et ../../lib/site.ts). Lis section.contenu (surtitre, titre, intro, elements, image).",
      "- Enveloppe : le composant `Section` (../../components/Section.astro) avec `id={ancre(section)}` et `fond={fond}` ; titre via `TitreSection` ou un H2 avec `id={`${id}-titre`}` et une classe d'échelle (`titre-section` ou `titre-bloc`). Gère les 4 fonds (clair, surface, teinte, sombre) avec les classes `texte-doux`, `texte-accent`, les jetons (`bg-accent`, `text-accent-texte`, `border-trait`…), jamais une couleur en dur.",
      "- Lis d'abord 2 sections du kit comme modèles (ex. src/sections/PourquoiEtapes.astro, src/sections/ZoneCarte.astro) et src/styles/global.css (classes communes).",
      "- Le décor (SVG, motifs) est en `aria-hidden=\"true\"` ; tout texte visible vient de section.contenu. Une image passe par `Picture` d'astro:assets dans un conteneur `.media` (voir src/lib/images.ts).",
      "- Qualité : impeccable à 375, 768 et 1440 px (rien qui déborde, se superpose ou se coupe), au niveau des autres sections, zéro JavaScript client, accessible (contrastes AA, ordre de lecture logique, listes sémantiques).",
      "",
      "Fichiers utiles (chemins exacts, à lire) : brief.json, design.json, src/data/site.json.",
      "",
      REGLES_INTEGRATEUR,
    ].join("\n");
    const r = await ctx.agents.atelier({ agent: "integrateur", dir: ctx.siteDir, prompt, jobId: ctx.job.job.id, signal: ctx.job.signal, onEvent: relayer(ctx), summary: `Élément sur mesure : ${sm.element}` });
    // Sans le composant, le build échouerait : c'est une erreur de l'étape (nouvel essai), pas un contrôle.
    if (!existsSync(p(ctx, ...cible.split("/")))) throw new Error(`L'Intégrateur n'a pas créé ${cible}`);
    return { issue: "suite", resume: `${sm.element} (${cible})`, sortie: { compteRendu: r.text, refus: r.denials.length, fichier: cible } };
  },
};

// ── 7. Contrôles automatiques ───────────────────────────────────────────────

function consignesControles(r: CheckReport): Consigne[] {
  const origine = "Contrôles automatiques (check-site)";
  const out: Consigne[] = [];
  if (!r.build.ok) {
    out.push({ origine, texte: `Le build échoue. Erreur exacte :\n${r.build.erreur ?? "voir .check/build.log"}\n(journal complet : .check/build.log)` });
    return out;
  }
  const lh = r.lighthouse;
  const cats: [keyof NonNullable<CheckReport["lighthouse"]>, string, string][] = [
    ["performance", "performance", "performance"],
    ["accessibilite", "accessibilite", "accessibilité"],
    ["bonnesPratiques", "bonnesPratiques", "bonnes pratiques"],
  ];
  for (const [k, audits, nom] of cats) {
    const v = lh?.[k] as number | undefined;
    if (lh && typeof v === "number" && v < SEUILS.lighthouse) {
      const rates = lh.auditsRates?.[audits] ?? [];
      out.push({ origine, texte: `Lighthouse mobile ${nom} = ${v}/100 (seuil ${SEUILS.lighthouse}). Audits ratés : ${rates.map((a) => `${a.id} (« ${a.titre} », score ${a.score})`).join(" ; ") || "voir .check/lighthouse.json"}` });
    }
  }
  for (const v of r.axe?.violations ?? []) {
    if (v.impact === "serious" || v.impact === "critical") out.push({ origine, texte: `axe ${v.impact} « ${v.id} » : ${v.aide} — ${v.noeuds} élément(s), ex. ${v.exemples.join(" | ")}` });
  }
  for (const c of r.controles) {
    if (!c.ok && c.bloquant && !/^lighthouse-|^axe-graves/.test(c.id)) out.push({ origine, texte: `Contrôle « ${c.id} » en échec : ${c.detail}` });
  }
  return out;
}

const controles: EtapeDef = {
  id: "controles",
  label: "Contrôles automatiques",
  detail: "Build, Lighthouse mobile, axe, captures 375/768/1440, défauts du script",
  agent: null,
  groupe: "controle",
  async run(ctx) {
    ctx.job.progress({ label: "Build, Lighthouse, axe et captures…" });
    const r = await ctx.kit.checkSite(ctx.siteDir, ctx.job.signal, (l) => ctx.job.log("info", l));
    const lh = r.lighthouse;
    const sortie = {
      lighthouse: lh ? { performance: lh.performance, accessibilite: lh.accessibilite, bonnesPratiques: lh.bonnesPratiques, seo: lh.seo, metriques: lh.metriques } : null,
      axe: r.axe ? { graves: r.axe.graves, violations: r.axe.violations.map((v) => ({ id: v.id, impact: v.impact, aide: v.aide, noeuds: v.noeuds })) } : null,
      echecs: r.echecs,
      controles: r.controles.length,
      build: { ok: r.build.ok, dureeMs: r.build.dureeMs },
    };
    if (!r.build.ok) return { issue: "controle", ok: false, bloqueLaSuite: true, resume: "Le build échoue", sortie, consignes: consignesControles(r) };
    // Captures découpées pour la vision (revue visuelle, UX) et vignette pour l'interface.
    await ctx.kit.decouperCaptures(ctx.siteDir, p(ctx, ".atelier", "revue"), ctx.job.signal);
    const ref = join(ctx.kit.root, "examples", "electricien-villeurbanne", "captures");
    if (existsSync(join(ref, "capture-375-initial.png"))) copyFileSync(join(ref, "capture-375-initial.png"), p(ctx, ".atelier", "revue", "zz-reference-mobile-ecran-initial.png"));
    const consignes = consignesControles(r);
    const okSeuils = !!lh && lh.performance >= SEUILS.lighthouse && lh.accessibilite >= SEUILS.lighthouse && lh.bonnesPratiques >= SEUILS.lighthouse && (r.axe?.graves ?? 1) === 0;
    const ok = okSeuils && r.echecs.length === 0 && consignes.length === 0;
    const resume = lh ? `Lighthouse ${lh.performance}/${lh.accessibilite}/${lh.bonnesPratiques} · axe ${r.axe?.graves ?? "?"} grave(s) · ${r.echecs.length ? `${r.echecs.length} défaut(s)` : "aucun défaut"}` : "Lighthouse non mesuré";
    return { issue: "controle", ok, resume, sortie, consignes };
  },
};

// ── 8a. Contrôle des faits ──────────────────────────────────────────────────

const faits: EtapeDef = {
  id: "faits",
  label: "Contrôle des faits",
  detail: "Texte rendu comparé au brief",
  agent: "controleur-qa",
  groupe: "controle",
  essais: 2,
  async run(ctx) {
    const texte = rendu(ctx.siteDir);
    writeFileSync(p(ctx, ".atelier", "rendu.txt"), texte, "utf8");
    const prompt = [
      "Contrôle des faits (skill controle-faits) : compare chaque affirmation factuelle du site construit aux sources du brief.",
      "",
      fichier(p(ctx, "brief.json"), "brief.json"),
      "",
      "## Texte rendu du site (extrait du dist par le hub, toutes les pages)",
      `<fichier chemin=".atelier/rendu.txt">\n${texte}\n</fichier>`,
      "",
      "Méthode :",
      "- Relève CHAQUE affirmation factuelle : identité, téléphone (texte ET lien tel:), adresse, email, SIREN, dates, années, nombres, note et nombre d'avis, horaires, communes, prestations, garanties, délais, labels, qualités affirmées comme des faits (« intervient en urgence », « répond lui-même »).",
      "- statut : conforme (identique à la source) | reformulation (même sens) | absente (aucune source) | contradictoire (diffère de la source) | prestation_douteuse (hors de activite.prestationsPlausibles).",
      "- Les éléments génériques du kit (bandeau « Maquette réalisée par Liverdian… », mentions de l'hébergeur, politique de confidentialité, « non communiqué (maquette) ») sont conformes : ne les liste pas.",
      "- Les légendes de photos d'illustration et les descriptions générales du métier ne sont pas des faits sur l'entreprise, sauf si elles affirment que l'entreprise a fait ce chantier.",
      "- Pour tout statut absente/contradictoire/prestation_douteuse : section où se trouve la phrase, et « correction » = consigne exacte (supprimer, ou remplacer par telle formulation sourcée).",
      "- verdict = fail dès qu'un seul élément est absente, contradictoire ou prestation_douteuse. Pas de « pass avec réserves ».",
    ].join("\n");
    ctx.job.progress({ label: "Le Contrôleur QA vérifie les faits…" });
    const r = await ctx.agents.ask({ agent: "controleur-qa", prompt, schema: FaitsSchema, jobId: ctx.job.job.id, signal: ctx.job.signal, timeoutMs: 15 * MIN, summary: "Contrôle des faits" });
    writeJson(p(ctx, ".atelier", `faits-tour-${ctx.tour}.json`), r.data);
    const mauvais = r.data.items.filter((i) => i.statut === "absente" || i.statut === "contradictoire" || i.statut === "prestation_douteuse");
    const ok = mauvais.length === 0 && r.data.verdict === "pass";
    const consignes: Consigne[] = mauvais.map((i) => ({ origine: "Contrôleur QA — faits", texte: `[${i.section}] « ${i.phrase} » : ${i.statut}${i.source ? ` (source : ${i.source})` : ""}. ${i.correction ?? "Supprimer cette affirmation."}` }));
    if (!ok && !consignes.length) consignes.push({ origine: "Contrôleur QA — faits", texte: "Verdict « fail » sans élément listé : relire tout le texte contre brief.json." });
    return {
      issue: "controle",
      ok,
      resume: ok ? `${r.data.items.length} faits vérifiés, tous sourcés` : `${mauvais.length} fait(s) sans source ou faux sur ${r.data.items.length}`,
      sortie: { verdict: ok ? "pass" : "fail", verifies: r.data.items.length, problemes: mauvais },
      consignes,
    };
  },
};

// ── 8b. Revue visuelle ──────────────────────────────────────────────────────

const visuel: EtapeDef = {
  id: "visuel",
  label: "Revue visuelle",
  detail: "Captures relues selon la grille qa/revue-visuelle",
  agent: "controleur-qa",
  groupe: "controle",
  essais: 2,
  async run(ctx) {
    const design = readJson<Design>(p(ctx, "design.json"));
    const prompt = [
      "Revue visuelle (skill revue-visuelle) de la maquette d'un site d'artisan, sur ses captures réelles.",
      "Les captures pleine page sont découpées en tranches dans l'ordre de la page : « 01-mobile-ecran-initial » (375×667, sans défiler), « mobile-N » (375 px), « tablette-N » (768 px), « bureau-N » (1440 px). Les tranches se recouvrent légèrement.",
      "« zz-reference-… » est une capture d'un AUTRE site, fait par l'agence, qui fixe le niveau attendu : ne l'évalue pas, compare-toi à lui. Ce site doit être au moins aussi abouti.",
      "Lis TOUTES les images avec l'outil Read, dans l'ordre.",
      "",
      "Intention du Directeur artistique (pour juger la cohérence, pas pour l'excuser) :",
      design.intention.map((x) => `- ${x}`).join("\n"),
      `Élément signature annoncé : ${design.signature.element} — ${design.signature.description}`,
      `Élément sur mesure (section propre à ce site, codée pour lui) : ${design.surMesure.element} — ${design.surMesure.description}. Il est jugé comme le reste : même niveau de finition, aucun air de gabarit ni de bricolage.`,
      ...(ctx.exigences.length ? ["", "Exigences du propriétaire, à vérifier sur les captures (une exigence non respectée est bloquante) :", ...ctx.exigences.map((e) => `- « ${e} »`)] : []),
      "",
      "Exigence : tu es le dernier rempart avant que l'artisan voie ce site. Sois franc et précis.",
      "Barème : 5 = niveau agence, rien à redire ; 4 = très bon, détails mineurs ; 3 = correct mais un défaut visible ou un air de gabarit ; 2 = défaut net ; 1 = raté.",
      "D'abord « description » (ce que tu vois, capture par capture), puis les notes avec leur justification. Toute note < 5 cite le défaut et l'endroit.",
      "Défauts bloquants (liste du skill) : texte coupé, débordant, superposé ou illisible ; zone vide anormale ; image cassée ; placeholder ; téléphone/Appeler absent de l'écran initial mobile ; bandeau maquette absent ; incohérence grossière.",
      "Chaque consigne est actionnable par l'Intégrateur dans le projet Astro (« passer la variante services en liste », « réduire le H1 mobile à 2,25rem », « remplacer l'image du hero par une photo plus calme »), jamais vague.",
      "verdict = pass seulement si aucun bloquant, moyenne ≥ 4 et aucune note < 3.",
    ].join("\n");
    ctx.job.progress({ label: "Le Contrôleur QA relit les captures…" });
    const r = await ctx.agents.ask({ agent: "controleur-qa", prompt, schema: VisuelSchema, imagesDir: p(ctx, ".atelier", "revue"), jobId: ctx.job.job.id, signal: ctx.job.signal, timeoutMs: 20 * MIN, summary: "Revue visuelle" });
    writeJson(p(ctx, ".atelier", `visuel-tour-${ctx.tour}.json`), r.data);
    const notes = Object.values(r.data.scores);
    const moyenne = Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 100) / 100;
    const min = Math.min(...notes);
    // Le code décide, pas le verdict de l'agent : bloquants, moyenne, note minimale.
    const ok = r.data.blocking.length === 0 && moyenne >= SEUILS.visuelMoyenne && min >= SEUILS.visuelMin;
    const consignes: Consigne[] = [
      ...r.data.blocking.map((x) => ({ origine: "Contrôleur QA — revue visuelle (bloquant)", texte: `[${x.capture}] ${x.probleme} → ${x.consigne}` })),
      ...r.data.corrections.map((x) => ({ origine: "Contrôleur QA — revue visuelle", texte: `[${x.section}] ${x.probleme} → ${x.consigne}` })),
    ];
    if (!ok && !consignes.length) {
      consignes.push(...Object.entries(r.data.scores).filter(([, v]) => v < 4).map(([k, v]) => ({ origine: "Contrôleur QA — revue visuelle", texte: `Critère ${k} noté ${v}/5 : ${r.data.justifications[k as keyof typeof r.data.justifications]}` })));
    }
    return {
      issue: "controle",
      ok,
      resume: `Moyenne ${moyenne.toLocaleString("fr-FR")}/5, minimum ${min}/5${r.data.blocking.length ? `, ${r.data.blocking.length} bloquant(s)` : ""}`,
      sortie: { moyenne, min, scores: r.data.scores, justifications: r.data.justifications, blocking: r.data.blocking, corrections: r.data.corrections, description: r.data.description },
      consignes: ok ? [] : consignes,
    };
  },
};

// ── 9. Relecture UX ─────────────────────────────────────────────────────────

const ux: EtapeDef = {
  id: "ux",
  label: "Relecture UX",
  detail: "Parcours mobile, conversion, finitions",
  agent: "relecteur-ux",
  groupe: "controle",
  essais: 2,
  async run(ctx) {
    const texte = rendu(ctx.siteDir, { formulaire: true });
    const prompt = [
      "Relecture UX (skill heuristiques-ux-conversion) de la maquette d'un site d'artisan.",
      "Captures : « 01-mobile-ecran-initial » (375×667 sans défiler), puis tranches « mobile-N », « tablette-N », « bureau-N » dans l'ordre de la page. « zz-reference-… » appartient à un autre site (niveau attendu) : ne l'évalue pas. Lis toutes les images avec Read.",
      "",
      "## Texte rendu et formulaire (extraits du dist par le hub)",
      `<fichier chemin=".atelier/rendu-ux.txt">\n${texte}\n</fichier>`,
      ...(ctx.exigences.length ? ["", "Exigences du propriétaire (non respectée = bloquant) :", ...ctx.exigences.map((e) => `- « ${e} »`)] : []),
      "",
      "Déroule les trois parcours (urgent, comparateur, sceptique) sur mobile d'abord, puis relève les problèmes.",
      "gravite : bloquant (empêche d'appeler ou de demander un devis, ou trompe le visiteur), majeur (freine nettement la conversion ou la confiance), mineur (finition).",
      "Ce site est une démo : le formulaire n'envoie rien et le bandeau « maquette » est voulu ; ce n'est pas un problème.",
      "Chaque consigne dit exactement quoi changer dans le site (texte, variante, ordre, composant), pour l'Intégrateur.",
      "verdict = pass seulement s'il n'y a aucun problème bloquant ni majeur.",
    ].join("\n");
    ctx.job.progress({ label: "Le Relecteur UX parcourt le site…" });
    const r = await ctx.agents.ask({ agent: "relecteur-ux", prompt, schema: UxSchema, imagesDir: p(ctx, ".atelier", "revue"), jobId: ctx.job.job.id, signal: ctx.job.signal, timeoutMs: 20 * MIN, summary: "Relecture UX" });
    writeJson(p(ctx, ".atelier", `ux-tour-${ctx.tour}.json`), r.data);
    const graves = r.data.problemes.filter((x) => x.gravite === "bloquant" || x.gravite === "majeur");
    const ok = graves.length === 0;
    return {
      issue: "controle",
      ok,
      resume: ok ? `Aucun problème bloquant ni majeur (${r.data.problemes.length} mineur(s))` : `${graves.length} problème(s) bloquant(s) ou majeur(s)`,
      sortie: { problemes: r.data.problemes, parcours: r.data.parcours },
      // Seuls les problèmes bloquants et majeurs partent en correction : une liste trop longue de détails dilue le tour
      // et fait régresser le reste (constaté sur les premières fabrications réelles).
      consignes: ok ? [] : graves.map((x) => ({ origine: `Relecteur UX — ${x.gravite}`, texte: `[${x.parcours}] ${x.constat} → ${x.consigne}` })),
    };
  },
};

// ── 10. Correction ───────────────────────────────────────────────────────────

const correction: EtapeDef = {
  id: "correction",
  label: "Correction",
  detail: "L'Intégrateur applique les consignes exactes des contrôles",
  agent: "integrateur",
  groupe: "correction",
  essais: 2,
  async run(ctx) {
    // Le fichier du tour en cours : le plus récent des tour-N.md écrits par le moteur.
    const dossier = p(ctx, ".atelier", "corrections");
    const tours = existsSync(dossier) ? readdirSync(dossier).filter((x) => /^tour-\d+\.md$/.test(x)) : [];
    const dernier = tours.sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0])).pop();
    if (!dernier) return { issue: "arret", motif: "Tour de correction sans fichier de consignes", resume: "Consignes introuvables" };
    let chemin = `.atelier/corrections/${dernier}`;
    let retour: { version: number; avertissement: string } | null = null;
    const demandeHumaine = ctx.consignes.some((c) => c.origine === "Demande du propriétaire");
    if (!demandeHumaine && ctx.tour >= 1) {
      // Garde-fou contre la régression : chaque version relue est gardée ; si la dernière est moins bonne qu'une
      // précédente, on repart de la meilleure, avec les consignes de sa propre relecture (décision du code).
      const evaluee = ctx.tour - 1;
      sauverVersion(ctx, evaluee);
      let meilleure: { k: number; note: number } | null = null;
      for (let k = 0; k <= evaluee; k++) {
        const note = noteVersion(ctx, k);
        if (note !== null && existsSync(p(ctx, ".atelier", "versions", `v${k}`)) && (meilleure === null || note > meilleure.note)) meilleure = { k, note };
      }
      const courante = noteVersion(ctx, evaluee);
      const consignesMeilleure = meilleure ? `.atelier/corrections/tour-${meilleure.k + 1}.md` : null;
      if (meilleure && courante !== null && meilleure.k !== evaluee && meilleure.note > courante && consignesMeilleure && existsSync(p(ctx, consignesMeilleure))) {
        restaurerVersion(ctx, meilleure.k);
        chemin = consignesMeilleure;
        retour = { version: meilleure.k, avertissement: lire(p(ctx, ".atelier", "corrections", dernier)).trim() };
        ctx.job.log("info", `Régression détectée (note ${courante} < ${meilleure.note}) : retour à la version ${meilleure.k}`);
      }
    }
    const prompt = [
      retour
        ? `Tour de correction. Le tour précédent a fait baisser la qualité : le hub a remis le site dans sa meilleure version (version ${retour.version}). Applique les consignes de la relecture de CETTE version (fichier ${chemin}), autrement que la dernière fois.`
        : `Tour de correction de la maquette. Les consignes ci-dessous viennent mot pour mot des contrôles (fichier ${chemin}). Applique-les toutes.`,
      "Les défauts bloquants d'abord. Si deux consignes se contredisent, ou si une consigne demande d'ajouter un fait absent de brief.json, applique la plus sûre et explique-le dans ton compte rendu.",
      "Ne refais pas ce qui est bon : chaque changement répond à une consigne. Avant de modifier une section, regarde avec Read ses captures dans .atelier/revue/ (tranches mobile, tablette, bureau) pour comprendre le défaut ; après, relis ton code en pensant aux trois largeurs (375, 768, 1440 px) : rien ne doit se superposer, déborder ni être rogné.",
      "",
      `<fichier chemin="${chemin}">\n${lire(p(ctx, chemin)).trim()}\n</fichier>`,
      ...(retour ? ["", "Ce que la tentative précédente a provoqué (à NE PAS reproduire) — relecture de la version abandonnée :", `<fichier chemin=".atelier/corrections/${dernier}">\n${retour.avertissement}\n</fichier>`] : []),
      "",
      `Ton dossier de travail est ${ctx.siteDir.replace(/\\/g, "/")} : utilise des chemins relatifs à ce dossier (ex. .atelier/revue/01-mobile-ecran-initial.png), jamais un autre dossier.`,
      "Fichiers utiles (à lire) : brief.json (sources), design.json (intention du DA), src/data/site.json (données du site), src/sections/ (composants), src/sections/custom/ (élément sur mesure),",
      ".atelier/revue/ (captures découpées du dernier contrôle), .check/check-report.json (rapport technique complet).",
      "Photos : toutes les photos candidates sont dans stock/ (descriptions dans brief.json > banqueImages). Regarde-les avec Read avant d'en changer ;",
      "une photo se change dans src/data/site.json > images (fichier, alt fidèle à ce qu'elle montre, focale).",
      "Préfère corriger dans src/data/site.json (textes, variantes, images, thème) ; touche aux composants seulement si la consigne l'exige.",
      "",
      REGLES_INTEGRATEUR,
    ].join("\n");
    const r = await ctx.agents.atelier({ agent: "integrateur", dir: ctx.siteDir, prompt, jobId: ctx.job.job.id, signal: ctx.job.signal, onEvent: relayer(ctx), summary: `Correction (${dernier})` });
    writeFileSync(p(ctx, ".atelier", "corrections", dernier.replace(/\.md$/, "-compte-rendu.md")), r.text, "utf8");
    const resume = r.text.split("\n").find((l) => l.trim())?.slice(0, 200) ?? "Corrections appliquées";
    return {
      issue: "suite",
      resume: retour ? `Retour à la version ${retour.version} (meilleure note), puis : ${resume}` : resume,
      sortie: { compteRendu: r.text, refus: r.denials.length, consignes: ctx.consignes.length, retourVersion: retour?.version ?? null },
    };
  },
};


// ── Versions relues (garde-fou contre la régression) ───────────────────────

/** Note d'une version relue : moyenne visuelle, moins une demi-note par défaut bloquant (visuel, UX grave, fait faux). */
export function noteVersion(ctx: Pick<EtapeContexte, "siteDir">, k: number): number | null {
  const f = (n: string) => join(ctx.siteDir, ".atelier", `${n}-tour-${k}.json`);
  if (!existsSync(f("visuel"))) return null;
  const v = readJson<{ scores: Record<string, number>; blocking: unknown[] }>(f("visuel"));
  const notes = Object.values(v.scores);
  const moyenne = notes.reduce((a, b) => a + b, 0) / notes.length;
  const ux = existsSync(f("ux")) ? readJson<{ problemes: { gravite: string }[] }>(f("ux")).problemes.filter((x) => x.gravite !== "mineur").length : 0;
  const faitsKo = existsSync(f("faits")) ? readJson<{ items: { statut: string }[] }>(f("faits")).items.filter((x) => ["absente", "contradictoire", "prestation_douteuse"].includes(x.statut)).length : 0;
  return Math.round((moyenne - 0.5 * (v.blocking.length + ux + faitsKo)) * 100) / 100;
}

/** Ce que l'Intégrateur modifie : une version, c'est ces dossiers. */
const DOSSIERS_VERSION = ["src", "public"];

function sauverVersion(ctx: EtapeContexte, k: number): void {
  const cible = p(ctx, ".atelier", "versions", `v${k}`);
  rmSync(cible, { recursive: true, force: true });
  for (const d of DOSSIERS_VERSION) if (existsSync(p(ctx, d))) cpSync(p(ctx, d), join(cible, d), { recursive: true });
}

function restaurerVersion(ctx: EtapeContexte, k: number): void {
  const source = p(ctx, ".atelier", "versions", `v${k}`);
  for (const d of DOSSIERS_VERSION) {
    rmSync(p(ctx, d), { recursive: true, force: true });
    if (existsSync(join(source, d))) cpSync(join(source, d), p(ctx, d), { recursive: true });
  }
}

export const vitrineArtisan: Recette = {
  id: "vitrine-artisan",
  nom: "Vitrine artisan 1 page",
  description: "Site d'une page pour un artisan du bâtiment : appel, services, zone, avis, devis.",
  sequence: ["brief", "da", "redaction", "assemblage", "unicite", "integration", "controles", "unicite-controle", "faits", "visuel", "ux"],
  etapes: { brief, da, redaction, assemblage, unicite, integration, controles, "unicite-controle": uniciteControle, faits, visuel, ux, correction },
  correction: { etape: "correction", retour: "controles", toursMax: SEUILS.toursMax },
  refaire: "da",
  seuils: SEUILS,
};
