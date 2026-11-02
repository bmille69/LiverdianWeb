import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hub = `http://127.0.0.1:${process.env.LIVERDIAN_PORT ?? 4320}`;

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    // Le hub vérifie l'en-tête Host : changeOrigin le réécrit vers 127.0.0.1:4320.
    proxy: { "/api": { target: hub, changeOrigin: true }, "/files": { target: hub, changeOrigin: true } },
  },
});
