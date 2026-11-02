/**
 * Mises en forme déterministes (code pur, jamais un LLM) : téléphone, dates, horaires, note.
 */
import type { Entreprise } from "../schema.ts";

/** "04.78.12.34.56" | "+33 4 78 12 34 56" → chiffres nationaux "0478123456". */
export function telNational(tel: string): string {
  const d = tel.replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) return "0" + d.slice(3);
  if (d.startsWith("0033")) return "0" + d.slice(4);
  return d;
}

/** Affichage français : "04 78 12 34 56" (espaces insécables pour éviter la coupure). */
export function telAffiche(tel: string): string {
  return telNational(tel).replace(/(\d{2})(?=\d)/g, "$1 ");
}

/** Lien `tel:` au format international : "tel:+33478123456". */
export function telLien(tel: string): string {
  return "tel:+33" + telNational(tel).slice(1);
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** "2026-12-02" → "2 décembre 2026" (1er pour le premier du mois). */
export function dateLongue(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  if (!a || !m || !j) return iso;
  return `${j === 1 ? "1er" : j} ${MOIS[m - 1]} ${a}`;
}

export function annee(iso: string): number {
  return Number(iso.slice(0, 4));
}

const JOURS_LONGS: Record<string, string> = { lu: "lundi", ma: "mardi", me: "mercredi", je: "jeudi", ve: "vendredi", sa: "samedi", di: "dimanche" };
const ORDRE = ["lu", "ma", "me", "je", "ve", "sa", "di"];
const SCHEMA_ORG: Record<string, string> = {
  lu: "Monday",
  ma: "Tuesday",
  me: "Wednesday",
  je: "Thursday",
  ve: "Friday",
  sa: "Saturday",
  di: "Sunday",
};

/** "08:00" → "8 h", "08:30" → "8 h 30". */
export function heureFr(h: string): string {
  const [hh, mm] = h.split(":");
  const n = Number(hh);
  return mm === "00" ? `${n} h` : `${n} h ${mm}`;
}

/** ["lu","ma","me","je","ve"] → "Du lundi au vendredi" ; ["sa"] → "Le samedi" ; ["lu","me"] → "Lundi, mercredi". */
export function joursFr(jours: string[]): string {
  const idx = [...new Set(jours)].map((j) => ORDRE.indexOf(j)).sort((a, b) => a - b);
  const contigu = idx.every((v, i) => i === 0 || v === (idx[i - 1] ?? -2) + 1);
  const nom = (i: number) => JOURS_LONGS[ORDRE[i] ?? "lu"] ?? "";
  if (idx.length === 1) return `Le ${nom(idx[0] ?? 0)}`;
  if (idx.length === 7) return "Tous les jours";
  if (contigu && idx.length >= 3) return `Du ${nom(idx[0] ?? 0)} au ${nom(idx[idx.length - 1] ?? 0)}`;
  const s = idx.map(nom).join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type LigneHoraire = { jours: string; heures: string };

/** Fusionne les plages d'un même groupe de jours : "8 h – 12 h, 14 h – 18 h". */
export function horairesFr(h: Entreprise["horaires"]): LigneHoraire[] {
  if (!h?.length) return [];
  const groupes = new Map<string, { jours: string[]; plages: string[] }>();
  for (const p of h) {
    const cle = [...p.jours].sort((a, b) => ORDRE.indexOf(a) - ORDRE.indexOf(b)).join(",");
    const g = groupes.get(cle) ?? { jours: p.jours, plages: [] };
    g.plages.push(`${heureFr(p.ouverture)} – ${heureFr(p.fermeture)}`);
    groupes.set(cle, g);
  }
  return [...groupes.values()].map((g) => ({ jours: joursFr(g.jours), heures: g.plages.join(", ") }));
}

export function horairesSchemaOrg(h: Entreprise["horaires"]) {
  return (h ?? []).map((p) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: p.jours.map((j) => SCHEMA_ORG[j]),
    opens: p.ouverture,
    closes: p.fermeture,
  }));
}

/** 4.8 → "4,8" */
export function noteFr(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

/** "123456789" → "123 456 789" */
export function sirenFr(s: string): string {
  return s.replace(/\s/g, "").replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** Initiales pour le favicon : 2 lettres tirées du nom (« Atelier Brunet » → « AB »). */
export function initiales(nom: string): string {
  const mots = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s'’-]+/)
    .filter((m) => m.length > 1 && !/^(de|du|des|la|le|les|et|sarl|sas|eurl|sasu|ets)$/i.test(m));
  const a = (mots[0]?.[0] ?? "L").toUpperCase();
  const b = (mots[1]?.[0] ?? mots[0]?.[1] ?? "").toUpperCase();
  return a + b;
}
