// Image de partage 1200×630 : photo du hero recadrée + calque (métier, commune, nom), ou aplat du thème.
import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { site } from "../lib/site.ts";
import { ogSvg } from "../lib/icones-site.ts";

export const GET: APIRoute = async () => {
  const hero = site.sections.find((s) => s.type === "hero");
  const cle = hero?.type === "hero" ? hero.contenu.image : undefined;
  const fichier = cle ? site.images[cle]?.fichier : undefined;
  const chemin = fichier ? path.join(process.cwd(), fichier) : undefined;
  const calque = Buffer.from(ogSvg(!!chemin && fs.existsSync(chemin)));
  const base = chemin && fs.existsSync(chemin)
    ? sharp(chemin).resize(1200, 630, { fit: "cover" })
    : sharp({ create: { width: 1200, height: 630, channels: 3, background: "#000" } });
  const png = await base.composite([{ input: calque }]).jpeg({ quality: 82 }).toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/jpeg" } });
};
