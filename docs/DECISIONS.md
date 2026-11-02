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

## ADR-09 — Atelier : une machine à états déterministe, une étape = un travail (2 nov. 2026)

**Contexte.** Une maquette passe par une dizaine d'étapes (brief, direction artistique, textes, assemblage, contrôles,
relectures, corrections). Un agent « orchestrateur » résumerait et oublierait ; un plantage au milieu ne doit rien perdre.

**Choix.** `apps/hub/src/atelier/moteur.ts` (classe `Atelier`) :
- Une fabrication (table `fabrications`, migration 2) garde l'étape en cours, son travail, le tour de correction,
  l'historique de chaque passage d'étape (`passes` : état, durée, résumé, sortie), les résultats des contrôles du passage
  en cours (`cycle`), les tours de correction (`tours`), les renvois et les exigences du propriétaire.
- Chaque étape est un travail `atelier.etape` de la file existante (ADR-04). L'exécutant relit l'état en base, lance
  l'étape de la recette, rend une **issue** (`suite`, `sautee`, `controle`, `renvoi`, `arret`). La fin du travail, publiée
  sur le bus, fait avancer la fabrication ; c'est le code qui décide de la suite, jamais un agent.
- **Fichiers exacts** : chaque étape lit et écrit des fichiers du dossier du site (`brief.json`, `design.json`,
  `content.json`, `site.json`, `src/data/site.json`, `.check/`, `.atelier/`). Les agents sans outils reçoivent le contenu
  exact de ces fichiers avec leur chemin (`<fichier chemin="…">`), l'Intégrateur les lit lui-même. Aucun résumé.
- **Rejouable** : une étape repart de ses fichiers d'entrée. Au redémarrage, la file remet en file le travail interrompu
  et `reprendreApresDemarrage` rattrape une fin de travail non traitée.
- Statuts de site ajoutés : `a_revoir` (arrêt) et `demo_prete` (validée ; la mise en ligne viendra en phase 3).
- Actions humaines : **Valider**, **Demander des modifications** (texte verbatim → tour de correction → toute la chaîne
  de contrôle ; l'exigence reste vérifiée par la revue visuelle et l'UX), **Refaire** (repart de la direction artistique,
  le design précédent sert de contre-exemple), **Reprendre** (après une erreur technique ou une annulation).

**Conséquences.** Une étape d'agent a 2 essais en cas d'erreur technique (CLI tombé, délai) ; au-delà, arrêt
« erreur technique » reprenable. Les tests (`atelier.test.ts`) simulent agents et kit : enchaînement, blocage, 3 tours puis
arrêt, reprise après redémarrage, modifications verbatim, refus de schéma renvoyé à l'agent.

## ADR-10 — Recettes : le type de site est une donnée du moteur, pas du code du moteur

**Choix.** Une recette (`atelier/recette.ts`) déclare sa séquence d'étapes, chaque étape (libellé, agent, groupe, essais,
fonction `run`), son étape de correction et son point de retour, son point de départ de « Refaire », ses seuils.
`recettes/index.ts` les inscrit ; le moteur et l'interface (frise, seuils affichés) les lisent sans rien savoir de leur
contenu. Première recette : `vitrine-artisan` (1 page).

`vitrine-artisan` : brief (code) → directeur artistique (structured + vision sur les photos candidates) → rédacteur
(structured) → assemblage (code, schéma du kit) → intégration sur mesure (Claude Code, seulement si le DA la demande) →
contrôles automatiques (`check-site`) → contrôle des faits → revue visuelle → relecture UX. Tables du hub qui alimentent
le brief : codes NAF du bâtiment → métier du kit et prestations plausibles (`naf.ts`), communes de la métropole de Lyon,
du Rhône et du nord de l'Isère avec coordonnées (`communes.ts`). La date de suppression de la démo (J+30) est calculée
par le code. Sans lien Google sur la fiche, le lien de la note est une recherche Google Maps (source dite dans le brief).

## ADR-11 — Boucle de correction : bloquante, 3 tours, consignes verbatim

