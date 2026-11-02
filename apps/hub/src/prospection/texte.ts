/** Outils de texte de la prospection : normalisation, ressemblance de noms et d'adresses, casse des communes. */

export function normaliser(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Formes juridiques et mots vides : ils ne distinguent pas deux entreprises. */
const VIDES = new Set(
  "sarl sas sasu eurl sa sci snc scop ei eirl micro entreprise ent ets etablissements etablissement societe ste cie compagnie et de la le les du des l d au aux en sur a".split(" "),
);

/** Mots du métier : utiles seulement quand il ne reste rien d'autre (« Plomberie » seule ne désigne personne). */
const GENERIQUES = new Set(
  (
    "plomberie plombier plomb electricite electricien elec electrique chauffage chauffagiste climatisation clim sanitaire sanitaires " +
    "services service renovation renov batiment batiments travaux depannage depannages multi energie energies toiture toitures couverture " +
    "couvreur menuiserie menuisier peinture peintre maconnerie macon carrelage carreleur isolation habitat maison artisan artisans " +
    "pro concept solutions solution groupe france rhone lyon lyonnaise lyonnais installation installations thermique genie " +
    "generale general generales generaux agencement construction constructions maintenance entretien technique techniques " +
    "bati amenagement amenagements reseaux reseau confort fluides fluide chauffe eau sarl"
  ).split(" "),
);

export function jetons(s: string | null | undefined): string[] {
  return normaliser(s)
    .split(" ")
    .filter((t) => t.length > 1 && !VIDES.has(t));
}

function dice<T>(a: T[], b: T[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const inter = new Set(a.filter((x) => sb.has(x))).size;
  return (2 * inter) / (new Set(a).size + sb.size);
}

function trigrammes(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 2; i++) out.push(t.slice(i, i + 3));
  return out;
}

/**
 * Ressemblance de deux noms d'entreprise, de 0 à 1. On compare d'abord les mots distinctifs (hors forme juridique
 * et mots du métier) ; un nom entièrement contenu dans l'autre compte presque comme égal (« Martin » / « Plomberie
 * Martin »), mais seulement s'il reste un vrai mot distinctif.
 */
export function ressemblanceNoms(a: string | null | undefined, b: string | null | undefined): number {
  const ta = jetons(a);
  const tb = jetons(b);
  if (!ta.length || !tb.length) return 0;
  const da = ta.filter((t) => !GENERIQUES.has(t));
  const db = tb.filter((t) => !GENERIQUES.has(t));
  if (da.length && db.length) {
    const sa = new Set(da);
    const sb = new Set(db);
    const inter = [...sa].filter((t) => sb.has(t));
    const contenu = inter.length / Math.min(sa.size, sb.size);
    const fort = inter.some((t) => t.length >= 4) ? 0.92 * contenu : 0.7 * contenu;
    const tri = dice(trigrammes(da.join(" ")), trigrammes(db.join(" ")));
    return Math.min(1, Math.max(dice(da, db), fort, tri * 0.95));
  }
  // Noms faits seulement de mots du métier : il faut une égalité presque parfaite.
  if (!da.length && !db.length) return dice(ta, tb) * 0.8;
  return dice(ta, tb) * 0.5;
}

/** Ressemblance de deux adresses : code postal, numéro, mots de la voie. */
export function ressemblanceAdresses(a: { ligne?: string | null; codePostal?: string | null }, b: { ligne?: string | null; codePostal?: string | null }): number | null {
  const la = normaliser(a.ligne);
  const lb = normaliser(b.ligne);
  if (!la && !lb && !a.codePostal && !b.codePostal) return null;
  let score = 0;
  let poids = 0;
  if (a.codePostal && b.codePostal) {
    poids += 0.3;
    if (a.codePostal === b.codePostal) score += 0.3;
  }
  if (la && lb) {
    const num = (s: string) => /^(\d+)/.exec(s)?.[1] ?? null;
    const na = num(la);
    const nb = num(lb);
    if (na && nb) {
      poids += 0.25;
      if (na === nb) score += 0.25;
    }
    const voie = (s: string) => jetons(s.replace(/^\d+\s*(bis|ter)?\s*/, "")).filter((t) => !/^\d+$/.test(t) && !["rue", "avenue", "av", "bd", "boulevard", "chemin", "ch", "place", "pl", "route", "rte", "allee", "impasse", "imp", "cours", "quai", "zac", "za", "zi"].includes(t));
    poids += 0.45;
    score += 0.45 * dice(voie(la), voie(lb));
  }
  return poids ? score / poids : null;
}

const MINUSCULES = new Set(["de", "du", "des", "la", "le", "les", "en", "sur", "sous", "lès", "les", "et", "d", "l", "aux", "au"]);

/** « SAINT-PRIEST » → « Saint-Priest », « VAULX EN VELIN » → « Vaulx en Velin » (repli quand geo.api ne répond pas). */
export function casseCommune(s: string): string {
  return s
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((m, i) => (/^[\s-]+$/.test(m) || (i > 0 && MINUSCULES.has(m)) ? m : m.charAt(0).toUpperCase() + m.slice(1)))
    .join("")
    .replace(/\bL'(\w)/g, (_x, c: string) => `L'${c.toUpperCase()}`);
}

/** Casse lisible d'une raison sociale en majuscules : « ELECTRICITE DUPONT » → « Electricite Dupont ». */
export function casseNom(s: string | null | undefined): string | null {
  if (!s) return null;
  if (s !== s.toUpperCase()) return s.trim();
  return s
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((m, i) => {
      if (/^(\s+|-|')$/.test(m)) return m;
      if (/^(sarl|sas|sasu|eurl|sa|sci|snc|ei|eirl)$/.test(m)) return m.toUpperCase();
      if (i > 0 && MINUSCULES.has(m)) return m;
      return m.charAt(0).toUpperCase() + m.slice(1);
    })
    .join("")
    .trim();
}

/** Téléphone français normalisé pour comparaison et empreinte (« +33 4 72… » → « 0472… »). */
export function normaliserTelephone(t: string | null | undefined): string | null {
  if (!t) return null;
  let d = t.replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  else if (d.startsWith("0033")) d = "0" + d.slice(4);
  d = d.replace(/\D/g, "");
  return d.length >= 9 ? d : null;
}

/** Affichage « 04 72 00 00 00 ». */
export function formaterTelephone(t: string | null | undefined): string | null {
  const d = normaliserTelephone(t);
  if (!d) return t ?? null;
  return d.length === 10 ? d.replace(/(\d{2})(?=\d)/g, "$1 ") : d;
}

export function domaineDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}
