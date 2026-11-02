import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Company } from "../domain/companies.ts";
import { communesProches, trouverAvecCodePostal, trouverCommune } from "./communes.ts";
import { activiteDe, type ActiviteNaf } from "./naf.ts";

/**
 * Étape 1 de la recette : le brief, écrit par du code à partir de la fiche entreprise.
 * Chaque donnée garde sa source (ADR-03). Rien n'y est inventé : ce que le code déduit (métier du kit,
 * prestations plausibles du code NAF, coordonnées des communes, date de suppression de la démo) porte une
 * source « hub : … » qui le dit.
 */
export type Fait<T> = { valeur: T; source: string };

export type Brief = {
  version: 1;
  genereLe: string;
  site: { id: string; recette: string; slug: string };
  entreprise: {
    raisonSociale: Fait<string>;
    nomCommercial: Fait<string> | null;
    nomAffiche: string;
    siren: Fait<string> | null;
    naf: Fait<string> | null;
    metier: { kit: string; libelle: string; saisi: string | null; source: string };
    dateCreation: Fait<string> | null;
    dirigeant: Fait<string> | null;
    telephone: Fait<string>;
    email: Fait<string> | null;
    siteActuel: Fait<string> | null;
    adresse: Fait<{ rue: string; codePostal: string; commune: string }>;
    horaires: Fait<{ jours: string[]; ouverture: string; fermeture: string }[]> | null;
    horairesTexte: Fait<Record<string, string>> | null;
    noteGoogle: (Fait<{ valeur: number; nombre: number }> & { url: Fait<string> }) | null;
    notes: Fait<string> | null;
  };
  activite: { naf: string; intitule: string; prestationsPlausibles: string[]; source: string };
  zone: {
    siege: Fait<{ nom: string; lat: number | null; lon: number | null }>;
    /** Communes voisines saisies sur la fiche ; null si la fiche n'en a pas. */
    voisines: Fait<{ nom: string; lat: number | null; lon: number | null }[]> | null;
    /** Sans voisines saisies : communes réelles proches parmi lesquelles l'agent choisit (et seulement elles). */
    candidates: { nom: string; lat: number; lon: number; km: number }[];
    /** Toutes les communes ont des coordonnées : la variante « carte » de la zone est possible. */
    carteDisponible: boolean;
  };
  demo: { actif: true; agence: string; dateSuppression: Fait<string> };
  banqueImages: { fichier: string; description: string; orientation: string; hero: boolean; largeur: number; hauteur: number; candidate: boolean }[];
  /** Thèmes et variantes déjà utilisés par des sites du même métier : à ne pas reproduire. */
  sitesMemeMetier: { origine: string; preset: string; couleurs: Record<string, string>; polices: { titres?: string; corps?: string }; signature: string | null; heroVariante: string | null; variantes: string[] }[];
  regles: string[];
};

export type Prerequis = { possible: boolean; manques: string[] };

/** Champs indispensables pour lancer une maquette (le bouton est désactivé avec ces explications sinon). */
export function prerequisMaquette(c: Company): Prerequis {
  const manques: string[] = [];
  if (!c.raisonSociale && !c.nomCommercial) manques.push("le nom de l'entreprise");
  if (!activiteDe(c.naf, c.metier)) manques.push(c.naf || c.metier ? `un métier reconnu (NAF ${c.naf ?? "absent"}, métier « ${c.metier ?? ""} » : pas dans la table du bâtiment)` : "le métier ou le code NAF");
  if (!c.adresse.commune) manques.push("la commune");
  // Le site affiche l'adresse du siège partout (en-tête, pied de page, mentions) : elle doit être complète.
  else if (!c.adresse.ligne || !c.adresse.codePostal) manques.push("l'adresse complète (rue et code postal)");
  if (!c.telephone) manques.push("le téléphone");
  else if (!/^(?:\+33|0033|0)[1-9](?:[ .-]?\d{2}){4}$/.test(c.telephone.trim())) manques.push("un téléphone français valide");
  return { possible: manques.length === 0, manques };
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "site"
  );
}

/** Date de suppression de la démo : J+30 (code pur, jamais un agent). */
export function dateSuppression(from: Date): string {
  const d = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + 30));
  return d.toISOString().slice(0, 10);
}

const JOURS_COURTS: Record<string, string> = { lundi: "lu", mardi: "ma", mercredi: "me", jeudi: "je", vendredi: "ve", samedi: "sa", dimanche: "di" };