**Choix.**
- Les contrôles d'un passage s'exécutent tous (sauf build cassé) pour rassembler toutes les consignes en un seul tour.
- Le **code** décide du verdict à partir des données, pas le verdict de l'agent : Lighthouse mobile ≥ 95 en performance,
  accessibilité, bonnes pratiques (médiane de 3 mesures) ; axe 0 violation grave ; aucun échec du script ; aucun fait
  `absente`/`contradictoire`/`prestation_douteuse` ; revue visuelle sans bloquant, moyenne ≥ 4 et aucun critère < 3 ;
  UX sans problème bloquant ni majeur.
- Un échec ouvre un tour : le hub écrit `.atelier/corrections/tour-N.md` avec les consignes exactes, groupées par origine,
  et le donne mot pour mot à l'Intégrateur, puis repasse toute la chaîne de contrôle. Après 3 tours automatiques encore
  en échec : arrêt « à revoir » avec le motif (contrôles encore en échec). Jamais « validé avec remarques ».
- **Refus de schéma** : l'assemblage (cohérence design/textes, icônes, puis schéma du kit et contrastes) attribue chaque
  erreur à l'agent fautif d'après son chemin et la lui renvoie avec le message exact, **une fois** par cause ; un second
  refus arrête. Le DA est aussi contrôlé dès sa sortie (photos candidates, variantes, contrastes, et **anti-gabarit du
  thème** : couple accent/sombre différent des sites du même métier, et au moins une police, la signature ou le hero différent).
- **Garde-fou contre la régression** : chaque version relue (`src/`, `public/`) est gardée dans `.atelier/versions/vN`
  avec sa note (moyenne visuelle moins une demi-note par défaut bloquant, problème UX grave ou fait faux). Si un tour fait
  baisser la note, le code remet la meilleure version et redonne à l'Intégrateur les consignes de sa propre relecture,
  avec la relecture de la tentative ratée comme contre-exemple. Constaté en vraie fabrication : sans ce garde-fou, trois
  tours successifs ont fait passer la note de 3,83 à 3,5 puis 3 (l'Intégrateur applique les consignes sans voir le rendu).
- Ne partent en correction que les problèmes UX bloquants et majeurs (les mineurs diluaient les tours) ; la revue visuelle
  transmet ses bloquants puis ses corrections.
- La consigne de l'Intégrateur dit exactement les commandes permises : en vraie fabrication, un `cd … && ls` refusé lui avait
  fait croire que tout le shell était interdit, et il n'avait pas lancé `npm run build`.
- Revue visuelle et UX lisent les captures **découpées** en tranches d'écran (`decouper-captures.mjs` du kit : une page de
  1440 × 6 600 px réduite d'un bloc est illisible) et une capture de référence du kit qui fixe le niveau attendu.

## ADR-12 — Aperçu des sites sur un sous-domaine local ; permissions de l'atelier resserrées

**Aperçu.** Un serveur d'aperçu séparé (`LIVERDIAN_PREVIEW_PORT`, port du hub + 1) sert le `dist/` de chaque site à la
racine de `http://<id>.localhost:<port>/` : les chemins absolus d'Astro (`/_astro/…`) marchent sans réécriture, et la page
du site n'a pas l'origine de l'interface (elle ne peut pas appeler l'API). Lecture seule, Host vérifié, `dist/` seulement.

**Permissions de l'atelier.** `node scripts/*` est retiré des commandes permises : avec `Write(./**)`, il permettait
d'écrire puis d'exécuter n'importe quel script. Restent `npm run build`, `npx astro build`, `npx astro check` ; le hub lance
lui-même `check-site`. Interdits en écriture : `.claude/`, `package.json`, `astro.config.mjs`, `node_modules/`, et les
entrées/preuves de la fabrication (`brief.json`, `design.json`, `content.json`, `.atelier/`, `.check/`). Limite connue :
un build Astro exécute le code des composants du site, que l'Intégrateur peut modifier ; l'isolement complet demanderait un
bac à sable système (à décider avant d'ouvrir l'atelier à des demandes extérieures).

## ADR-13 — Prospection : sources légales, campagnes reprenables, score expliqué (2 nov. 2026)

