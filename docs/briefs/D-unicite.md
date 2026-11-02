# Brief D — Chaque site est unique

Lis `CLAUDE.md`, `docs/VISION.md`, `docs/DECISIONS.md`, le nouveau skill `skills/design/unicite-des-sites/SKILL.md`,
puis `apps/hub/src/atelier/**`, `packages/site-kit/**` (schéma, sections, thèmes, polices, signatures), `skills/agents.json`.

**Une autre session construit la prospection en parallèle** (`apps/hub/src/prospection/`, nouvelles pages web, champs
d'entreprise). Reste dans l'atelier, le kit et les skills de design/rédaction. Dans les fichiers partagés (`hub.ts`,
`server/http.ts`, `db/database.ts`, routeur web, `Shell.tsx`), fais des modifications petites et ciblées (Edit, jamais
de réécriture complète), relis le fichier juste avant de l'éditer, et ajoute ta migration À LA FIN de la liste au
moment de l'écrire (l'autre session en ajoute une aussi). Aucune régression : tous les tests restent verts.

## Demande du propriétaire (verbatim)
« Il ne faut pas générer 2 fois le même site pour les clients, il faut que chacun soit unique. »

## À livrer
1. **Diversité du kit** (sans baisser la qualité — mêmes exigences Lighthouse/axe/vision que le brief B) :
   - au moins 4 variantes réellement différentes par famille de section principale (hero, services, preuve/pourquoi,
     réalisations, zone, devis), et 3 en-têtes/pieds ;
   - paramètres de mise en page indépendants des thèmes : échelle typographique, densité/espacement, rayon, traitement
     d'image (cadre, bords francs, duotone léger…), style des boutons, rythme des fonds ;
   - bibliothèque d'au moins 16 paires de polices auto-hébergées classées par caractère, et des palettes générées par
     site (teinte calculée, neutres teintés, contrastes AA vérifiés par le code) au lieu de 6 palettes fixes ;
   - davantage d'éléments signature.
   Le DA compose librement parmi ces axes : le nombre de combinaisons crédibles doit être très grand.
2. **Élément sur mesure par site** : le DA décrit dans `design.json` un élément propre à l'entreprise ; l'Intégrateur le
   code dans `src/sections/custom/` (mêmes jetons, mêmes règles de qualité). Il devient une étape normale de la recette
   (plus seulement lors des corrections). Il passe les mêmes contrôles.
3. **Registre des sites** (`apps/hub/src/atelier/registre.ts` + table) : empreinte de chaque site produit (métier,
   coordonnées/commune, thème/teintes, polices, mise en page, variantes et ordre, image hero, signature, élément sur
   mesure, texte rendu). Rempli automatiquement à chaque fabrication réussie. Les 3 exemples du kit et les maquettes
   déjà en base y sont inscrits (script de rattrapage idempotent).
4. **Les agents le lisent** : le DA reçoit les empreintes des sites du même métier et de la zone (≈ 30 km) ; le
   Rédacteur reçoit les titres et phrases déjà employés par les sites du même métier. Ajoute `design/unicite-des-sites`
   au DA, au Rédacteur et à l'Intégrateur dans `skills/agents.json`.
5. **Contrôle d'unicité bloquant** (code, nouvelle étape après l'assemblage puis à chaque contrôle) :
   distance de design pondérée avec chaque site existant ≥ seuil (plus strict même métier + même zone) ; similarité de
   texte (shingles de 5 mots, Jaccard ou équivalent) ≤ seuil ; image hero et paire de polices non dupliquées dans la zone
   / le métier. Échec → retour au DA ou au Rédacteur avec le site en conflit et les éléments trop proches (verbatim).
   Seuils dans la recette, calibrés sur des mesures réelles (note les valeurs mesurées dans l'ADR).
   L'écran du site affiche le résultat (« Unicité : site le plus proche = X, distance d, similarité texte s »).
6. **Banque d'images** : suivre l'usage de chaque photo ; une photo déjà utilisée en hero dans la zone est exclue des
   candidates hero. Étoffe la banque (Unsplash/Pexels, crédits tenus) pour qu'il y ait au moins 15 photos utilisables
   par métier principal, cohérentes avec la région lyonnaise (bâti, toitures), sans logos ni texte incrusté.

## Vérification réelle obligatoire
- Tests Vitest : registre, distance, similarité, blocage et retour au bon agent, exclusion d'image.
- **Fabrique réellement 2 nouvelles maquettes d'électriciens proches de Bron** (fiches fictives réalistes, numéros
  fictifs 04 72 00 00 xx), en plus de Lumen Élec déjà en base. Regarde les captures des 3 (Read) côte à côte : un
  artisan qui les verrait toutes les trois doit penser à trois agences différentes, et chacune doit rester au niveau des
  exemples du kit. Si ce n'est pas le cas, corrige la chaîne (prompts, axes du kit, seuils) et recommence. Donne les
  distances et similarités mesurées entre elles.
- Les 3 exemples du kit se construisent toujours et passent `check-site`.
- `npm run typecheck`, `npm test`, `npm run build` verts.

## Fin
ADR dans `docs/DECISIONS.md` (relis la fin du fichier juste avant : l'autre session numérote aussi), mise à jour de la
section « API du kit » du skill `dev/astro-site-kit`. Pas de commit. Rapport final en français avec les mesures.
