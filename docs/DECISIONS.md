# Décisions d'architecture (ADR)

Chaque décision : contexte, choix, conséquences. On n'efface pas une décision : on en écrit une nouvelle qui la remplace.

---

## ADR-01 — Pile : Node 26 + Fastify + SQLite, React + Vite (2 nov. 2026)

**Contexte.** Le hub Nidavellir (`C:\Games\Ambition`) a éprouvé une pile simple, sans étape de compilation côté serveur.

**Choix.**
- Hub : Node ≥ 26 qui exécute le TypeScript directement (types effaçables seulement : pas d'`enum`, pas de
  propriétés de paramètres), Fastify 5, zod 4 (messages d'erreur en français via `z.locales.fr()`), SQLite natif
  (`node:sqlite`, aucun module compilé).
- Interface : React 19 + Vite, police Inter variable auto-hébergée (`@fontsource-variable/inter`), icônes Lucide,
  routeur maison (historique du navigateur), aucune bibliothèque d'état.
- Dépôt : workspaces npm `apps/*` seulement ; `packages/site-kit` reste hors workspaces (dépendances propres aux sites).
- Tests : Vitest. `npm run typecheck`, `npm test` et `npm run build` doivent passer.

**Conséquences.** Démarrage immédiat (`node apps/hub/src/main.ts`), une seule base de fichiers, rien à installer en
dehors de Node et de Claude Code.

## ADR-02 — Écoute locale sans authentification (pour l'instant)

**Contexte.** Liverdian tourne sur le PC de Bat, seul utilisateur. L'accès depuis le téléphone viendra plus tard.

**Choix.** Le hub n'écoute que sur `127.0.0.1` (port `LIVERDIAN_PORT`, 4320 par défaut), sans session ni mot de passe.
Deux protections restent actives :
- l'en-tête `Host` doit être `127.0.0.1:<port>` ou `localhost:<port>` (protection contre le DNS rebinding) ;
- toute requête qui modifie quelque chose (POST, PATCH, PUT, DELETE) portant une origine étrangère est refusée :
  une page web ouverte dans le navigateur ne peut rien envoyer au hub.

**Conséquences.** Aucune donnée joignable depuis le réseau. L'accès téléphone exigera une vraie authentification
(appairage par code et session durable comme Nidavellir, ou réseau privé type Tailscale) : nouvelle ADR à ce moment-là.

## ADR-03 — Base SQLite et migrations en liste append-only

**Choix.** `apps/hub/src/db/database.ts` contient une liste de migrations SQL appliquées dans l'ordre, chacune dans
une transaction, la version courante dans `schema_version`. Une migration publiée ne se modifie jamais : on en ajoute
une à la fin. Une base plus récente que le hub est refusée au démarrage plutôt que corrompue.

Tables : `companies` (la fiche unique prospect → client), `sites`, `jobs`, `agent_calls`, `events`, `settings`.
Dans `companies`, ce qui se filtre ou se trie est en colonnes ; les données structurées (horaires, note Google,
zone, **sources par champ**) sont en JSON.

**Sources par champ.** Chaque donnée de la fiche garde sa provenance : `saisie`, `sirene`, `places` ou `audit`.
Une donnée renseignée sans source précisée devient `saisie` ; une donnée vidée perd sa source. C'est la base du
contrôle des faits (VISION §4) : un site ne publiera que des faits dont on sait d'où ils viennent.

## ADR-04 — File de travaux persistante

**Contexte.** Fabriquer un site, auditer, envoyer : des actions longues qui doivent survivre à un redémarrage.

**Choix.** `apps/hub/src/jobs/job-queue.ts` : chaque travail est une ligne de `jobs`
(`queued → running → done | failed | cancelled`), avec entrée et sortie JSON, tentatives, erreur et progression
(étape, pourcentage, dernières lignes de journal).
- **Reprise** : au démarrage, tout `running` orphelin repasse `queued` (le travail est rejoué depuis le début ;
  un exécutant doit donc être rejouable).
- **Plafond global** de parallélisme (`jobs.parallel`, 2 par défaut), relu à chaque passage : réglable à chaud.
- **Annulation** : un travail en file est annulé tout de suite ; un travail en cours reçoit un `AbortSignal`
  (le CLI claude est alors tué avec tout son arbre de processus).
- **Tentatives** : `maxAttempts` par travail (1 par défaut) ; « Relancer » remet un travail échoué en file à zéro.
- Chaque changement est publié sur un bus interne, relayé à l'interface par le flux SSE `/api/stream`.

**Conséquences.** L'enchaînement reste du code déterministe (CLAUDE.md) : une future recette de site sera une suite de
travaux, pas un agent orchestrateur.

## ADR-05 — Couche agents : le CLI `claude` en trois modes

**Contexte.** Les agents utilisent l'abonnement Max via Claude Code, jamais une clé d'API.

**Choix.** `apps/hub/src/agents/claude-cli.ts` lance le binaire officiel `claude -p` avec le flux `stream-json`, le prompt
sur l'entrée standard, et **retire `ANTHROPIC_API_KEY`** de l'environnement de l'enfant. Trois modes :

| Mode | Usage | Isolement |
|---|---|---|
| `chat` / structured | texte ou JSON validé (`--json-schema` puis revalidé par zod) | `--restricted --safe-mode --strict-mcp-config --tools ""`, dossier de travail vide, aucune session gardée |
| `vision` | relire des captures | idem + `--tools Read` et `--add-dir <dossier d'images>` ; `--restricted` confine la lecture à ce dossier. Le hub donne la liste exacte des images dans le prompt (l'agent ne peut pas lister). |
| `atelier` | travail agentique dans le dossier d'un site | voir ci-dessous |

**Atelier.** Dossier de travail = le site ; `--setting-sources project` ; `--permission-mode dontAsk` et
`--permission-prompts none` (tout ce qui n'est pas permis est refusé sans question) ; permissions :
`Read(./**)`, `Edit(./**)`, `Write(./**)`, Glob, Grep, Skill et Bash limité à `npm run build`, `npx astro build`,
`npx astro check`, `node scripts/*` ; interdits : écrire dans `./.claude/**`, lire `./.env*`. Aucune option de
contournement (`--dangerously-skip-permissions`, `bypassPermissions`, `acceptEdits`, `auto`) n'est jamais passée :
`assertSafeArgs` le vérifie à chaque appel. Avant chaque passage, le hub retire `.claude/settings*.json` du dossier.

Vérifié le 2 nov. 2026 avec Claude Code 2.1.311 : écriture hors du dossier, lecture de `C:/Windows/win.ini`, `touch`,
`curl` et écriture dans `.claude/` sont refusés ; les skills du dossier sont chargés. `--restricted` n'est **pas**
utilisable en atelier : il empêche le chargement des skills du projet. Les commandes en lecture seule que Claude Code
juge sûres (`ls`) restent permises.

Délai maximum (réglage `atelier.timeoutMinutes`, 3 min pour les appels courts), annulation, résultat gardé si un
processus fils retient Claude Code (fermeture de l'arbre après 15 s de grâce). Plafond de concurrence propre au CLI
(`agents.parallel`, 2 par défaut) car chaque appel consomme du quota d'abonnement. Chaque appel est journalisé dans
`agent_calls` (agent, modèle, mode, durée, coût indicatif, travail lié) ; un refus de permission en atelier crée un
événement.

## ADR-06 — Skills : un seul fichier source, deux usages

**Choix.** `skills/**/SKILL.md` (frontmatter `name`, `description`) et `skills/agents.json` (`shared` + skills par agent)
sont la seule source. Le chargeur (`agents/skills.ts`) :
- injecte le contenu des skills hérités dans le prompt système des appels sans outils (`<skill name="…">`) ;
- copie ces dossiers dans `<site>/.claude/skills/<nom>/` pour le mode atelier, où Claude Code les charge nativement
  (le dossier est vidé avant chaque copie : il ne contient que les skills voulus).

Les fichiers sont relus à chaque appel : une modification d'un skill vaut tout de suite. Un chemin déclaré mais
introuvable est signalé dans l'interface (Équipe) et vérifié par un test sur la vraie bibliothèque.

## ADR-07 — Registre des agents et modèles

**Choix.** `agents/registry.ts` décrit six agents (Directeur, Directeur artistique, Rédacteur, Intégrateur, Contrôleur QA,
Relecteur UX) : rôle en français (le cœur du prompt système), modes, couleur, icône, modèle par défaut — `opus` pour
le Directeur artistique, l'Intégrateur et le Relecteur UX ; `sonnet` pour le Directeur, le Rédacteur et le Contrôleur QA.
Le modèle se change agent par agent dans l'interface (réglage `agents.models`), sans redémarrer.

**DeepSeek** (`agents/deepseek.ts`) : client compatible OpenAI, mode JSON, coût indicatif calculé sur l'usage rendu.
Facultatif : le hub démarre sans `DEEPSEEK_API_KEY`. Il servira aux tâches de volume de la prospection ; aucun texte
client final n'en sort seul (VISION §3).

## ADR-08 — Interface : sobre, dense, animée avec retenue

**Choix.** Style Linear/Raycast : sombre par défaut, clair disponible, accent « lierre » (vert jade `#3ddc97`) et
second ton ambre, typographie Inter. Animations courtes (≤ 320 ms) toutes pilotées par des variables CSS ;
« Réduire les animations » les annule et suit par défaut `prefers-reduced-motion`. Panneaux latéraux et palette
rendus dans un portail (la transition de page crée un bloc conteneur qui fausserait `position: fixed`).
Données en direct par SSE : les listes se rechargent quand un événement de leur sujet arrive.

Le hub sert `apps/web/dist` en résolvant les fichiers à chaque requête : une interface reconstruite est servie sans
redémarrer. Une route de page reçoit `index.html` ; un fichier manquant reçoit un vrai 404.

**Fichiers d'un site** : `/files/sites/<id>/…` sert les captures et l'aperçu, seulement sous le dossier du site
(`..`, chemins absolus, lecteurs `C:`, liens symboliques sortants, `.claude` et `.env` refusés).
