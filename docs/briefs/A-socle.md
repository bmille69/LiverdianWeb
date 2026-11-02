# Brief A — Socle du hub (`apps/hub`, `apps/web`, racine)

Lis d'abord `CLAUDE.md` et `docs/VISION.md` en entier. Référence éprouvée en lecture seule : `C:\Games\Ambition`
(hub Nidavellir : même pile). Regarde notamment `apps/hub/src/llm/claude-cli.ts` (appel du CLI claude, isolement des
appels, sortie structurée, coût), `apps/hub/src/db/database.ts` (migrations), `apps/hub/src/server/http.ts`,
`apps/web/src` (style de l'interface). Reprends les idées et le code utile, adapté et simplifié ; rien de spécifique au jeu vidéo.

Une autre session construit en parallèle `packages/site-kit/` : **n'y touche pas**, ni à `skills/` sauf lecture.

## À livrer

### 1. Dépôt
`package.json` racine (workspaces `apps/*` seulement — le site-kit reste hors workspaces), scripts `start`
(build web puis lance le hub), `dev`, `build`, `test`, `typecheck`. Node ≥ 26, TypeScript natif côté hub comme Ambition.
Vitest. Le hub écoute sur `127.0.0.1:4320` (variable `LIVERDIAN_PORT`), données dans `.data/` (`LIVERDIAN_DATA_DIR`).
Pour l'instant pas d'authentification : écoute locale uniquement (noter un ADR, l'accès téléphone viendra plus tard).

### 2. Base SQLite (`node:sqlite`, migrations en liste append-only comme Ambition)
- `companies` : la fiche entreprise unique (prospect puis client) — identité (raison sociale, nom commercial, SIREN, NAF,
  métier, date de création, dirigeant), contact (téléphone, email, site actuel), adresse, horaires, note Google
  {valeur, nombre, url}, zone (commune + voisines), statut commercial (`prospect`, `qualifie`, `maquette`, `contacte`,
  `client`, `perdu`, `exclu`), score, notes, **sources** (pour chaque champ : d'où il vient — `saisie`, `sirene`,
  `places`, `audit`), dates.
- `sites` : un site par entreprise ou plus (type de recette, statut `brouillon|en_fabrication|a_valider|demo_en_ligne|livre|archive`,
  dossier sur disque, dernière note qualité, URL démo/prod).
- `jobs` : file de travaux persistante (type, sujet, état `queued|running|done|failed|cancelled`, tentatives, entrée/sortie JSON,
  erreur, dates). Reprise au redémarrage (un `running` orphelin repasse `queued`), plafond de parallélisme global configurable.
- `agent_calls` : chaque appel LLM (agent, modèle, fournisseur, durée, coût indicatif, job lié, résumé).
- `events` : journal d'activité (type, sujet, message lisible en français, données) pour le fil d'activité de l'interface.
- `settings` : clés/valeurs.

### 3. Couche agents (`apps/hub/src/agents/`)
- **Claude CLI** (`claude` sur le PATH, abonnement : appeler avec `ANTHROPIC_API_KEY` retiré de l'environnement de l'enfant) :
  - mode `chat`/`structured` : sans outils, isolé (reprendre les drapeaux d'Ambition `buildChatArgs`), prompt système =
    rôle de l'agent + contenu des skills hérités, sortie JSON validée par schéma si demandé ;
  - mode `vision` : idem mais avec le droit de lire (Read seulement) un dossier d'images, pour relire des captures ;
  - mode `atelier` (agentique) : travaille dans un dossier donné (un site), outils Read/Edit/Write/Glob/Grep + Bash
    limité à `npm run build`/`node`/`npx astro` (liste fermée, `--permission-mode` adapté, jamais de bypass), et les skills de
    l'agent **copiés dans `<dossier>/.claude/skills/`** pour que Claude Code les charge nativement. Flux JSON lu en continu
    (`--output-format stream-json`) pour afficher la progression, délai maximum, annulation propre (arbre de processus tué).
  - modèle par agent configurable (défaut `opus` pour DA/Intégrateur/Relecteur, `sonnet` pour Rédacteur/QA texte) et file
    d'attente avec plafond de concurrence (le CLI coûte du quota d'abonnement).
- **DeepSeek** (API compatible OpenAI, `https://api.deepseek.com`, clé `DEEPSEEK_API_KEY`) : client `structured` simple,
  optionnel (le hub démarre sans clé). Servira à la prospection plus tard.
- **Registre des agents** (`agents/registry.ts`) : id, nom affiché, rôle (texte du prompt), modèle, fournisseur, couleur/icône,
  skills lus depuis `skills/agents.json` (+ `shared`). Agents : directeur, directeur-artistique, redacteur, integrateur,
  controleur-qa, relecteur-ux (rôles en français, sérieux et précis, inspirés de `docs/VISION.md` §3).
- **Skills** : chargeur qui lit `skills/**/SKILL.md` (frontmatter name/description), fournit le contenu pour un agent,
  et la copie dans `.claude/skills` d'un dossier de travail.

### 4. API HTTP (Fastify, zod)
CRUD entreprises (avec sources par champ), sites, jobs (liste, détail, annuler, relancer), agents (liste + skills),
skills (liste, contenu), événements, réglages ; flux temps réel SSE (`/api/stream`) pour événements et progression des jobs.
Erreurs en français. Le hub sert `apps/web/dist` (SPA, fallback index.html pour les routes non-API) et sert en statique
les captures/fichiers d'aperçu d'un site (`/files/sites/<id>/...`, chemin contrôlé contre la traversée).

### 5. Interface (`apps/web`, React + Vite + TS)
Style pro type Linear/Raycast : sombre par défaut (clair disponible), dense mais aérée, typographie soignée (Inter
variable auto-hébergée), animations douces (transitions de page, apparitions, survols), **interrupteur « Réduire les
animations »** (et respect de `prefers-reduced-motion`). Palette d'accent propre à Liverdian (pas le violet générique).
- Barre latérale : Aujourd'hui · Entreprises · Atelier · Sites · Prospection · Commercial · Finance · Équipe · Réglages.
  Prospection / Commercial / Finance : pages « bientôt » propres qui décrivent ce qui arrivera (texte de `VISION.md`).
- **Aujourd'hui** : à valider, travaux en cours (progression en direct), fil d'activité.
- **Entreprises** : tableau filtrable, création/édition d'une fiche (formulaire clair, groupé, champ « source » discret
  par donnée), détail en panneau latéral.
- **Atelier** et **Sites** : listes simples branchées sur l'API (la chaîne de fabrication arrive au brief suivant ;
  prévoir l'emplacement d'un écran « site » : étapes, aperçu, contrôles).
- **Équipe** : cartes des agents (rôle, modèle, skills hérités — clic pour lire un skill rendu en markdown), coûts récents.
- Palette de commandes Ctrl+K (navigation + « Nouvelle entreprise »). Toasts. États vides soignés. Tout en français.

### 6. Qualité
Tests Vitest : migrations, file de travaux (reprise, plafond, annulation), construction des arguments du CLI (aucun drapeau
dangereux, skills copiés, clé API retirée de l'env), chargeur de skills, routes principales. `npm run typecheck`,
`npm test`, `npm run build` passent. Lance réellement le hub sur un dossier de données temporaire, vérifie qu'il sert
l'interface et l'API, et fais **un vrai appel** `claude` court (modèle `haiku`, mode structured) via la couche agents
pour prouver le câblage — dans un script de test manuel, pas dans la suite. Prends des captures de l'interface avec
`playwright-core` (canal msedge) et regarde-les (outil Read) : corrige ce qui n'est pas au niveau.

### 7. Docs
`README.md` (lancer en copier-coller pour un non-développeur sous Windows), `docs/DECISIONS.md` (ADR-01.. : pile,
pas d'auth locale, file de travaux, couche agents et skills, etc.). Pas de commit. Rapport final en français.
