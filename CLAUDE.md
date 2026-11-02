# Liverdian — règles du dépôt

Hub multi-agents local pour créer, vendre et maintenir des sites web. Cadrage : `docs/VISION.md` (à lire).
Le propriétaire (Bat) est francophone et non développeur : interface, messages, docs et commentaires en français.

## Structure
- `apps/hub` — serveur Node 26 (TypeScript exécuté nativement, sans build), Fastify, SQLite via `node:sqlite`.
- `apps/web` — interface React + Vite + TypeScript, servie par le hub depuis `apps/web/dist`.
- `packages/site-kit` — kit Astro + Tailwind des sites clients (sections, thèmes, générateur). Hors workspaces npm.
- `skills/` — skills des agents (SKILL.md), `skills/agents.json` dit quel agent hérite de quoi.
- `.data/` — base, sites générés, journaux (jamais commité).
- `docs/` — VISION, DECISIONS (ADR), briefs.

## Règles
- Aucun commit, push, ni modification hors de ce dépôt. Pas de `git` autre que status/diff/log.
- Aucun secret dans le code ni dans les journaux : clés lues depuis l'environnement ou `.data/settings`.
- Les agents LLM passent par le CLI `claude` (abonnement Max) ; ne jamais exiger `ANTHROPIC_API_KEY`.
- L'enchaînement des étapes est du code déterministe ; les agents font le travail créatif. Un contrôle raté bloque.
- Les montants, numéros de facture, dates légales : code pur, jamais un LLM.
- Tests : Vitest. `npm run typecheck`, `npm test` et `npm run build` doivent passer avant de rendre la main.
- Référence de code éprouvée (lecture seule) : `C:\Games\Ambition` (hub Nidavellir, même pile). S'en inspirer, ne rien y écrire.
- Windows + git-bash : chemins `C:/...` pour les programmes natifs. Navigateur disponible : Microsoft Edge
  (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), pas de Chrome.