/** « 8h–12h, 14h–18h » → plages HH:MM. Ce qui ne se lit pas sûrement est laissé de côté (le texte reste dans le brief). */
export function lireHoraires(h: Partial<Record<string, string>>): { jours: string[]; ouverture: string; fermeture: string }[] {
  const plages = new Map<string, string[]>();
  for (const [jour, texte] of Object.entries(h)) {
    const court = JOURS_COURTS[jour];
    if (!court || !texte) continue;
    const re = /(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(?:[-–—à]|a)\s*(\d{1,2})\s*(?:h|:)\s*(\d{2})?/gi;
    for (const m of texte.matchAll(re)) {
      const o = `${m[1]!.padStart(2, "0")}:${m[2] ?? "00"}`;
      const f = `${m[3]!.padStart(2, "0")}:${m[4] ?? "00"}`;
      if (Number(m[1]) > 23 || Number(m[3]) > 23 || o >= f) continue;
      const key = `${o}-${f}`;
      plages.set(key, [...(plages.get(key) ?? []), court]);
    }
  }
  return [...plages.entries()].map(([k, jours]) => {
    const [ouverture, fermeture] = k.split("-") as [string, string];
    return { jours, ouverture, fermeture };
  });
}

/** Thème et variantes d'un site.json existant (exemple du kit ou site déjà fabriqué). */
function signatureDe(origine: string, site: Record<string, unknown>) {
  const theme = (site.theme ?? {}) as { preset?: string; couleurs?: Record<string, string>; polices?: { titres?: string; corps?: string }; signature?: string };
  const sections = (Array.isArray(site.sections) ? site.sections : []) as { type?: string; variante?: string }[];
  return {
    origine,
    preset: theme.preset ?? "?",
    couleurs: theme.couleurs ?? {},
    polices: theme.polices ?? {},
    signature: theme.signature ?? null,
    heroVariante: sections.find((s) => s.type === "hero")?.variante ?? null,
    variantes: sections.map((s) => `${s.type}:${s.variante}`),
  };
}

export function sitesDuMemeMetier(opts: { kitRoot: string; sitesDir: string; exceptSiteId: string; metier: string }): Brief["sitesMemeMetier"] {
  const out: Brief["sitesMemeMetier"] = [];
  const lire = (file: string) => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const exemples = join(opts.kitRoot, "examples");
  if (existsSync(exemples)) {
    for (const d of readdirSync(exemples)) {
      const s = lire(join(exemples, d, "site.json"));
      if (s && (s.entreprise as { metier?: string } | undefined)?.metier === opts.metier) out.push(signatureDe(`exemple du kit « ${d} »`, s));
    }
  }
  if (existsSync(opts.sitesDir)) {
    for (const d of readdirSync(opts.sitesDir)) {
      if (d === opts.exceptSiteId) continue;
      const s = lire(join(opts.sitesDir, d, "src", "data", "site.json"));
      if (s && (s.entreprise as { metier?: string } | undefined)?.metier === opts.metier) out.push(signatureDe(`site ${d}`, s));
    }
  }
  return out;
}

const SRC = (s: string | undefined) => s ?? "saisie";

export function buildBrief(input: {
  company: Company;
  siteId: string;
  recette: string;
  now: Date;
  credits: { fichier: string; metier: string; description: string; orientation: string; hero: boolean; largeur: number; hauteur: number }[];
  sitesMemeMetier: Brief["sitesMemeMetier"];
}): Brief {
  const c = input.company;
  const pre = prerequisMaquette(c);
  if (!pre.possible) throw new Error(`Fiche incomplète : il manque ${pre.manques.join(", ")}`);
  const act = activiteDe(c.naf, c.metier)!;
  const a: ActiviteNaf = act.activite;
  const s = c.sources;
  const nomAffiche = c.nomCommercial ?? c.raisonSociale;

  const siege = trouverAvecCodePostal(c.zone.commune ?? c.adresse.commune, c.adresse.codePostal) ?? trouverAvecCodePostal(c.adresse.commune, c.adresse.codePostal);
  const nomSiege = siege?.nom ?? c.zone.commune ?? c.adresse.commune!;
  const voisinesSaisies = c.zone.voisines.map((v) => {
    const t = trouverCommune(v);
    return { nom: t?.nom ?? v, lat: t?.lat ?? null, lon: t?.lon ?? null };
  });
  const candidates = siege && voisinesSaisies.length === 0 ? communesProches(siege).map(({ nom, lat, lon, km }) => ({ nom, lat, lon, km })) : [];
  const carteDisponible = !!siege && (voisinesSaisies.length ? voisinesSaisies.every((v) => v.lat !== null) : candidates.length > 0);

  const horaires = lireHoraires(c.horaires);
  const g = c.google;
  const noteGoogle =
    g && g.valeur != null && g.nombre != null && g.valeur >= 1 && g.nombre >= 1
      ? {
          valeur: { valeur: g.valeur, nombre: g.nombre },
          source: SRC(s.google),
          url: g.url
            ? { valeur: g.url, source: SRC(s.google) }
            : {
                valeur: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${nomAffiche} ${c.adresse.commune}`)}`,
                source: "hub : recherche Google Maps du nom et de la commune (la fiche n'a pas de lien direct)",
              },
        }
      : null;

  const dossiers = new Set([...a.banque, "maison"]);
  return {
    version: 1,
    genereLe: input.now.toISOString(),
    site: { id: input.siteId, recette: input.recette, slug: slugify(nomAffiche) },
    entreprise: {
      raisonSociale: { valeur: c.raisonSociale, source: SRC(s.raisonSociale) },
      nomCommercial: c.nomCommercial ? { valeur: c.nomCommercial, source: SRC(s.nomCommercial) } : null,
      nomAffiche,
      siren: c.siren ? { valeur: c.siren, source: SRC(s.siren) } : null,
      naf: c.naf ? { valeur: c.naf, source: SRC(s.naf) } : null,
      metier: {
        kit: a.metier,
        libelle: a.libelle,
        saisi: c.metier,
        source: act.via === "naf" ? `hub : table NAF (${a.naf})` : `hub : métier saisi « ${c.metier} » rapproché du NAF ${a.naf}`,
      },
      dateCreation: c.dateCreation ? { valeur: c.dateCreation, source: SRC(s.dateCreation) } : null,
      dirigeant: c.dirigeant ? { valeur: c.dirigeant, source: SRC(s.dirigeant) } : null,
      telephone: { valeur: c.telephone!, source: SRC(s.telephone) },
      email: c.email ? { valeur: c.email, source: SRC(s.email) } : null,
      siteActuel: c.siteActuel ? { valeur: c.siteActuel, source: SRC(s.siteActuel) } : null,
      adresse: { valeur: { rue: c.adresse.ligne!, codePostal: c.adresse.codePostal!, commune: c.adresse.commune! }, source: SRC(s.adresse) },
      horaires: horaires.length ? { valeur: horaires, source: `${SRC(s.horaires)} (lu par le hub depuis le texte des horaires)` } : null,
      horairesTexte: Object.keys(c.horaires).length ? { valeur: c.horaires as Record<string, string>, source: SRC(s.horaires) } : null,
      noteGoogle: noteGoogle ? { valeur: noteGoogle.valeur, source: noteGoogle.source, url: noteGoogle.url } : null,
      notes: c.notes ? { valeur: c.notes, source: "notes internes de la fiche (contexte, jamais affiché tel quel)" } : null,
    },
    activite: {
      naf: a.naf,
      intitule: a.intitule,
      prestationsPlausibles: a.prestations,
      source: "hub : prestations normalement couvertes par ce code NAF (pas des faits sur l'entreprise)",
    },
    zone: {
      siege: { valeur: { nom: nomSiege, lat: siege?.lat ?? null, lon: siege?.lon ?? null }, source: `${SRC(s.adresse)} ; coordonnées : table des communes du hub` },
      voisines: voisinesSaisies.length ? { valeur: voisinesSaisies, source: `${SRC(s.zone)} ; coordonnées : table des communes du hub` } : null,
      candidates,
      carteDisponible,
    },
    demo: { actif: true, agence: "Liverdian", dateSuppression: { valeur: dateSuppression(input.now), source: "hub : date de fabrication + 30 jours" } },
    banqueImages: input.credits.map((k) => ({
      fichier: `stock/${k.fichier}`,
      description: k.description,
      orientation: k.orientation,
      hero: k.hero,
      largeur: k.largeur,
      hauteur: k.hauteur,
      candidate: dossiers.has(k.fichier.split("/")[0] ?? ""),
    })),
    sitesMemeMetier: input.sitesMemeMetier,
    regles: [
      "Rien d'inventé : un fait qui n'est pas dans ce brief n'apparaît pas sur le site.",
      "Les prestations viennent de activite.prestationsPlausibles (couvertes par le code NAF) : en choisir, ne pas en ajouter d'autres.",
      "La note Google s'affiche exactement (valeur et nombre d'avis), avec son lien ; aucun texte d'avis.",
      "Ancienneté : seulement l'année de création (« depuis 2019 ») si dateCreation existe — jamais le jour ni le mois, jamais un nombre d'années calculé.",
      "Aucun label, certification, garantie, délai d'intervention, prix ou chiffre absent de ce brief.",
      "Le nom du dirigeant n'apparaît que s'il est dans ce brief.",
    ],
  };
}
