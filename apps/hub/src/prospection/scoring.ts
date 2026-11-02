import { z } from "zod";

/**
 * Grille de score des prospects (plan d'origine, « Grille de scoring »), réglable dans l'interface.
 * Calcul en code pur, chaque point expliqué : quelle règle, combien, pourquoi (ou pourquoi pas).
 */
export const REGLES = ["aucun_site", "site_defaillant", "copyright_ancien", "avis", "anciennete", "site_correct", "franchise"] as const;
export type RegleId = (typeof REGLES)[number];

export const Regle = z.object({
  id: z.enum(REGLES),
  actif: z.boolean(),
  points: z.number().int().min(-100, "−100 au plus").max(100, "100 au plus"),
  /** Paramètre de la règle : année du copyright, nombre d'avis, ancienneté en années. */
  param: z.number().min(0).max(3000).optional(),
  /** Second paramètre : note Google minimale. */
  param2: z.number().min(0).max(5).optional(),
});
export const Grille = z.object({
  seuil: z.number().int().min(0).max(200),
  regles: z.array(Regle).length(REGLES.length, "La grille compte toutes les règles"),
});
export type Grille = z.infer<typeof Grille>;
export type Regle = z.infer<typeof Regle>;

export const GRILLE_DEFAUT: Grille = {
  seuil: 50,
  regles: [
    { id: "aucun_site", actif: true, points: 40 },
    { id: "site_defaillant", actif: true, points: 25 },
    { id: "copyright_ancien", actif: true, points: 10, param: 2021 },
    { id: "avis", actif: true, points: 20, param: 10, param2: 4.3 },
    { id: "anciennete", actif: true, points: 10, param: 2 },
    { id: "site_correct", actif: true, points: -50 },
    { id: "franchise", actif: true, points: 0 },
  ],
};

/** Libellé lisible d'une règle avec ses paramètres. */
export function libelleRegle(r: Regle): string {
  switch (r.id) {
    case "aucun_site":
      return "Aucun site web";
    case "site_defaillant":
      return "Site sans HTTPS ou non adapté au mobile";
    case "copyright_ancien":
      return `Copyright ou dernière mise à jour avant ${r.param ?? 2021}`;
    case "avis":
      return `${r.param ?? 10} avis Google ou plus, note ≥ ${(r.param2 ?? 4.3).toLocaleString("fr-FR")}`;
    case "anciennete":
      return `Entreprise créée depuis plus de ${r.param ?? 2} ans`;
    case "site_correct":
      return "Site récent et correct";
    case "franchise":
      return "Franchise ou réseau national : exclu";
  }
}

/** Une grille enregistrée, complétée par les règles par défaut qui lui manqueraient (ordre de la grille du plan). */
export function grilleComplete(raw: unknown): Grille {
  const parsed = z.object({ seuil: z.number().optional(), regles: z.array(Regle.partial({ actif: true, points: true })).optional() }).safeParse(raw);
  if (!parsed.success) return GRILLE_DEFAUT;
  return {
    seuil: parsed.data.seuil ?? GRILLE_DEFAUT.seuil,
    regles: GRILLE_DEFAUT.regles.map((d) => {
      const r = parsed.data.regles?.find((x) => x.id === d.id);
      return r ? { ...d, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) } : d;
    }) as Regle[],
  };
}

export type StatutSite = "aucun" | "annuaire_seulement" | "injoignable" | "sans_https" | "non_mobile" | "date" | "correct" | "inconnu";

export type Faits = {
  statutSite: StatutSite;
  /** Sources consultées pour savoir si un site existe (sans Places, « aucun site trouvé » reste incertain). */
  sourcesSite: ("places" | "osm" | "saisie")[];
  https: boolean | null;
  mobile: boolean | null;
  anneeCopyright: number | null;
  /** Indice d'âge relevé par l'audit (technologie datée, dernière modification), même sans copyright. */
  techDatee: string | null;
  avis: { note: number | null; nombre: number | null } | null;
  dateCreation: string | null;
  franchise: { oui: boolean; raison: string } | null;
};

export type LigneScore = { regle: RegleId; libelle: string; points: number; applique: boolean; raison: string; incertain?: boolean };
/**
 * `qualifie` : au seuil sans compter les points incertains (« aucun site » sans Google Places, par exemple).
 * `aVerifier` : au seuil seulement grâce à eux ; la fiche reste « Prospect » tant qu'on n'a pas vérifié.
 */
export type Score = { total: number; seuil: number; qualifie: boolean; aVerifier: boolean; exclu: string | null; lignes: LigneScore[] };

const SANS_VRAI_SITE: StatutSite[] = ["aucun", "annuaire_seulement", "injoignable"];

