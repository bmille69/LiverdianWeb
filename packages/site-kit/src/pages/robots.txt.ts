// robots.txt : tout est bloqué sur une démo, ouvert (avec sitemap) sur un site livré.
import type { APIRoute } from "astro";
import { site, demo } from "../lib/site.ts";

export const GET: APIRoute = () => {
  const lignes = demo
    ? ["User-agent: *", "Disallow: /"]
    : ["User-agent: *", "Allow: /", ...(site.seo.url ? [`Sitemap: ${site.seo.url}/sitemap-index.xml`] : [])];
  return new Response(lignes.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
