# Brief B — Kit de sites Astro (`packages/site-kit`)

Lis d'abord `CLAUDE.md`, `docs/VISION.md` (§2.2 et §4) et TOUS les skills de `skills/design`, `skills/copy`,
`skills/dev`, `skills/_shared`. Ils sont la référence de qualité : le kit doit les appliquer à la lettre.

Une autre session construit en parallèle `apps/hub` et `apps/web` et le `package.json` racine :
**n'écris que dans `packages/site-kit/` et dans `skills/dev/astro-site-kit/SKILL.md` (section « API du kit »).**

## Objectif
Le kit qui fabrique tous les sites clients. C'est la pièce qui fait la qualité du produit : un artisan qui reçoit sa
maquette doit la trouver plus belle que les sites de ses concurrents faits par des agences. Vise un niveau
« agence haut de gamme », pas « template ». Prends le temps qu'il faut.

## Ce qu'il faut livrer
1. **Projet Astro (dernière version stable) + Tailwind (v4)**, autonome (son propre `package.json` et `node_modules`,
   hors workspaces npm). Zéro JS client sauf menu mobile et formulaire. Polices auto-hébergées (`@fontsource*`).
2. **Schéma `site.json`** validé par zod (fichier `src/schema.ts`, types exportés) : entreprise (raison sociale, nom
   commercial, métier, NAF, SIREN, adresse, téléphone, email, horaires, note Google {valeur, nombre, url}, date de création,
   dirigeant), zone (commune + voisines), thème, liste ordonnée des sections avec variante et contenu, images, mode démo
   {actif, agence, date de suppression}, pages légales. Le build échoue proprement avec un message français si le
   `site.json` est invalide.
3. **Bibliothèque de sections**, chacune en 2 à 3 variantes réellement différentes (pas juste une couleur) :
   en-tête (+ menu mobile), hero (photo plein cadre / typographique avec élément signature / scindé), services
   (grille de cartes / liste détaillée / bande alternée), pourquoi nous, réalisations (galerie), avis (note Google sans
   texte d'avis), zone d'intervention (liste de communes + carte statique légère SANS Google Maps, ex. SVG stylisé ou
   rien), devis (formulaire), pied de page, barre d'action mobile fixe (Appeler / Devis), bandeau démo.
   Plus pages `mentions-legales` et `confidentialite` générées depuis les données.
4. **Thèmes** : jetons (couleurs dont neutres teintés, accent, polices titres/corps, rayon, style de signature) →
   variables CSS lues par Tailwind. Au moins 6 préréglages couvrant électricien, plombier, chauffagiste, couvreur,
   menuisier/bois, peintre — cohérents avec `skills/design/design-par-metier`. Un thème peut être surchargé par le site.
5. **SEO/technique** : title/meta, un seul H1, JSON-LD LocalBusiness au bon sous-type, sitemap, robots (démo : noindex +
   Disallow), favicon SVG généré (initiales + couleurs du thème), theme-color, Open Graph. `lang="fr"`. Typographie
   française (espaces insécables avant « : ; ! ? » appliquées automatiquement aux textes du site.json).
6. **Mode démo** : bandeau non masquable « Maquette réalisée par Liverdian pour <Entreprise>, non officielle — supprimée
   le <date> », noindex, formulaire qui n'envoie rien et affiche une explication. Hors démo, le formulaire poste vers une
   URL configurable dans site.json (on branchera plus tard), avec piège anti-spam (honeypot).
7. **Banque d'images locale** `packages/site-kit/stock/<metier>/` : 6 à 10 photos libres de droits par métier pour au
   moins électricien, plombier, chauffagiste, couvreur, + quelques intérieurs/maisons génériques de la région lyonnaise
   ou françaises. Sources autorisées : Unsplash et Pexels (licence libre usage commercial). Télécharge-les (WebSearch /
   WebFetch pour trouver, `curl` pour récupérer), redimensionne raisonnablement (largeur ≤ 2400), et tiens un
   `stock/CREDITS.json` (fichier, métier, auteur, URL source, licence, description de ce qu'on voit). Choisis des
   photos réalistes et cohérentes entre elles : pas de personnes en costume, pas d'images avec du texte, pas de rendu IA.
   Si tu ne peux pas en télécharger, dis-le dans le rapport et utilise un fond graphique de repli élégant, jamais une image cassée.
8. **Générateur** `scripts/new-site.mjs <dossier-cible> <site.json> [--images <dossier>]` : crée un projet de site
   client à partir du kit (copie des sources, `site.json`, images), SANS réinstaller les dépendances à chaque fois
   (jonction Windows `node_modules` vers celles du kit, `fs.symlinkSync(..., "junction")`), puis `npm run build` possible
   dans le dossier cible. Doit fonctionner hors du dépôt (ex. `.data/sites/x`). Documenter l'usage dans `packages/site-kit/README.md`.
9. **3 sites d'exemple** dans `packages/site-kit/examples/` (`site.json` de sociétés clairement fictives) : électricien à
   Villeurbanne (hero photo), plombier à Lyon 3e (hero typographique), couvreur à Vienne (hero scindé). Thèmes, variantes et
   textes différents : on doit voir que le kit ne produit pas deux fois le même site. Textes écrits selon
   `skills/copy/copywriting-artisan-local` (aucun cliché de la liste noire).
10. **Script de contrôle** `scripts/check-site.mjs <dossier-site>` : build, puis sur le `dist` servi en local :
    Lighthouse mobile (paquet npm `lighthouse`, `CHROME_PATH` = Edge
    `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`), axe-core via `playwright-core` (canal Edge),
    captures pleine page 375 / 768 / 1440 + capture écran initial mobile, détection de défilement horizontal,
    images cassées, texte `[À COMPLÉTER`/`undefined`/`lorem`, présence bandeau+noindex en démo.
    Sortie JSON (`check-report.json`) + PNG dans `<dossier-site>/.check/`. Le hub l'appellera tel quel : sortie stable et documentée.
    En démo, la catégorie SEO de Lighthouse est pénalisée par noindex : la noter à part, ne pas la compter dans le seuil.

## Exigence de qualité (non négociable)
Pour chaque exemple : génère-le avec `new-site.mjs` dans un dossier temporaire, passe `check-site.mjs`, puis
**regarde toi-même les captures** (outil Read sur les PNG) avec l'œil d'un directeur artistique exigeant en
appliquant `skills/qa/revue-visuelle`. Corrige et recommence jusqu'à : Lighthouse mobile ≥ 95 en performance,
accessibilité et bonnes pratiques ; axe sans violation grave ; aucun défaut bloquant ; note visuelle ≥ 4/5 sur chaque
critère de la grille, honnêtement. Garde les captures finales des 3 exemples dans `packages/site-kit/examples/<nom>/captures/`.

## Fin
- Mets à jour la section « API du kit » de `skills/dev/astro-site-kit/SKILL.md` : sections et variantes (avec quand
  utiliser chacune), props/contenu attendu, jetons de thème, préréglages, schéma site.json, commandes. C'est ce que liront
  les agents : précis et court.
- Pas de commit. Rapport final en français : ce qui est livré, scores mesurés par exemple, ce qui n'a pas pu être fait.
