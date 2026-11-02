# Brief F — Mise en ligne des maquettes (phase 3) + moteur des agents de secours

Lis `CLAUDE.md`, `docs/VISION.md` (§2.3 et feuille de route), `docs/DECISIONS.md`, `README.md`, puis le code
`apps/hub/src/**` (surtout `agents/`, `atelier/`, `domain/settings.ts`, `server/http.ts`, `prospection/index.ts` pour la
gestion des secrets), `apps/web/src/**` (écran du site, Réglages, Sites), `packages/site-kit/README.md`.
Tu es seul sur le dépôt. **Aucune régression** : les 99 tests restent verts, le comportement actuel est inchangé
tant que rien n'est configuré.

Le propriétaire a son hub ouvert sur `.data` (ports 4320/4321) : n'y touche pas, n'arrête aucun processus. Tes essais :
copie `.data/liverdian.db` et `.data/sites` dans un dossier temporaire, hub sur `LIVERDIAN_PORT=4350` et aperçu 4351.

## Partie 1 — Hébergement des démos (le cœur)
Chaque maquette validée doit pouvoir être mise en ligne en un clic à une adresse du type
`https://lumen-elec.demo.<domaine>` à envoyer au prospect, puis être supprimée automatiquement à la date affichée dans
son bandeau (J+30).

