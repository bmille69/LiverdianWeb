/**
 * Résolution des images déclarées dans site.json (`images.<clé>.fichier`) vers des imports astro:assets.
 * Les fichiers vivent à la racine du site : `stock/<metier>/…` (banque copiée par new-site) ou `photos/…` (client).
 */
import type { ImageMetadata } from "astro";
import { site } from "./site.ts";

const fichiers = import.meta.glob<ImageMetadata>(
  ["/stock/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG}", "/photos/**/*.{jpg,jpeg,png,webp,avif,JPG,JPEG,PNG}"],
  { eager: true, import: "default" },
);

export type ImageSite = { src: ImageMetadata; alt: string; focale: string };

export function image(cle: string | undefined): ImageSite | undefined {
  if (!cle) return undefined;
  const decl = site.images[cle];
  if (!decl) throw new Error(`Image « ${cle} » non déclarée dans site.json > images`);
  const src = fichiers["/" + decl.fichier];
  if (!src) {
    throw new Error(
      `Image « ${cle} » : fichier « ${decl.fichier} » introuvable. Lancer new-site.mjs (copie de la banque) ou ajouter le fichier dans le dossier du site.`,
    );
  }
  return { src, alt: decl.alt, focale: decl.focale ?? "50% 50%" };
}

/** Variante obligatoire (le schéma garantit déjà la présence de la clé). */
export function imageRequise(cle: string | undefined): ImageSite {
  const i = image(cle);
  if (!i) throw new Error("Image requise manquante");
  return i;
}
