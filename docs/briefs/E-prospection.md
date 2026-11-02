# Brief E — Prospection (phase 2)

Lis `CLAUDE.md`, `docs/VISION.md` (§2.1 surtout), le plan d'origine
`Pipeline de prospection — sites artisans automatisés.docx` (à la racine : sources, fiche prospect, grille de scoring,
règles légales), `docs/DECISIONS.md`, le skill `skills/prospection/audit-site-existant/SKILL.md`, puis le code
`apps/hub/src/**` et `apps/web/src/**`.

**Une autre session travaille en parallèle sur l'atelier et le kit** (unicité des sites : `apps/hub/src/atelier/`,
`packages/site-kit/`). N'y touche pas. Dans les fichiers partagés (`hub.ts`, `server/http.ts`, `db/database.ts`,
`domain/companies.ts`, routeur web, `Shell.tsx`), fais des modifications petites et ciblées (Edit, jamais de réécriture
complète), relis le fichier juste avant de l'éditer, et ajoute ta migration À LA FIN de la liste au moment de l'écrire.
**Pour tes essais, lance ton hub sur des ports et des données à toi** : `LIVERDIAN_DATA_DIR` dans un dossier temporaire,
`LIVERDIAN_PORT=4330`, et un port d'aperçu différent de 4321 (ajoute une variable d'environnement si ce port est figé).
L'autre session utilise `.data` et les ports 4320/4321. Aucune régression : tous les tests restent verts.

## Objectif
Le propriétaire définit des critères (métiers, zone, présence/qualité du site, ancienneté, avis…), lance une recherche,
obtient une liste notée et vérifiable de prospects, et en un clic crée une maquette, exclut ou prépare la suite.

## À livrer
1. **Sources** (`apps/hub/src/prospection/sources/`), légales uniquement (pas de scraping de Google Maps ni d'annuaires) :
   - **API Recherche d'entreprises** (`recherche-entreprises.api.gouv.fr`, gratuite sans clé) : recherche par codes NAF et
     communes/départements, établissements actifs, siège, date de création, dirigeants, tranche d'effectif. Respecte ses
     limites de débit (file + temporisation + reprise sur 429).
   - **Google Places API (New)** `places:searchText` avec `X-Goog-FieldMask` minimal (id, nom, adresse, téléphone national,
     site web, note, nombre d'avis, horaires, statut). Clé `GOOGLE_PLACES_API_KEY` ou réglage du hub ; **absente → l'étape
     est sautée proprement** et l'interface explique ce qu'elle apporterait. Appariement Sirene ↔ Places par nom + adresse
     (score d'appariement stocké, appariement douteux = signalé, jamais fusionné en silence). Compteur d'appels et coût estimé
     par campagne, plafond mensuel réglable (par défaut sous le quota gratuit) — le hub refuse de le dépasser.
   - **OpenStreetMap / Overpass** (gratuit) en complément pour site web / téléphone quand Places est absent.
   - Mise en cache des réponses (ne jamais repayer une même requête dans la durée de validité).
2. **Audit des sites existants** selon le skill `audit-site-existant` : code (fetch HTTPS/redirections/certificat,
   viewport, copyright, technologie, email sur page contact/mentions) + Lighthouse mobile léger via Edge quand un site
   existe ; le flou (franchise ? email pro ? « vrai site » ?) confié à DeepSeek si `DEEPSEEK_API_KEY` est configurée,
   sinon à Claude `haiku` en mode structured. Débit poli, `robots.txt` respecté, une visite légère par site.
3. **Scoring** : grille du plan par défaut (aucun site +40, sans HTTPS ou non mobile +25, copyright < 2021 +10, ≥ 10 avis et
   note ≥ 4,3 +20, créée depuis > 2 ans +10, site récent et correct −50, franchise exclue), **éditable dans l'interface**
   (règles activables, points, seuil de qualification, défaut 50). Chaque score est explicable (détail des points).
4. **Campagnes** : formulaire de critères enregistrable et relançable — métiers (libellés lisibles → codes NAF du bâtiment
   et services courants), zone (commune + rayon en km, ou départements, ou liste de communes), présence/qualité du site,
   ancienneté minimale, avis minimum et note, exclusions (franchises, déjà contactés, liste d'opposition, clients). Suivi en
   direct (sourcés, enrichis, audités, qualifiés), reprise après redémarrage (jobs de la file existante, idempotents).
   Les entreprises trouvées alimentent la table `companies` existante (statut `prospect`/`qualifie`, sources par champ
   `sirene`/`places`/`osm`/`audit`), sans doublon (clé SIREN/SIRET), et ne perdent jamais une donnée saisie à la main.
5. **Écran Prospection** (remplace la page « bientôt ») : liste des campagnes ; tableau des prospects filtrable/triable
   (score, métier, commune, statut du site, avis, distance), sélection multiple ; panneau de fiche avec le détail du score,
   les relevés de l'audit et leurs preuves (liens), la source de chaque donnée ; actions en un clic, sur une ligne ou une
   sélection : **Créer la maquette** (appelle l'atelier existant ; en lot avec un plafond de fabrications simultanées
   réglable, défaut 1, file visible), **Exclure** (avec motif), **Copier le numéro**, **Ouvrir le site actuel**. Même niveau
   de finition que le reste (Linear/Raycast, animations, réduction des animations).
6. **RGPD et légal** (plan, §Cadre légal) : liste d'opposition à vie (une entreprise opposée n'est plus jamais sourcée),
   purge automatique des prospects non convertis après 6 mois (réglable), page « Registre de traitement » générée,
   aucune donnée inutile stockée.
7. **Skills** : ajoute un agent `eclaireur` au registre (rôle : audit et qualification ; skills `prospection/audit-site-existant`
   + règles de la maison) dans `skills/agents.json` et `agents/registry.ts`.

## Vérification réelle obligatoire
- Tests Vitest avec sources simulées : appariement, scoring et explications, dédoublonnage, plafond d'appels Places,
  liste d'opposition, purge, campagne reprise après redémarrage.
- **Une vraie campagne** sur l'API Recherche d'entreprises (réelle, sans clé) : électriciens (43.21A) et plombiers
  (43.22A) à Bron + 10 km. Audit réel des sites trouvés via OSM quand il y en a. Donne les chiffres (sourcés, avec site,
  sans site, qualifiés) et vérifie à la main 5 fiches au hasard contre leurs sources. Places ne sera pas testable sans
  clé : teste-le avec un faux serveur, et documente comment le propriétaire ajoutera sa clé (Réglages).
- Ne lance PAS de vraie fabrication de maquette (l'autre session en fait) : vérifie que le bouton crée bien les jobs
  atelier attendus dans ton hub de test, puis annule-les.
- Captures de l'écran Prospection (Edge, playwright-core) relues et corrigées.
- `npm run typecheck`, `npm test`, `npm run build` verts.

## Fin
ADR dans `docs/DECISIONS.md` (relis la fin juste avant d'écrire : l'autre session numérote aussi), README (section
Prospection + comment obtenir et saisir la clé Google Places). Pas de commit. Rapport final en français avec les chiffres.