export function calculerScore(grille: Grille, f: Faits, maintenant: Date = new Date()): Score {
  const lignes: LigneScore[] = [];
  let exclu: string | null = null;
  for (const r of grille.regles) {
    const libelle = libelleRegle(r);
    if (!r.actif) {
      lignes.push({ regle: r.id, libelle, points: 0, applique: false, raison: "règle désactivée" });
      continue;
    }
    const ligne = (applique: boolean, raison: string, incertain?: boolean) => lignes.push({ regle: r.id, libelle, points: applique ? r.points : 0, applique, raison, ...(incertain ? { incertain } : {}) });
    switch (r.id) {
      case "aucun_site": {
        const sans = SANS_VRAI_SITE.includes(f.statutSite);
        const incertain = f.statutSite === "aucun" && !f.sourcesSite.includes("places");
        const raisons: Record<string, string> = {
          aucun: incertain ? `aucun site trouvé (consulté : ${f.sourcesSite.join(", ") || "aucune source"} ; sans Google Places, un site peut exister)` : `aucun site sur ${f.sourcesSite.join(", ")}`,
          annuaire_seulement: "seulement une page d'annuaire ou de réseau social, pas de vrai site",
          injoignable: "le site déclaré ne répond pas",
        };
        ligne(sans, sans ? raisons[f.statutSite]! : "un site existe", sans && incertain);
        break;
      }
      case "site_defaillant": {
        if (SANS_VRAI_SITE.includes(f.statutSite) || f.statutSite === "inconnu") ligne(false, f.statutSite === "inconnu" ? "site non audité" : "pas de site à juger");
        else {
          const defauts = [f.https === false ? "sans HTTPS" : null, f.mobile === false ? "non adapté au mobile" : null].filter(Boolean);
          ligne(defauts.length > 0, defauts.length ? defauts.join(", ") : "HTTPS et mobile corrects");
        }
        break;
      }
      case "copyright_ancien": {
        const annee = r.param ?? 2021;
        if (SANS_VRAI_SITE.includes(f.statutSite) || f.statutSite === "inconnu") ligne(false, "pas de site à dater");
        else if (f.anneeCopyright != null) ligne(f.anneeCopyright < annee, `copyright ${f.anneeCopyright}`);
        else if (f.techDatee) ligne(true, `pas d'année de copyright, mais ${f.techDatee}`, true);
        else ligne(false, "aucune année relevée");
        break;
      }
      case "avis": {
        const min = r.param ?? 10;
        const note = r.param2 ?? 4.3;
        if (!f.avis || f.avis.nombre == null) ligne(false, "avis Google inconnus (Google Places non consulté)", true);
        else {
          const ok = f.avis.nombre >= min && (f.avis.note ?? 0) >= note;
          ligne(ok, `${(f.avis.note ?? 0).toLocaleString("fr-FR")}/5 sur ${f.avis.nombre} avis`);
        }
        break;
      }
      case "anciennete": {
        const ans = r.param ?? 2;
        if (!f.dateCreation) ligne(false, "date de création inconnue");
        else {
          const age = ageAnnees(f.dateCreation, maintenant);
          ligne(age > ans, `créée le ${f.dateCreation.split("-").reverse().join("/")} (${Math.floor(age)} an${Math.floor(age) > 1 ? "s" : ""})`);
        }
        break;
      }
      case "site_correct": {
        const ok = f.statutSite === "correct";
        ligne(ok, ok ? `HTTPS, mobile${f.anneeCopyright ? `, copyright ${f.anneeCopyright}` : ""}` : "site absent, daté ou défaillant");
        break;
      }
      case "franchise": {
        const oui = !!f.franchise?.oui;
        if (oui) exclu = f.franchise!.raison;
        lignes.push({ regle: r.id, libelle, points: 0, applique: oui, raison: oui ? f.franchise!.raison : f.franchise ? f.franchise.raison : "aucun signe de franchise ou de réseau" });
        break;
      }
    }
  }
  const total = lignes.reduce((s, l) => s + l.points, 0);
  const sur = total - lignes.filter((l) => l.incertain && l.points > 0).reduce((s, l) => s + l.points, 0);
  const auSeuil = !exclu && total >= grille.seuil;
  return { total, seuil: grille.seuil, qualifie: auSeuil && sur >= grille.seuil, aVerifier: auSeuil && sur < grille.seuil, exclu, lignes };
}

export function ageAnnees(dateIso: string, maintenant: Date): number {
  return (maintenant.getTime() - new Date(`${dateIso}T00:00:00Z`).getTime()) / (365.25 * 86400_000);
}

/** Le statut du site est-il « défaillant » au sens des critères de campagne (daté, sans HTTPS, non mobile) ? */
export function siteDefaillant(s: StatutSite): boolean {
  return s === "sans_https" || s === "non_mobile" || s === "date";
}
export function sansVraiSite(s: StatutSite): boolean {
  return SANS_VRAI_SITE.includes(s);
}