**Contexte.** Phase 2 (VISION §2.1, plan d'origine) : sourcer des artisans, auditer leur présence en ligne, les noter avec
une grille réglable, et lancer leur maquette en un clic, sans scraping et dans les règles du RGPD.

**Sources (`apps/hub/src/prospection/sources/`).**
- **API Recherche d'entreprises** (gratuite, sans clé) : `near_point` (commune + rayon ≤ 50 km), `code_commune` ou
  `departement`, filtrée par codes NAF et `etat_administratif=A`. Intervalle de 220 ms (limite publiée : 7 req/s), reprise
  sur 429/5xx avec `Retry-After`. Écartés d'office : diffusion partielle (Sirene), **opposition à la prospection déclarée
  au registre** (`opposition_diffusion_commerciale`), liste d'opposition. On ne garde qu'un dirigeant (prénom et nom).
- **geo.api.gouv.fr** pour le centre et le nom exact des communes (repli sur la table locale de l'atelier).
- **OpenStreetMap / Overpass** : une requête par campagne sur la zone (étiquettes `craft=*` des métiers), trois serveurs
  publics essayés ; s'ils sont saturés, l'étape est sautée et le motif affiché.
- **Google Places (New)** `places:searchText`, masque de champs minimal. Clé `GOOGLE_PLACES_API_KEY` (environnement ou
  `.data/settings/secrets.json`, saisissable dans Réglages, jamais renvoyée ni journalisée). Absente : étape sautée.
  Chaque appel réel est compté (`api_appels`, coût estimé 0,035 $) ; plafond mensuel réglable (900 par défaut, sous le
  quota gratuit de 1 000) que le hub refuse de dépasser.
- **Cache** (`api_cache`) : Sirene et OSM 7 jours, Places et communes 30 jours. La clé de cache ne contient jamais de clé
  d'API. Une même requête n'est jamais repayée dans sa durée de validité.

**Appariement Sirene ↔ Places/OSM** (`appariement.ts`) : nom (mots distinctifs, hors formes juridiques et mots du métier ;
du dirigeant, le seul nom de famille) et lieu (distance, code postal, numéro, voie). Score stocké avec son détail.
≥ 0,75 fusionné ; 0,5–0,75 **douteux** : signalé, jamais fusionné sans accord (« Oui, reprendre » / « Non ») ; un
appariement fusionné peut être contesté. Calibré sur la vraie campagne : « Électricité Générale » (une marque) ou un
prénom commun ne rapprochent plus deux entreprises.

**Fusion dans `companies`** : clé SIREN (pas de doublon), statut `prospect`/`qualifie`, source par champ (`osm` ajoutée).
Priorité : une **saisie** n'est jamais écrasée ; sinon une source de rang égal ou supérieur remplace (Places > OSM pour
le téléphone et le site ; l'audit n'écrit que l'email). Téléphones normalisés au format français. Les fusions en lot
sont silencieuses (option `silencieux` de `CompanyService`) : un résumé par campagne dans le journal.

**Audit** (`audit.ts`, skill `audit-site-existant`) : le code relève redirections, HTTPS et certificat, viewport,
copyright, technologie et indices d'âge, emails (accueil + une page contact au plus), `robots.txt` respecté,
user-agent identifiable ; Lighthouse mobile (performance + accessibilité, une mesure) dans un processus séparé avec Edge,
via le Lighthouse déjà installé dans le kit (lu, jamais modifié). Le flou (franchise ? vrai site ? quel email ?) va à
l'agent **Éclaireur** (nouveau, `skills/agents.json` + registre) : DeepSeek si sa clé existe, sinon Claude haiku en
structured (option `provider` d'`AgentService.ask`). L'email retenu doit figurer tel quel dans les pages visitées.
Aucune page n'est gardée, seulement les relevés et leurs preuves (constat + URL).

**Score** (`scoring.ts`) : grille du plan par défaut (réglage `prospection.grille`, éditable), code pur, chaque ligne
expliquée. Une règle qui repose sur une donnée inconnue est marquée « à vérifier » (« aucun site » sans Places, copyright
déduit d'une technologie, avis sans Places). **Une entreprise qui n'atteint le seuil que grâce à des points à vérifier
reste « Prospect » (compteur « à vérifier »), pas « Qualifiée »** : sans cette règle, la vraie campagne sans Places
qualifiait 278 entreprises sur 300 sur la seule absence de site dans OSM.

**Campagnes** (`campagnes.ts`) : critères enregistrés (zod) ; un travail `prospection.campagne` de la file (ADR-04) ; phases
`sourcing → enrichissement → audit → score → nettoyage` notées sur la campagne, étape notée par entreprise
(`campagne_prospects`) : un redémarrage reprend à la phase et à l'entreprise près, sans relire Sirene. Fiches écartées par
les filtres (et sans saisie, site, ni autre campagne) supprimées à la fin (minimisation). Audit de moins de 30 jours sur la
même adresse réutilisé.

**Maquettes en lot** (`maquettes.ts`) : file visible, plafond `prospection.maquettes.parallele` (1 par défaut) compté sur
toutes les fabrications en cours ; chaque fin d'étape de l'atelier relance la file ; l'atelier reste juge des prérequis
(refus affiché avec son motif).

**RGPD** : liste d'opposition à vie en **empreintes SHA-256** (SIREN, téléphone, email), jamais en clair ; « Exclure ›
Opposition » supprime la fiche (sauf cliente ou avec site) et l'inscrit. Purge des prospects non convertis sans activité
depuis `prospection.purge.mois` (6) au démarrage puis toutes les 12 h (jamais une cliente, une fiche avec site, ni une
fiche saisie à la main). Registre de traitement généré par le code à partir de l'état réel (onglet RGPD).

**Vérifié en réel le 2 nov. 2026** (électriciens 43.21A + plombiers 43.22A, Bron + 10 km, sans clé Places) :
6 939 entreprises trouvées, 2 850 établissements actifs correspondants, 918 écartées pour opposition au registre,
55 établissements secondaires, 23 réseaux ou plus de 19 salariés ; 1 854 gardées ; OSM : 36 lieux, 18 rapprochés,
8 douteux ; 9 sites, 8 audités (dont 2 domaines morts, 1 page d'annuaire) ; 3 qualifiées, 1 741 à vérifier.
278 appels Sirene, 1 appel Overpass, 7 appels Claude haiku ; 4 min 40. Cinq fiches tirées au hasard conformes à Sirene.

**Conséquences.** Sans clé Google Places, la prospection trouve et vérifie les entreprises mais ne peut presque rien
qualifier : la clé est la prochaine étape utile. Overpass public est souvent saturé (constaté) : un serveur Overpass local
serait l'option si OSM devient important.

## ADR-14 — Chaque site est unique : kit diversifié, élément sur mesure, registre et contrôle d'unicité (brief D, 2 nov. 2026)

**Contexte.** Demande du propriétaire : « Il ne faut pas générer 2 fois le même site pour les clients, il faut que chacun soit
unique. » Avec 3 variantes par section, 6 palettes fixes et 12 polices, deux électriciens voisins finissaient par se ressembler ;
l'ancien anti-gabarit (couple accent/sombre et un critère sur trois différents) laissait passer des sites de même allure.

**Choix.**
- **Kit diversifié** (sans baisser les exigences) : 5 variantes de hero (photo, typo, scindé, panorama, encart), 5 de services
  (cartes, liste, bandes, index, tuiles), 4 de preuve (colonnes, manifeste, étapes, encadré), 4 de réalisations (mosaïque, grille,
  bande défilante sans JS, diptyque), 4 de zone (carte, liste, tableau des distances, bandeau), 4 de devis (scindé, encadré, plein,
  appel) ; 3 en-têtes (simple, double, centré) et 3 pieds (complet, sobre, signature). Un composant par variante, trouvé par son nom
  (`<Famille><Variante>.astro`). Descriptions pour le DA dans `src/catalogue.ts` (un test vérifie qu'aucune variante n'y manque).
- **Mise en page indépendante du thème** (`theme.mise`, 8 axes) : échelle typographique, densité, traitement des photos (naturel,
  franc, passe-partout, duotone, contraste), cadre, boutons, rythme des fonds, casse des titres, style des surtitres. Les titres passent
  par des classes d'échelle (`.h1-hero`, `.titre-section`…), les photos par `.media`, les réglages par des attributs `data-*` sur `<html>`.
- **Palettes générées** (`theme.palette`, `lib/palette.ts`) : teinte des neutres, teinte d'accent, vivacité, ton, fond, sombre → 14 jetons
  calculés en OKLCH, chaque couleur de texte assombrie ou éclaircie par le code jusqu'aux seuils du kit. Les 13 608 combinaisons d'essai
  passent AA (un test en vérifie plus de 1 000 à chaque lancement).
- **27 polices auto-hébergées, 22 paires** classées par caractère (technique, net, robuste, éditorial, chaleureux, patrimoine,
  contemporain) ; **12 signatures** (6 nouvelles : cotes, points, chevrons, briques, rayures, topo) et 2 cadres de plus (liseré, coin).
- **Élément sur mesure** : le DA le conçoit dans `design.json > surMesure` (nom, composant, description aux 3 largeurs, textes à écrire,
  pourquoi cette entreprise) et le place dans les sections (type `surmesure`) ; le Rédacteur écrit ses textes (dans `site.json`, vérifiés
  comme le reste) ; l'Intégrateur le code dans `src/sections/custom/<Composant>.astro`. Étape normale de la recette (« Élément sur
  mesure »), qui échoue si le fichier n'existe pas ; il passe ensuite tous les contrôles.
- **Registre des sites** (`atelier/registre.ts`, table `registre_sites`) : empreinte de chaque site (métier, commune et coordonnées,
  couleurs finales, polices et paire, rayon, signature, mise en page résolue, en-tête, pied, variantes et ordre, photos et photo du hero,
  élément sur mesure, titres et phrases écrits, texte rendu). Inscription à chaque fabrication réussie (« à valider ») ; rattrapage
  idempotent au démarrage du hub (exemples du kit + toutes les maquettes en base). Les maquettes d'une même entreprise ne se comparent
  pas entre elles (ce sont des versions du même client).
- **Les agents le lisent** : le brief écrit `unicite-design.json` (DA : empreintes des sites du même métier et de la zone de 30 km,
  photos de hero, paires et teintes interdites) et `unicite-textes.json` (Rédacteur : titres et phrases des sites du même métier). Skill
  `design/unicite-des-sites` hérité par le DA, le Rédacteur et l'Intégrateur. Ces fichiers sont protégés en écriture (ADR-12).
- **Contrôle d'unicité bloquant** (`atelier/unicite.ts`, code pur) : à la sortie du DA (design seul), après l'assemblage (étape
  « Unicité ») et à chaque passage des contrôles (« Unicité (contrôle) »).
  - Distance de design = moyenne pondérée d'écarts par critère (accent 3 ; police des titres, variante du hero, ordre des sections 2 ;
    sombre, signature, photo du hero 1,5 ; police du texte, variantes 1 ; mise en page 0,4 à 0,6 par axe ; en-tête, pied, fond 0,5 ;
    rayon 0,4). Couleurs comparées en OKLab.
  - Texte : 5-grammes de mots des textes écrits, nom de l'entreprise, communes et téléphone remplacés par des jetons (une phrase recyclée
    avec un autre nom est repérée), n-grammes faits seulement de jetons ignorés (listes de communes) ; similarité de Jaccard.
  - Règles strictes : photo du hero déjà employée par un site du même métier ou de la zone ; même paire de polices ou teinte d'accent
    à moins de 25° (sans écart franc de luminosité) qu'un site du même métier dans la zone.
  - Échec → renvoi au DA (design) ou au Rédacteur (texte) avec le site en conflit et les éléments trop proches, mot pour mot (passages
    communs cités) ; deux renvois par agent pour cette cause (`max` du renvoi), puis arrêt.
  - Photos : l'usage de chaque photo vient du registre ; une photo déjà en hero dans la zone ou le métier est retirée des candidates
    hero du brief (`exclueHero`) et refusée en hero par le contrôle du design.
  - Résultat dans `.atelier/unicite.json`, affiché sur l'écran du site : « Unicité : site le plus proche = X, distance d, similarité texte s ».
- **Banque d'images** : 63 photos ajoutées (Unsplash/Pexels, crédits vérifiés, sans logo ni texte, matériel et toitures crédibles en
  France) : électricien 21 (9 hero), plombier 17, chauffagiste 17, couvreur 18, menuisier 18, peintre 18.

**Seuils et mesures** (calibrés sur les sites réels du registre au 2 nov. 2026) :

Mesures sur les sites réels (distance de design de 0 = identique à 1 ; texte = Jaccard des 5-grammes) :

| paire | relation | distance | texte |
|---|---|---|---|
| exemples du kit entre eux (électricien, plombier, couvreur) | autres métiers | 0,71 à 0,81 | 0,000 à 0,015 |
| exemple électricien Villeurbanne ↔ 3 versions de Lumen Élec (ancienne chaîne) | même métier, 4 km | 0,60 à 0,64 | 0,013 à 0,018 |
| 3 versions de Lumen Élec entre elles (même entreprise, même rédacteur) | — | 0,49 à 0,70 | 0,060 à 0,064 |
| Ferrand ↔ Volt'Est, DA lancés en parallèle sans piste de départ (refusé) | même métier, 8 km | 0,416 | — |
| Volt'Est ↔ Ferrand (version abandonnée de Ferrand, refusé) | même métier, 8 km | 0,481 | — |
| premier texte de Ferrand ↔ Volt'Est / Lumen Élec (refusé, renvoyé au Rédacteur) | même métier | — | 0,055 / 0,044 |
| **Volt'Est (Chassieu) ↔ Lumen Élec (Bron)** — maquettes finales | même métier, 4,5 km | **0,898** | **0,006** |
| **Ferrand Électricité (Vénissieux) ↔ Lumen Élec** | même métier, 5,1 km | **0,980** | **0,015** |
| **Ferrand Électricité ↔ Volt'Est** | même métier, 8,4 km | **0,984** | **0,010** |

Les trois maquettes finales passent tous les contrôles : Lighthouse 100/100/100, axe 0 grave ; revue visuelle 4,17/5 (Volt'Est, 1 tour de
correction) et 4/5 (Ferrand, 2 tours, après un « Refaire » : la première version s'était arrêtée à 3,83/5 sur des défauts des nouvelles
variantes, corrigés dans le kit).

Seuils retenus (recette `vitrine-artisan`) : distance ≥ **0,55** avec un site du même métier à moins de **30 km** (sous les 0,60 de deux
sites jugés distincts par l'ancienne chaîne, au-dessus des 0,49 de deux versions trop proches d'une même entreprise) ; ≥ **0,45** même métier
ailleurs ; ≥ **0,35** autre métier dans la zone ; texte ≤ **0,04** même métier (deux entreprises différentes : ≤ 0,021 ; un même rédacteur
qui se recopie : 0,06) et ≤ **0,06** sinon ; teinte d'accent ≥ **25°** entre voisins du même métier.

**Leçons des vraies fabrications** (2 électriciens fictifs près de Bron, en plus de Lumen Élec) :
- Deux DA lancés en même temps, libres de tout choisir, ont composé presque le même site (mêmes variantes « nouvelles », en-tête, pied,
  signature, une photo de hero de la même série et la même idée d'élément sur mesure). D'où : (1) un site entre au registre dès qu'il passe
  le contrôle d'unicité (une fabrication parallèle s'y compare tout de suite) et en sort quand son DA repart d'un nouveau design ; (2) une
  **piste de départ tirée au sort par le code** (`atelier/piste.ts`, graine = id du site, chaque choix pondéré pour s'écarter des sites proches,
  teinte d'accent la plus éloignée) dont le DA part et peut s'écarter en le justifiant ; (3) deux photos de la même série (même nom sans
  numéro) comptent comme la même photo de hero ; (4) deux noms d'élément sur mesure qui se recouvrent aux trois cinquièmes sont la même idée.
- Les revues visuelles ont relevé des défauts des nouvelles variantes (tuile élargie à moitié vide, panneau du hero « encart » qui laissait
  une bande vide, pastille non centrée, ligne d'appel cassée, interligne du nom géant en capitales) : corrigés dans le kit.
- Une fabrication arrêtée par la limite de session de l'abonnement Claude reprend sans perte (« Reprendre »).

**Conséquences.** Le nombre de combinaisons crédibles est très grand (5 heros × 5 services × 4 × 4 × 4 × 4 variantes, ordres,
22 paires, 12 signatures, palettes continues, 8 axes de mise en page) et le code refuse ce qui ressemble trop à un site existant.
Les anciens sites (sans `mise` ni `palette`) restent valides : valeurs par défaut. Limite : le registre compare des empreintes, pas des
images ; deux sites très différents sur le papier mais proches à l'œil passeraient — la revue visuelle reste le garde-fou.
