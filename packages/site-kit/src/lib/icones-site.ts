/** Favicon et image de partage générés depuis le thème (initiales + couleurs). */
import { theme, nom, site } from "./site.ts";
import { initiales } from "./format.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function faviconSvg(): string {
  const c = theme.couleurs;
  const r = Math.min(theme.rayon * 1.5, 14);
  const ini = echapper(initiales(nom));
  const serif = theme.polices.titres === "fraunces" || theme.polices.titres === "dm-serif-display";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${r}" fill="${c.sombre}"/><rect x="8" y="50" width="48" height="4" rx="2" fill="${c.accentSurSombre}"/><text x="32" y="41" text-anchor="middle" font-family="${serif ? "Georgia, serif" : "Arial, Helvetica, sans-serif"}" font-weight="700" font-size="${ini.length > 1 ? 28 : 34}" letter-spacing="-1" fill="${c.surSombre}">${ini}</text></svg>`;
}

/** Calque texte de l'image Open Graph (1200×630) posé sur la photo du hero, ou sur un aplat. */
export function ogSvg(avecPhoto: boolean): string {
  const c = theme.couleurs;
  const titre = echapper(`${site.entreprise.metierLibelle} à ${site.zone.commune.nom}`);
  const n = echapper(nom);
  const ini = echapper(initiales(nom));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="v" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${c.sombre}" stop-opacity="${avecPhoto ? 0.94 : 1}"/><stop offset="0.65" stop-color="${c.sombre}" stop-opacity="${avecPhoto ? 0.7 : 1}"/><stop offset="1" stop-color="${c.sombre}" stop-opacity="${avecPhoto ? 0.15 : 1}"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#v)"/>
  <rect x="80" y="96" width="88" height="88" rx="${Math.min(theme.rayon * 2, 20)}" fill="${c.accentSurSombre}"/>
  <text x="124" y="155" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="38" fill="${c.sombre}">${ini}</text>
  <text x="80" y="330" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="64" fill="${c.surSombre}">${titre}</text>
  <text x="80" y="400" font-family="Arial, Helvetica, sans-serif" font-size="38" fill="${c.surSombreDoux}">${n}</text>
  <rect x="80" y="470" width="120" height="6" fill="${c.accentSurSombre}"/>
</svg>`;
}
