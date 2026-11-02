# Liverdian

Hub local qui fait tourner une petite agence web : trouver des entreprises, fabriquer leurs sites avec une équipe
d'agents, les vendre et les maintenir. Le cadrage complet est dans [`docs/VISION.md`](docs/VISION.md), les choix
techniques dans [`docs/DECISIONS.md`](docs/DECISIONS.md).

Tout tourne sur votre PC : l'interface s'ouvre dans le navigateur, les données restent dans le dossier `.data`.

---

## Lancer Liverdian (Windows)

### Ce qu'il faut une seule fois

1. **Node.js 26 ou plus récent** — vérifiez dans un terminal :
   ```
   node --version
   ```
   Si la commande est inconnue ou affiche un numéro inférieur à 26, installez Node depuis https://nodejs.org (version « Current »).
2. **Claude Code**, connecté à votre abonnement Max — vérifiez :
   ```
   claude --version
   ```
   Les agents passent par lui. Aucune clé d'API n'est nécessaire (et si une variable `ANTHROPIC_API_KEY` existe sur le PC,
   Liverdian la retire avant chaque appel pour ne jamais facturer l'API).

### Première installation

Ouvrez **PowerShell** (touche Windows, tapez « PowerShell », Entrée), puis copiez-collez :

```
cd C:\Games\LiverdianWeb
npm install
```

### Démarrer

```
cd C:\Games\LiverdianWeb
npm start
```

Quand le terminal affiche `Liverdian est prêt : http://127.0.0.1:4320`, ouvrez cette adresse dans Edge.
Pour arrêter : revenez dans le terminal et faites **Ctrl+C**.

> Le terminal doit rester ouvert tant que vous utilisez Liverdian. Les travaux en cours au moment de l'arrêt
> reprennent tout seuls au démarrage suivant.

### Fabriquer une maquette

1. **Une seule fois** : installez le kit des sites (Astro, Lighthouse…) :
   ```
   cd C:\Games\LiverdianWeb\packages\site-kit
   npm install
   ```
2. Dans **Entreprises**, ouvrez une fiche et cliquez **Créer la maquette**. Le bouton est grisé, avec l'explication, tant
   qu'il manque le nom, le métier (ou le code NAF), l'adresse complète avec la commune, ou le téléphone.
3. L'écran du site s'ouvre : la frise montre chaque étape, l'agent qui y travaille et sa durée, en direct. Comptez de
   10 à 40 minutes selon le nombre de tours de correction.
4. Quand tous les contrôles passent, la maquette arrive dans **Aujourd'hui › À valider** avec son aperçu (mobile et
   ordinateur côte à côte, plein écran, ou dans un onglet). Trois choix :
   - **Valider** : la démo est prête (sa mise en ligne arrivera avec le module Commercial) ;
   - **Demander des modifications** : votre texte est transmis mot pour mot à l'Intégrateur, puis tout est recontrôlé ;
   - **Refaire** : un nouveau design, depuis la direction artistique.

Si les contrôles échouent encore après 3 tours de correction automatique, la fabrication s'arrête « à revoir » avec le
motif exact : jamais une maquette ratée présentée comme bonne. L'aperçu des sites est servi sur
`http://<site>.localhost:4321` (port du hub + 1).

### Raccourcis utiles dans l'interface

- **Ctrl+K** : aller à une page, retrouver une entreprise, créer une fiche.
- **Échap** : fermer un panneau.
- Thème clair/sombre : en bas de la barre latérale ou dans **Réglages**, où se trouve aussi **Réduire les animations**.

---

## Réglages facultatifs

| Variable | Rôle | Défaut |
|---|---|---|
| `LIVERDIAN_PORT` | port de l'interface | `4320` |
| `LIVERDIAN_PREVIEW_PORT` | port de l'aperçu des sites (`<site>.localhost`) | port de l'interface + 1 |
| `LIVERDIAN_DATA_DIR` | dossier des données (base, sites, journaux) | `.data` du dépôt |
| `LIVERDIAN_CLAUDE_BIN` | chemin du programme `claude` s'il n'est pas sur le PATH | `claude` |
| `DEEPSEEK_API_KEY` | clé DeepSeek (servira à la prospection, facultative) | aucune |

Exemple dans PowerShell, pour un essai sur un autre port et un dossier séparé :

```
$env:LIVERDIAN_PORT = "4399"; $env:LIVERDIAN_DATA_DIR = "C:\Temp\liverdian-essai"; npm start
```

La clé DeepSeek peut aussi être rangée dans `.data\settings\secrets.json` :

```json
{ "DEEPSEEK_API_KEY": "votre-clé" }
```

Ce fichier n'est jamais commité (tout `.data` est ignoré par Git) et la clé n'apparaît dans aucun journal.

---

## Pour le développement

| Commande | Effet |
|---|---|
| `npm run dev` | hub relancé à chaque modification + interface Vite sur http://127.0.0.1:5173 |
| `npm run typecheck` | vérification des types (hub et interface) |
| `npm test` | tests Vitest (aucun appel réel à Claude) |
| `npm run build` | construit l'interface dans `apps/web/dist` |
| `npm run essai:claude` | **vrai** appel court à Claude (haiku) via la couche agents ; `-- --vision <dossier>` pour la vision |
| `npm run captures -- --seed` | captures de l'interface avec Edge dans `.data/captures` (hub lancé ; `--seed` ajoute des fiches de démonstration, `--site <id>` l'écran d'un site et son aperçu) |

Organisation :

- `apps/hub` — serveur Node 26 (TypeScript exécuté directement), Fastify, SQLite (`node:sqlite`).
  - `src/db` base et migrations · `src/domain` entreprises, sites, journal, réglages · `src/jobs` file de travaux
  - `src/agents` appel du CLI claude, DeepSeek, registre des agents, skills · `src/server` API HTTP, flux temps réel, aperçu des sites
  - `src/atelier` machine à états des maquettes (`moteur.ts`), recettes (`recettes/`), brief, tables NAF et communes,
    assemblage, accès au kit. Une recette = un type de site (ADR-09 à 11).
- `apps/web` — interface React + Vite, servie par le hub.
- `packages/site-kit` — kit Astro + Tailwind des sites clients (hors workspaces npm).
- `skills/` — skills des agents ; `skills/agents.json` dit quel agent hérite de quoi.
