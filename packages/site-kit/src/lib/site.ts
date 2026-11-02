/**
 * Point d'entrée des composants : le site validé, typographié, et ses données dérivées.
 * Aucun composant ne lit site.json directement.
 */
import brut from "../data/site.json";
import { validerSite, type Section, type Site } from "../schema.ts";
import { typoFrProfond } from "./typo.ts";
import { resoudreTheme } from "./theme.ts";
import { telAffiche, telLien } from "./format.ts";

const r = validerSite(brut);
if (!r.ok) throw new Error("site.json invalide :\n" + r.erreurs.map((e) => "  • " + e).join("\n"));

export const site: Site = typoFrProfond(r.site);
export const theme = resoudreTheme(site.theme);
export const nom = site.entreprise.nomCommercial ?? site.entreprise.raisonSociale;
export const tel = { affiche: telAffiche(site.entreprise.telephone), lien: telLien(site.entreprise.telephone) };
export const demo = site.demo.actif;

/** Libellés de menu et ancres par défaut. */
const MENU_DEFAUT: Record<Section["type"], string | false> = {
  hero: false,
  services: "Services",
  pourquoi: false,
  realisations: "Réalisations",
  avis: "Avis",
  zone: "Zone",
  appel: false,
  devis: false,
  surmesure: false,
};

export function ancre(s: Section): string {
  return s.type === "hero" ? "haut" : (s.ancre ?? s.type);
}

/** Photos de banque seulement : « Réalisations » promettrait des chantiers de l'entreprise, on dit « En images ». */
const imagesDeBanque = (s: Section) =>
  s.type === "realisations" && s.contenu.images.every((im) => site.images[im.image]?.fichier.startsWith("stock/"));

export const liensMenu = site.sections
  .map((s) => {
    const defaut = imagesDeBanque(s) ? "En images" : MENU_DEFAUT[s.type];
    const lib = s.type === "hero" ? false : s.menu === undefined ? defaut : s.menu;
    return lib ? { libelle: lib, href: `/#${ancre(s)}` } : null;
  })
  .filter((x): x is { libelle: string; href: string } => x !== null);

export const sectionDevis = site.sections.find((s) => s.type === "devis");
export const ancreDevis = `/#${sectionDevis ? ancre(sectionDevis) : "devis"}`;
export const libelleDevis = site.entete.boutonDevis ?? "Demander un devis";

/** La note Google est-elle affichée quelque part sur la page (condition du JSON-LD aggregateRating) ? */
export const noteAffichee =
  !!site.entreprise.noteGoogle &&
  site.sections.some((s) => s.type === "avis" || (s.type === "hero" && s.contenu.afficherNote));

/** Services (titres) pour la liste « Votre besoin » du formulaire. */
export const titresServices = site.sections.flatMap((s) => (s.type === "services" ? s.contenu.items.map((i) => i.titre) : []));

/**
 * Fonds des sections : alternance automatique pour que deux sections consécutives n'aient jamais le même fond.
 * Chaque variante déclare le fond qu'elle préfère, transformé par le rythme du site (`theme.mise.rythme`) ;
 * une section peut imposer le sien (`fond`). On corrige s'il répète le précédent.
 */
export type Fond = "clair" | "surface" | "teinte" | "sombre";
const FOND_PREFERE: Record<string, Fond> = {
  "hero:photo": "sombre",
  "hero:typo": "teinte",
  "hero:scinde": "clair",
  "hero:panorama": "clair",
  "hero:encart": "sombre",
  "services:cartes": "clair",
  "services:liste": "surface",
  "services:bandes": "clair",
  "services:index": "surface",
  "services:tuiles": "teinte",
  "pourquoi:colonnes": "teinte",
  "pourquoi:manifeste": "sombre",
  "pourquoi:etapes": "clair",
  "pourquoi:encadre": "surface",
  "realisations:mosaique": "surface",
  "realisations:grille": "clair",
  "realisations:bande": "sombre",
  "realisations:diptyque": "clair",
  "avis:badge": "teinte",
  "avis:bandeau": "sombre",
  "zone:carte": "clair",
  "zone:liste": "teinte",
  "zone:tableau": "surface",
  "zone:bandeau": "sombre",
  "appel:bande": "sombre",
  "appel:carte": "clair",
  "devis:scinde": "teinte",
  "devis:encadre": "sombre",
  "devis:plein": "teinte",
  "devis:appel": "clair",
  "surmesure:composant": "teinte",
};
const ROTATION: Fond[] = ["clair", "teinte", "surface", "sombre"];

/** Rythme des fonds : « contraste » assombrit les sections teintées, « clair » éclaircit les sombres, « chaud » teinte la page. */
function selonRythme(f: Fond, cle: string): Fond {
  switch (theme.mise.rythme) {
    case "contraste":
      return f === "teinte" ? "sombre" : f;
    case "clair":
      // Les bandes d'appel et d'avis restent sombres : ce sont des ponctuations voulues.
      return f === "sombre" && cle !== "appel:bande" && cle !== "avis:bandeau" ? "teinte" : f;
    case "chaud":
      return f === "clair" ? "teinte" : f === "teinte" ? "surface" : f;
    default:
      return f;
  }
}

export const fonds: Fond[] = (() => {
  const out: Fond[] = [];
  site.sections.forEach((s, i) => {
    const cle = `${s.type}:${s.variante}`;
    // Le hero porte son propre fond (il n'en change pas) ; les autres suivent le rythme, sauf fond imposé.
    let f = s.type === "hero" ? (FOND_PREFERE[cle] ?? "clair") : (s.fond ?? selonRythme(FOND_PREFERE[cle] ?? "clair", cle));
    const prev = out[i - 1];
    // clair et surface sont trop proches pour se suivre.
    const proche = (a: Fond, b?: Fond) => a === b || (b !== undefined && a !== "sombre" && a !== "teinte" && b !== "sombre" && b !== "teinte");
    // Rythme « contraste » : une section sur deux passe en sombre (si la précédente ne l'est pas déjà).
    if (theme.mise.rythme === "contraste" && s.type !== "hero" && !s.fond && i % 2 === 0 && prev !== "sombre") f = "sombre";
    if (proche(f, prev)) f = ROTATION.find((c) => !proche(c, prev) && c !== "sombre") ?? "teinte";
    out.push(f);
  });
  return out;
})();
