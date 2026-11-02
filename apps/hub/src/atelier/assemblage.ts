import type { Brief } from "./brief.ts";
import { VARIANTES, type Contenu, type Design } from "./schemas.ts";

/**
 * Étape 4 : assemblage en code de `site.json` = brief + design + contenu. Aucune réparation silencieuse :
 * chaque incohérence est rendue avec le message exact et l'agent qui doit la corriger.
 */
export type Refus = { agent: "directeur-artistique" | "redacteur"; message: string };

const TEXTES_SECTION = ["surtitre", "titre", "titreAccent", "sousTitre", "intro", "texte", "motSignature", "boutonAppel", "boutonDevis", "afficherNote", "reperes", "besoins", "boutonEnvoyer"] as const;

/** Champs de contenu acceptés par type de section (contrat du kit). */
const CHAMPS: Record<string, readonly string[]> = {
  hero: ["surtitre", "titre", "titreAccent", "sousTitre", "motSignature", "boutonAppel", "boutonDevis", "afficherNote", "reperes"],
  services: ["surtitre", "titre", "intro", "items"],
  pourquoi: ["surtitre", "titre", "intro", "items"],
  realisations: ["surtitre", "titre", "intro", "legendes"],
  avis: ["surtitre", "titre", "texte"],
  zone: ["surtitre", "titre", "intro"],
  appel: ["titre", "texte"],
  devis: ["surtitre", "titre", "intro", "besoins", "boutonEnvoyer"],
};

/** Contrôles du hub avant le schéma du kit : cohérence entre les deux agents et avec le brief. */
export function verifierCoherence(brief: Brief, design: Design, contenu: Contenu, icones?: Set<string>): Refus[] {
  const refus: Refus[] = [];
  const da = (message: string) => refus.push({ agent: "directeur-artistique", message });
  const red = (message: string) => refus.push({ agent: "redacteur", message });

  const candidates = new Set(brief.banqueImages.filter((i) => i.candidate).map((i) => i.fichier));
  const cles = new Set<string>();
  for (const im of design.images) {
    if (cles.has(im.cle)) da(`images : la clé « ${im.cle} » est déclarée deux fois`);
    cles.add(im.cle);
    if (!candidates.has(im.fichier)) da(`images.${im.cle} : « ${im.fichier} » n'est pas une des photos candidates du brief (banqueImages avec candidate=true)`);
  }
  design.sections.forEach((s, i) => {
    const variantes = VARIANTES[s.type];
    if (!variantes.includes(s.variante)) da(`sections[${i}] (${s.type}) : variante « ${s.variante} » inconnue, attendu ${variantes.join(" | ")}`);
    for (const k of [s.image, ...(s.images ?? [])]) if (k && !cles.has(k)) da(`sections[${i}] (${s.type}) : image « ${k} » absente de « images »`);
    if (s.type === "avis" && !brief.entreprise.noteGoogle) da(`sections[${i}] : section « avis » sans note Google dans le brief : la supprimer`);
    if (s.type === "zone" && s.variante === "carte" && !brief.zone.carteDisponible) da(`sections[${i}] : zone « carte » impossible (coordonnées manquantes dans le brief) : utiliser « liste »`);
  });
  if (brief.zone.voisines) {
    if (design.zoneVoisines?.length) da("zoneVoisines : la fiche a déjà ses communes voisines (brief.zone.voisines), ne pas en proposer");
  } else {
    const ok = new Set(brief.zone.candidates.map((c) => c.nom));
    const v = design.zoneVoisines ?? [];
    if (v.length < 4 || v.length > 8) da(`zoneVoisines : choisir 4 à 8 communes dans zone.candidates (${v.length} reçue(s))`);
    for (const n of v) if (!ok.has(n)) da(`zoneVoisines : « ${n} » n'est pas dans zone.candidates (seules ces communes réelles sont permises)`);
  }

  const attendus = design.sections.map((s) => s.type).join(", ");
  const recus = contenu.sections.map((s) => s.type).join(", ");
  if (attendus !== recus) red(`sections : l'ordre et les types doivent être exactement ceux du design (${attendus}) ; reçu (${recus})`);
  else {
    contenu.sections.forEach((c, i) => {
      const d = design.sections[i]!;
      const permis = CHAMPS[c.type] ?? [];
      for (const k of Object.keys(c)) if (k !== "type" && c[k as keyof typeof c] !== undefined && !permis.includes(k)) red(`sections[${i}] (${c.type}) : champ « ${k} » non prévu pour ce type (permis : ${permis.join(", ")})`);
      if (!c.titre) red(`sections[${i}] (${c.type}) : titre manquant`);
      if (c.type === "hero" && !c.sousTitre) red(`sections[${i}] (hero) : sousTitre manquant`);
      if (c.type === "devis" && !c.intro) red(`sections[${i}] (devis) : intro manquante (ce qui se passe après l'envoi)`);
      if ((c.type === "services" || c.type === "pourquoi") && !c.items?.length) red(`sections[${i}] (${c.type}) : items manquants`);
      if (d.nombreItems && c.items && c.items.length !== d.nombreItems) red(`sections[${i}] (${c.type}) : ${d.nombreItems} éléments demandés par le design, ${c.items.length} reçus`);
      if (c.type === "services" && d.variante === "bandes" && c.items && c.items.length !== (d.images?.length ?? 0)) red(`sections[${i}] (services bandes) : un service par image du design (${d.images?.length ?? 0}), ${c.items.length} reçus`);
      if (c.type === "realisations" && c.legendes && c.legendes.length !== (d.images?.length ?? 0)) red(`sections[${i}] (réalisations) : une légende par image (${d.images?.length ?? 0}), ${c.legendes.length} reçues`);
      if (icones?.size) for (const it of c.items ?? []) if (it.icone && !icones.has(it.icone)) red(`sections[${i}] (${c.type}) : icône « ${it.icone} » inconnue de Lucide (ex. zap, plug, lightbulb, shield-check, circuit-board, house, wrench, cable)`);
      if (c.afficherNote && !brief.entreprise.noteGoogle) red(`sections[${i}] : afficherNote sans note Google dans le brief`);
    });
  }
  return refus;
}