**Architecture imposée (choisie pour passer à l'échelle)** : Cloudflare Pages est limité à 100 projets par compte, une
démo par projet ne tient donc pas. On utilise **un seul Worker « liverdian-demos » avec Static Assets** :
- tous les `dist` des démos publiées sont rangés dans un dossier d'assemblage `.data/hebergement/demos/<slug>/...` ;
- le Worker lit l'en-tête `Host`, en tire `<slug>` (`<slug>.demo.<domaine>`) et sert `/<slug>/<chemin>` depuis ses
  assets (avec `index.html` pour les dossiers, 404 propre en français sinon, page « Cette maquette a expiré » pour un slug
  supprimé) ; en-têtes `X-Robots-Tag: noindex, nofollow`, cache raisonnable, sécurité (`X-Content-Type-Options`, `Referrer-Policy`) ;
- route Worker `*.demo.<domaine>/*` + enregistrement DNS générique proxifié `*.demo` (créés par le hub via l'API Cloudflare
  s'ils n'existent pas — idempotent) ;
- déploiement par `wrangler deploy` (dépendance `wrangler` du hub, pas une installation globale), jeton passé par
  l'environnement de l'enfant uniquement. Wrangler n'envoie que les fichiers modifiés : vérifie-le et note-le dans l'ADR.
  Respecte les limites (nombre de fichiers par version, taille par fichier) : le hub refuse avec un message clair avant de dépasser.
- **suivi des visites** : le Worker compte les visites par slug (Workers KV ou Analytics Engine, offre gratuite — choisis
  et justifie), sans cookie ni donnée personnelle (pas d'IP stockée), en ignorant les robots connus et les visites du
  propriétaire (paramètre `?apercu=<jeton>` qui pose un marqueur local). Le hub relève ces compteurs périodiquement et
  sur demande : « Ouverte 3 fois, dernière visite hier 18 h 42 » sur la fiche et l'écran du site, événement dans le fil
  d'activité à la première ouverture. C'est la donnée commerciale la plus précieuse de la phase 4.
- Le code du Worker vit dans `apps/hub/hebergement/worker/` avec ses tests (Vitest, `Request` simulées).

**Dans le hub** (`apps/hub/src/hebergement/`) :
- `Publier` (bouton sur l'écran d'un site au statut validé) : vérifie que le dernier contrôle est vert et que le mode
  démo est actif (bandeau + noindex), copie le `dist`, déploie, vérifie en vrai que l'URL répond 200 avec le bandeau, puis
  statut `demo_en_ligne` + URL. Job de la file existante, idempotent, reprise après redémarrage.
- `Retirer` (manuel) et **expiration automatique** : un job planifié quotidien retire les démos arrivées à échéance (et
  propose de prolonger de 30 jours depuis l'écran du site — la date du bandeau est alors regénérée et republiée).
- Slug : depuis le nom commercial, unique, stable une fois publié, sans accent.
- Réglages › Hébergement : domaine (`demo.<domaine>` déduit), identifiant de compte et jeton Cloudflare (secrets dans
  `.data/settings/secrets.json` comme Places : jamais renvoyés, jamais journalisés), bouton « Tester la connexion »
  (vérifie le jeton, ses droits, la zone, et dit précisément ce qui manque). Liste les droits exacts du jeton à créer.
- Écran Sites : colonne « en ligne » avec lien et visites ; écran du site : bloc « Démo en ligne » (URL copiable, QR code
  pour l'ouvrir sur téléphone, visites, date de suppression, Prolonger, Retirer).
- Rien n'est publié tant que l'hébergement n'est pas configuré : le bouton explique quoi faire.

**Vérification** : le propriétaire n'a pas encore de domaine ni de compte Cloudflare. Teste donc avec
(1) les tests du Worker, (2) un faux serveur d'API Cloudflare + un faux `wrangler` (binaire configurable) pour le
parcours complet publier → visites → expirer, (3) `wrangler dev` en local (sans compte) servant réellement le Worker
avec deux démos d'essai, interrogé avec des `Host` différents (curl `-H Host:`), et des captures Edge de la page servie
et de la page « expirée ». Écris le script `scripts/test-hebergement-reel.mjs` que le propriétaire (ou Hermes) lancera une
fois le compte prêt : publie Lumen Élec, vérifie l'URL, lit les visites, retire. Ne le lance pas.

## Partie 2 — Moteur des agents de secours
Le quota de l'abonnement Claude Max peut s'épuiser : la fabrication s'arrête alors. Ajoute un moteur de secours :
- Réglages › Agents : « Moteur » = `Abonnement Claude` (défaut) / `DeepSeek` / `Automatique` (abonnement, puis DeepSeek
  quand l'abonnement répond « limite atteinte » — détecte ce cas précisément dans la sortie du CLI, avec un test).
- DeepSeek passe par **le même CLI `claude`** avec ces variables dans l'environnement de l'enfant uniquement :
  `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`, `ANTHROPIC_AUTH_TOKEN=<clé DeepSeek des secrets>`,
  `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` = `deepseek-v4-pro`,
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` = `CLAUDE_CODE_SUBAGENT_MODEL` = `deepseek-flash` (voir `scripts/claude-deepseek.sh`).
  Les modes chat/structured/atelier marchent ainsi sans autre code.
- **Vision** : vérifie réellement si DeepSeek par cette voie accepte les images (le DA regarde les photos, le QA et le
  Relecteur regardent les captures). Si non, les étapes qui ont besoin de voir restent sur l'abonnement et attendent sa
  remise à zéro (statut « en attente du quota Claude », reprise automatique), et l'écran le dit clairement. Ne remplace
  jamais une revue visuelle par une revue « à l'aveugle » qui laisserait passer une maquette.
- Chaque appel enregistre le moteur réellement utilisé (`agent_calls`), visible sur la page Équipe. Le coût DeepSeek
  affiché est estimé avec les tarifs DeepSeek (pas ceux de Claude que le CLI calcule à tort pour un modèle inconnu).
- Vérification réelle : un appel structured court via DeepSeek par le hub, et le test de vision.

## Fin
`npm run typecheck`, `npm test`, `npm run build` verts. ADR dans `docs/DECISIONS.md` (hébergement multi-démos, suivi des
visites, moteur de secours). README : section « Mettre les démos en ligne » avec la configuration Cloudflare pas à pas pour
un non-développeur (où cliquer, droits exacts du jeton), et « Moteur des agents ». Pas de commit.
Rapport final en français : ce qui est livré, ce qui a été vérifié pour de vrai, ce qui reste à tester avec le vrai compte.
