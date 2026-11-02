import type { APIRoute } from "astro";
import sharp from "sharp";
import { faviconSvg } from "../lib/icones-site.ts";

export const GET: APIRoute = async () => {
  const png = await sharp(Buffer.from(faviconSvg())).resize(180, 180).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
