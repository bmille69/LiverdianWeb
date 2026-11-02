/**
 * Thèmes : préréglages par métier, fusion avec les surcharges du site, contrôle des contrastes (WCAG AA)
 * et conversion en variables CSS lues par Tailwind (voir src/styles/global.css).
 */
import type { Couleurs, Police, Preset, Signature, Theme } from "../schema.ts";
import { POLICES_DEF, REPLI_SYSTEME } from "./polices.ts";

export type ThemeResolu = {
  preset: Preset;
  couleurs: Couleurs;
  polices: { titres: Police; corps: Police };
  rayon: number;
  signature: Signature;
};

/**
 * Préréglages. Chaque palette suit `skills/design/design-par-metier` :
 * neutres teintés vers la marque, un accent réservé aux actions, un fond sombre pour rythmer.
 */
export const PRESETS_DEF: Record<Preset, Omit<ThemeResolu, "preset"> & { description: string }> = {
  electricien: {
    description: "Bleu nuit et anthracite, accent ambre. Grotesque technique. Précis, rassurant.",
    couleurs: {
      fond: "#F5F7FA",
      surface: "#FFFFFF",
      teinte: "#E8EDF4",
      encre: "#0F1A2C",
      encreDouce: "#4A5569",
      trait: "#D3DAE5",
      sombre: "#0C1524",
      sombreSurface: "#16223A",
      surSombre: "#F1F4F9",
      surSombreDoux: "#A8B3C7",
      accent: "#F4B63F",
      surAccent: "#0F1A2C",
      accentTexte: "#865600",
      accentSurSombre: "#F6C25B",
    },
    polices: { titres: "archivo", corps: "inter" },
    rayon: 4,
    signature: "faisceau",
  },
  plombier: {
    description: "Bleu profond sur blanc cassé, accent orange franc. Grotesque à caractère. Direct, disponible.",
    couleurs: {
      fond: "#F7F6F2",
      surface: "#FFFFFF",
      teinte: "#E3EDEF",
      encre: "#0C2232",
      encreDouce: "#475966",
      trait: "#D3DDE1",
      sombre: "#0A2A3E",
      sombreSurface: "#113951",
      surSombre: "#EEF5F7",
      surSombreDoux: "#A4BCC8",
      accent: "#C9471A",
      surAccent: "#FFFFFF",
      accentTexte: "#A93C14",
      accentSurSombre: "#FF9566",
    },
    polices: { titres: "bricolage-grotesque", corps: "source-sans-3" },
    rayon: 12,
    signature: "onde",
  },
  chauffagiste: {
    description: "Anthracite chaud, accent rouge brique. Sans-serif géométrique. Expert, pédagogue.",
    couleurs: {
      fond: "#F7F4F0",
      surface: "#FFFFFF",
      teinte: "#F0E6DC",
      encre: "#1F1A17",
      encreDouce: "#5A5049",
      trait: "#E1D6CB",
      sombre: "#211C19",
      sombreSurface: "#2E2723",
      surSombre: "#F6EFE8",
      surSombreDoux: "#BEB1A5",
      accent: "#B23D1C",
      surAccent: "#FFFFFF",
      accentTexte: "#A0371A",
      accentSurSombre: "#F38E61",
    },
    polices: { titres: "manrope", corps: "inter" },
    rayon: 8,
    signature: "isobares",
  },
  couvreur: {
    description: "Ardoise et pierre, accent terre cuite. Serif à caractère. Artisanal, fier.",
    couleurs: {
      fond: "#F5F1EA",
      surface: "#FFFDF9",
      teinte: "#EBE2D5",
      encre: "#1D2125",
      encreDouce: "#52595F",
      trait: "#DCD2C3",
      sombre: "#262C32",
      sombreSurface: "#323A41",
      surSombre: "#F3EEE6",
      surSombreDoux: "#B8B5AD",
      accent: "#A04B26",
      surAccent: "#FFFFFF",
      accentTexte: "#954524",
      accentSurSombre: "#E89D70",
    },
    polices: { titres: "fraunces", corps: "work-sans" },
    rayon: 2,
    signature: "tuiles",
  },
  menuisier: {
    description: "Crème et bois clair, accent vert profond. Serif display. Chaleureux, minutieux.",
    couleurs: {
      fond: "#FAF6EE",
      surface: "#FFFFFF",
      teinte: "#F1E7D6",
      encre: "#221F1A",
      encreDouce: "#5B554A",
      trait: "#E3D8C4",
      sombre: "#1D3A2D",
      sombreSurface: "#264A3A",
      surSombre: "#F4F0E6",
      surSombreDoux: "#B9C7B8",
      accent: "#1E5B42",
      surAccent: "#FFFFFF",
      accentTexte: "#1E5B42",
      accentSurSombre: "#E9C88E",
    },
    polices: { titres: "dm-serif-display", corps: "inter" },
    rayon: 6,
    signature: "veinage",
  },
  peintre: {
    description: "Blanc chaud, accent bleu franc, sombre indigo. Grotesque contemporaine. Soigné, créatif.",
    couleurs: {
      fond: "#FBF8F3",
      surface: "#FFFFFF",
      teinte: "#F3ECE2",
      encre: "#1B1B22",
      encreDouce: "#55555F",
      trait: "#E6DED2",
      sombre: "#21243A",
      sombreSurface: "#2D3150",
      surSombre: "#F5F2EC",
      surSombreDoux: "#B6B8CB",
      accent: "#2E4BD0",
      surAccent: "#FFFFFF",
      accentTexte: "#2E4BD0",
      accentSurSombre: "#A3B4FF",
    },
    polices: { titres: "schibsted-grotesk", corps: "inter" },
    rayon: 0,
    signature: "aplat",
  },
};

