// Configuration Astro du kit Liverdian. Rien de propre au client ici : tout vient de src/data/site.json.
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import liverdian from "./src/integration.ts";

export default defineConfig({
  integrations: [liverdian()],
  // Caches propres à chaque site : node_modules est partagé (jonction) entre tous les sites générés.
  cacheDir: "./.astro-cache",
  vite: { plugins: [tailwindcss()], cacheDir: "./.astro-cache/vite" },
  // CSS en ligne dans le HTML : aucune requête bloquante pour le rendu.
  build: { inlineStylesheets: "always", format: "directory" },
  devToolbar: { enabled: false },
});
