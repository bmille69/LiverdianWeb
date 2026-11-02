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

### Raccourcis utiles dans l'interface

- **Ctrl+K** : aller à une page, retrouver une entreprise, créer une fiche.
- **Échap** : fermer un panneau.
- Thème clair/sombre : en bas de la barre latérale ou dans **Réglages**, où se trouve aussi **Réduire les animations**.

---

## Réglages facultatifs

| Variable | Rôle | Défaut |
|---|---|---|
| `LIVERDIAN_PORT` | port de l'interface | `4320` |
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
| `npm run captures -- --seed` | captures de l'interface avec Edge dans `.data/captures` (hub lancé ; `--seed` ajoute des fiches de démonstration) |

Organisation :

- `apps/hub` — serveur Node 26 (TypeScript exécuté directement), Fastify, SQLite (`node:sqlite`).
  - `src/db` base et migrations · `src/domain` entreprises, sites, journal, réglages · `src/jobs` file de travaux
  - `src/agents` appel du CLI claude, DeepSeek, registre des agents, skills · `src/server` API HTTP et flux temps réel
- `apps/web` — interface React + Vite, servie par le hub.
- `packages/site-kit` — kit Astro + Tailwind des sites clients (hors workspaces npm).
- `skills/` — skills des agents ; `skills/agents.json` dit quel agent hérite de quoi.