export function resoudreTheme(t: Theme): ThemeResolu {
  const base = PRESETS_DEF[t.preset];
  return {
    preset: t.preset,
    couleurs: { ...base.couleurs, ...(t.couleurs ?? {}) },
    polices: { titres: t.polices?.titres ?? base.polices.titres, corps: t.polices?.corps ?? base.polices.corps },
    rayon: t.rayon ?? base.rayon,
    signature: t.signature ?? base.signature,
  };
}

// ─── Contrastes ──────────────────────────────────────────────────────────────

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Paires texte/fond réellement utilisées par les sections, avec leur seuil. */
const PAIRES: [keyof Couleurs, keyof Couleurs, number][] = [
  ["encre", "fond", 7],
  ["encre", "surface", 7],
  ["encre", "teinte", 7],
  ["encreDouce", "fond", 4.5],
  ["encreDouce", "surface", 4.5],
  ["encreDouce", "teinte", 4.5],
  ["accentTexte", "fond", 4.5],
  ["accentTexte", "surface", 4.5],
  ["accentTexte", "teinte", 4.5],
  ["surAccent", "accent", 4.5],
  ["surSombre", "sombre", 7],
  ["surSombre", "sombreSurface", 4.5],
  ["surSombreDoux", "sombre", 4.5],
  ["surSombreDoux", "sombreSurface", 4.5],
  ["accentSurSombre", "sombre", 4.5],
  ["accentSurSombre", "sombreSurface", 4.5],
];

export function verifierContrastes(c: Couleurs): string[] {
  const erreurs: string[] = [];
  for (const [t, f, min] of PAIRES) {
    const r = contraste(c[t], c[f]);
    if (r < min) erreurs.push(`contraste ${t} (${c[t]}) sur ${f} (${c[f]}) = ${r.toFixed(2)}:1, minimum ${min}:1`);
  }
  return erreurs;
}

// ─── Variables CSS ───────────────────────────────────────────────────────────

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

export function variablesCss(t: ThemeResolu): string {
  const pt = POLICES_DEF[t.polices.titres];
  const pc = POLICES_DEF[t.polices.corps];
  const lignes = Object.entries(t.couleurs).map(([k, v]) => `--c-${kebab(k)}:${v}`);
  lignes.push(
    `--f-titres:'${pt.famille}','${pt.famille} repli',${REPLI_SYSTEME[pt.base].pile}`,
    `--f-corps:'${pc.famille}','${pc.famille} repli',${REPLI_SYSTEME[pc.base].pile}`,
    `--poids-titre:${pt.poidsTitre}`,
    `--approche-titre:${pt.approche}`,
    `--rayon:${t.rayon}px`,
    `--rayon-l:${t.rayon === 0 ? 0 : Math.min(t.rayon * 2, 24)}px`,
  );
  return `:root{${lignes.join(";")}}`;
}