type Theme = Design["theme"];

/**
 * Anti-gabarit du thème : deux sites du même métier ne doivent pas se ressembler. Le thème doit surcharger
 * l'accent ou le fond sombre, avec un couple (accent, sombre) différent de chaque site existant, et différer
 * aussi par au moins une police, la signature ou la variante du hero.
 */
export function verifierDifference(brief: Brief, design: Design, presets: Record<string, { couleurs: Record<string, string>; polices: { titres: string; corps: string }; signature: string }>): Refus[] {
  const refus: Refus[] = [];
  const t: Theme = design.theme;
  const couleurs = t.couleurs ?? {};
  if (!couleurs.accent && !couleurs.sombre) refus.push({ agent: "directeur-artistique", message: "theme.couleurs : surcharger au moins « accent » ou « sombre » (ajustement de teinte propre à ce site)" });
  const eff = (preset: string, c: Record<string, string | undefined>, pol: { titres?: string; corps?: string }, sig: string | null | undefined) => {
    const p = presets[preset];
    return {
      accent: (c.accent ?? p?.couleurs.accent ?? "").toLowerCase(),
      sombre: (c.sombre ?? p?.couleurs.sombre ?? "").toLowerCase(),
      titres: pol.titres ?? p?.polices.titres,
      corps: pol.corps ?? p?.polices.corps,
      signature: sig ?? p?.signature,
    };
  };
  const moi = eff(t.preset, couleurs, t.polices ?? {}, t.signature);
  const hero = design.sections.find((s) => s.type === "hero")?.variante ?? null;
  for (const autre of brief.sitesMemeMetier) {
    const o = eff(autre.preset, autre.couleurs, autre.polices, autre.signature);
    if (o.accent === moi.accent && o.sombre === moi.sombre) {
      refus.push({ agent: "directeur-artistique", message: `theme : même couple accent ${moi.accent} / sombre ${moi.sombre} que ${autre.origine} : changer la teinte` });
    }
    if (o.titres === moi.titres && o.corps === moi.corps && o.signature === moi.signature && autre.heroVariante === hero) {
      refus.push({ agent: "directeur-artistique", message: `theme : mêmes polices (${moi.titres}/${moi.corps}), même signature (${moi.signature}) et même hero (${hero}) que ${autre.origine} : changer au moins l'un des trois` });
    }
  }
  return refus;
}

