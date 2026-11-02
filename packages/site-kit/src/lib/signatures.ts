/**
 * Éléments signature : chaque site a un motif graphique propre (fond texturé discret, marqueur de surtitre,
 * traitement des cadres d'image). Ils sont générés en SVG au build avec les couleurs du thème.
 */
import type { Signature } from "../schema.ts";

const svgUrl = (w: number, h: number, corps: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' fill='none'>${corps}</svg>`,
  )}")`;

/** Motif répétable pour un fond (`background-image`), avec sa taille de tuile. */
export function motif(sig: Signature, couleur: string, opacite = 0.14): { image: string; taille: string } {
  const s = `stroke='${couleur}' stroke-opacity='${opacite}'`;
  switch (sig) {
    case "faisceau":
      // Trame de plan technique : quadrillage fin + repères en croix aux nœuds.
      return {
        image: svgUrl(
          48,
          48,
          `<path d='M0 .5H48M.5 0V48' ${s} stroke-width='1'/><path d='M.5 -3.5V4.5M-3.5 .5H4.5' stroke='${couleur}' stroke-opacity='${Math.min(opacite * 2.2, 1)}' stroke-width='1'/>`,
        ),
        taille: "48px 48px",
      };
    case "onde":
      return {
        image: svgUrl(120, 28, `<path d='M0 14C20 2 40 2 60 14S100 26 120 14' ${s} stroke-width='1.25'/>`),
        taille: "120px 28px",
      };
    case "isobares":
      return {
        image: svgUrl(
          180,
          180,
          [30, 60, 90, 120, 150, 180].map((r) => `<circle cx='0' cy='180' r='${r}' ${s} stroke-width='1'/><circle cx='180' cy='0' r='${r}' ${s} stroke-width='1'/>`).join(""),
        ),
        taille: "180px 180px",
      };
    case "tuiles":
      // Écailles de tuiles canal vues de face.
      return {
        image: svgUrl(
          44,
          22,
          `<path d='M0 22A22 22 0 0 1 44 22M-22 11A22 22 0 0 1 22 11M22 11A22 22 0 0 1 66 11' ${s} stroke-width='1.25'/>`,
        ),
        taille: "44px 22px",
      };
    case "veinage":
      return {
        image: svgUrl(
          240,
          64,
          `<path d='M0 10C40 4 80 18 120 12S200 2 240 10M0 26C50 20 90 34 130 28S205 20 240 26M0 42C30 38 70 50 120 44S190 34 240 42M0 58C60 54 100 62 150 58S210 52 240 58' ${s} stroke-width='1'/>`,
        ),
        taille: "240px 64px",
      };
    case "aplat":
      return {
        image: svgUrl(14, 14, `<path d='M-3.5 3.5L3.5 -3.5M0 14L14 0M10.5 17.5L17.5 10.5' ${s} stroke-width='1'/>`),
        taille: "14px 14px",
      };
  }
}

/** Traitement du cadre des images mises en avant (hero scindé, bandes, manifeste). */
export function cadre(sig: Signature): "equerres" | "decale" | "arche" | "simple" {
  switch (sig) {
    case "faisceau":
      return "equerres";
    case "tuiles":
      return "arche";
    case "veinage":
    case "aplat":
      return "decale";
    default:
      return "simple";
  }
}