/** Fusion en `site.json` (entrée du kit). Suppose verifierCoherence passé. */
export function assembler(brief: Brief, design: Design, contenu: Contenu): Record<string, unknown> {
  const e = brief.entreprise;
  const images: Record<string, unknown> = {};
  for (const im of design.images) images[im.cle] = { fichier: im.fichier, alt: im.alt, ...(im.focale ? { focale: im.focale } : {}) };

  const sections = design.sections.map((d, i) => {
    const c = contenu.sections[i]!;
    const contenuSection: Record<string, unknown> = {};
    for (const k of TEXTES_SECTION) if (c[k] !== undefined && (CHAMPS[d.type] ?? []).includes(k)) contenuSection[k] = c[k];
    if (d.type === "hero" || d.type === "pourquoi" || d.type === "appel") if (d.image) contenuSection.image = d.image;
    if (d.type === "services" || d.type === "pourquoi") {
      contenuSection.items = (c.items ?? []).map((it, j) => {
        const item: Record<string, unknown> = { titre: it.titre, texte: it.texte };
        if (it.icone) item.icone = it.icone;
        if (d.type === "services" && it.points?.length) item.points = it.points;
        if (d.type === "services" && d.variante === "bandes" && d.images?.[j]) item.image = d.images[j];
        if (d.type === "services" && d.variante === "liste" && j === 0 && d.images?.[0]) item.image = d.images[0];
        return item;
      });
    }
    if (d.type === "realisations") contenuSection.images = (d.images ?? []).map((k, j) => ({ image: k, ...(c.legendes?.[j] ? { legende: c.legendes[j] } : {}) }));
    return { type: d.type, variante: d.variante, contenu: contenuSection };
  });

  const siege = brief.zone.siege.valeur;
  const point = (c: { nom: string; lat: number | null; lon: number | null }) => ({ nom: c.nom, ...(c.lat !== null && c.lon !== null ? { lat: c.lat, lon: c.lon } : {}) });
  const voisines = brief.zone.voisines
    ? brief.zone.voisines.valeur.map(point)
    : (design.zoneVoisines ?? []).map((n) => point(brief.zone.candidates.find((c) => c.nom === n) ?? { nom: n, lat: null, lon: null }));

  const note = e.noteGoogle;
  return {
    version: 1,
    slug: brief.site.slug,
    entreprise: {
      raisonSociale: e.raisonSociale.valeur,
      ...(e.nomCommercial ? { nomCommercial: e.nomCommercial.valeur } : {}),
      metier: e.metier.kit,
      metierLibelle: e.metier.libelle,
      ...(e.naf ? { naf: e.naf.valeur } : {}),
      ...(e.siren ? { siren: e.siren.valeur } : {}),
      adresse: e.adresse.valeur,
      telephone: e.telephone.valeur,
      ...(e.email ? { email: e.email.valeur } : {}),
      ...(e.horaires ? { horaires: e.horaires.valeur } : {}),
      ...(contenu.horairesNote ? { horairesNote: contenu.horairesNote } : {}),
      ...(note ? { noteGoogle: { valeur: note.valeur.valeur, nombre: note.valeur.nombre, url: note.url.valeur } } : {}),
      ...(e.dateCreation ? { dateCreation: e.dateCreation.valeur } : {}),
      ...(e.dirigeant ? { dirigeant: e.dirigeant.valeur } : {}),
    },
    zone: { commune: point(siege), voisines, ...(contenu.zonePrecision ? { precision: contenu.zonePrecision } : {}) },
    theme: design.theme,
    images,
    entete: { variante: design.entete.variante, ...(contenu.enteteBoutonDevis ? { boutonDevis: contenu.enteteBoutonDevis } : {}) },
    sections,
    pied: { variante: design.pied.variante, ...(contenu.piedPhrase ? { phrase: contenu.piedPhrase } : {}) },
    seo: { ...(contenu.seo.titre ? { titre: contenu.seo.titre } : {}), description: contenu.seo.description },
    formulaire: {},
    demo: { actif: true, agence: brief.demo.agence, dateSuppression: brief.demo.dateSuppression.valeur },
    legal: {},
  };
}

/**
 * Attribue une erreur du schéma du kit à l'agent qui l'a causée, d'après son chemin
 * (« sections[2].contenu.titre : trop long » → Rédacteur ; « theme.couleurs… » → Directeur artistique).
 * Renvoie null pour une erreur qui vient du code (brief, démo) : c'est un défaut du hub, pas d'un agent.
 */
export function attribuer(erreur: string, site: Record<string, unknown>): Refus["agent"] | null {
  const chemin = erreur.split(" : ")[0] ?? "";
  if (/^contraste /.test(erreur)) return "directeur-artistique";
  if (/^(seo|pied\.phrase|entete\.boutonDevis|zone\.precision|entreprise\.horairesNote)/.test(chemin)) return "redacteur";
  if (/^(theme|images|entete|pied)/.test(chemin)) return "directeur-artistique";
  if (/^zone/.test(chemin)) return "directeur-artistique";
  const m = /^sections(?:\[(\d+)\])?(.*)$/.exec(chemin);
  if (m) {
    const reste = m[2] ?? "";
    if (/\.(variante|type)$/.test(reste) || reste === "") return "directeur-artistique";
    if (/\.contenu(\.items(\[\d+\])?)?\.image$|\.contenu\.images|image/.test(reste)) return "directeur-artistique";
    if (/demande une image/.test(erreur)) return "directeur-artistique";
    if (/la variante « bandes » accepte 4 services/.test(erreur)) return "directeur-artistique";
    return "redacteur";
  }
  void site;
  return null;
}
