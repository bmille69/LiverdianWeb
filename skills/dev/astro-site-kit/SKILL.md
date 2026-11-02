---
name: astro-site-kit
description: Use when building or modifying a client site with the Liverdian site kit (Astro + Tailwind). Project layout, how sections, themes and site data fit together, and the coding rules.
---

# Construire un site avec le kit Liverdian

Le kit vit dans `packages/site-kit` du dépôt Liverdian. Un site client est un projet Astro généré à partir de ce kit.
La section « API du kit » en bas de ce fichier est la référence exacte ; la tenir à jour quand le kit change.

## Principe
- **Les données ne sont jamais dans les composants.** Tout ce qui est propre au client vit dans `src/data/site.json`
  (entreprise, textes, sections choisies, variantes, thème, images). Les composants le lisent.
- **Le thème est un jeu de jetons** (couleurs, polices, rayon, style de signature) converti en variables CSS ;
  Tailwind lit ces variables. Changer de thème ne touche aucun composant.
- **Une section = un composant Astro** dans `src/sections/<Famille><Variante>.astro` (ex. `HeroPhoto.astro`, `HeroType.astro`),
  avec des props typées et un rendu impeccable sans JavaScript.
- Un site sur mesure peut ajouter ses propres sections dans `src/sections/custom/` : même règles, mêmes jetons.

## Règles de code
- Zéro JavaScript client par défaut. Seuls îlots tolérés : menu mobile (quelques lignes inline), envoi du formulaire.
- Images via `astro:assets` (`<Image>`/`<Picture>`), dimensions fixées, avif/webp, `loading="eager"` + `fetchpriority="high"` sur l'image hero uniquement.
- Polices auto-hébergées (`@fontsource-variable/*` ou woff2 locaux), préchargement de la police des titres seulement.
- HTML sémantique : `header`, `nav`, `main`, `section[aria-labelledby]`, `footer`, un seul `h1`.
- Accessibilité : focus visible, cibles tactiles ≥ 44 px, labels de formulaire, contraste AA, `prefers-reduced-motion`.
- Pas de dépendance externe chargée à l'exécution (CDN, Google Fonts, Maps, analytics). Le site doit marcher hors ligne une fois servi.
- Classes Tailwind lisibles ; pas de valeurs arbitraires (`mt-[13px]`) sauf justification en commentaire.
- `npm run build` doit passer sans avertissement avant de rendre la main.

## Workflow de l'Intégrateur
1. Lire `brief.json` (données sources) et `design.json` (choix du DA) dans le dossier du site.
2. Remplir/ajuster `src/data/site.json`, choisir les sections, ajouter du sur-mesure seulement si le DA l'a demandé.
3. `npm run build`, corriger toute erreur. Ne jamais modifier les fichiers du kit partagé depuis un site client.
4. Rapport : sections utilisées, écarts avec le design demandé, points à vérifier.

## API du kit
Référence exacte : `packages/site-kit/src/schema.ts` (zod, messages français). Exemples complets :
`packages/site-kit/examples/{electricien-villeurbanne,plombier-lyon-3,couvreur-vienne}/site.json`.

### Commandes
- `node scripts/new-site.mjs <cible> <site.json> [--images <dossier>] [--force]` : valide, copie le kit, les images
  de banque citées et les photos client (`photos/`), relie `node_modules` (jonction). Puis `npm run build` dans la cible.
- `node scripts/check-site.mjs <site> [--sans-build] [--runs n]` : build + Lighthouse mobile + axe + captures 375/768/1440
  + écran initial → `<site>/.check/check-report.json` (`ok`, `echecs[]`, scores) et PNG. Code 0/1/2. Voir README du kit.
- Le build échoue (code 1, liste française) si site.json est invalide ou si un contraste du thème est < AA.
- Dans l'atelier du hub, l'Intégrateur ne lance que `npm run build` (et `npx astro check`) : c'est le hub qui lance
  check-site après chaque passage et transmet ses échecs. `package.json`, `astro.config.mjs`, `brief.json`, `design.json`,
  `content.json`, `.atelier/` et `.check/` ne se modifient pas. Toutes les photos candidates du site sont dans `stock/`.

### site.json (racine)
`version: 1` · `slug` · `entreprise` · `zone` · `theme` · `images` · `entete` · `sections[]` · `pied` · `seo` · `formulaire` · `demo` · `legal`
- **entreprise** : `raisonSociale`, `nomCommercial?` (affiché), `metier` (electricien|plombier|chauffagiste|couvreur|menuisier|peintre|macon|paysagiste|autre → sous-type JSON-LD),
  `metierLibelle` (« Électricien »), `naf`, `siren`, `siret?`, `formeJuridique?`, `capital?`, `rcs?`/`rm?`, `tva?`,
  `adresse {rue, codePostal, commune}`, `telephone` (tout format FR, normalisé), `email?`,
  `horaires? [{jours:["lu".."di"], ouverture:"08:00", fermeture:"18:00"}]` (plusieurs plages fusionnées), `horairesNote?`,
  `noteGoogle? {valeur, nombre, url}`, `dateCreation?` (AAAA-MM-JJ), `dirigeant?`.
- **zone** : `commune {nom, lat?, lon?}`, `voisines [{nom, lat?, lon?}]` (1–16), `precision?`. lat/lon obligatoires pour la variante carte.
- **images** : `{ "<clé>": { fichier: "stock/<metier>/x.jpg" | "photos/x.jpg", alt, focale?: "50% 30%" } }`. Les sections citent la clé.
  Banque : `packages/site-kit/stock/` (électricien, plombier, chauffagiste, couvreur, maison, menuisier, peintre) ; `stock/CREDITS.json`
  décrit chaque photo (description, orientation, `hero: true` si elle tient un texte superposé).
- **entete** : `{variante: "simple"|"double", boutonDevis?}` · **pied** : `{variante: "complet"|"sobre", phrase?}`.
- **seo** : `description` (70–170 car., viser 140–160), `titre?` (≤ 60, défaut « Métier à Commune | Nom »), `url?` (active sitemap, canonical, og:url).
- **formulaire** : `action?` URL qui reçoit le POST hors démo (sinon le contrôle `formulaire-destination` échoue).
- **demo** : `{actif, agence:"Liverdian", agenceUrl?, dateSuppression}` → bandeau non masquable, noindex, robots Disallow, formulaire inactif.
- **legal** : `directeurPublication?`, `hebergeur? {nom, adresse, telephone?, url?}` (défaut Cloudflare), `mediateur?`, `assurance?`.
  Champ légal obligatoire absent → « [À COMPLÉTER : …] » hors démo (bloque la mise en ligne), « non communiqué (maquette) » en démo.

Textes : écrire en français normal ; la typographie (espaces fines avant ; ! ?, insécable avant :, « », ’, nombre + unité) est appliquée au build.

### Sections (`sections[]` : `{type, variante, contenu, ancre?, menu?}`)
Règles imposées par le schéma : exactement un `hero`, en premier (porte le H1 unique) ; une section `devis` ; pas deux sections du même type à la suite ;
`menu: false` ou un libellé pour le menu (défauts : Services, Réalisations, Avis, Zone). Les fonds (clair/teinté/surface/sombre) alternent automatiquement.

| type | variantes | quand l'utiliser | contenu |
|---|---|---|---|
| hero | `photo` | très bonne photo calme côté texte (`hero:true` dans CREDITS) | `titre` (H1 métier + commune, 4–9 mots), `titreAccent?` (extrait exact du titre), `sousTitre`, `surtitre?`, `image` (requis), `afficherNote?`, `reperes?` (≤ 3 faits courts sourcés), `boutonAppel?`, `boutonDevis?` |
| | `typo` | pas de photo assez bonne ; fond texturé + fiche contact sombre (téléphone, horaires, adresse, note) | idem + `motSignature?` (mot géant en contour, ≤ 16 car., visible dès 1024 px) ; pas d'image |
| | `scinde` | belle photo mais chargée ; texte à gauche, image cadrée à droite, pastille note si `afficherNote` | idem, `image` requis (portrait idéal) |
| services | `cartes` | 4–8 prestations ; titre collant à gauche, cartes 2 colonnes | `titre`, `intro?`, `surtitre?`, `items[{titre, texte, icone?}]` (2–8) |
| | `liste` | 2–5 prestations détaillées, ton éditorial ; image du 1er item qui en a une affichée à côté (bureau) | items `{titre, texte, points?[≤4], image?}` |
| | `bandes` | 2–4 prestations phares avec une photo chacune, alternance gauche/droite | items `{titre, texte, points?, image}` (image requise) |
| pourquoi | `colonnes` | 2–4 arguments sobres, filet au-dessus | `titre`, `intro?`, `items[{titre, texte, icone?}]` |
| | `manifeste` | fond sombre, grande phrase-titre + arguments numérotés ; casse le rythme | idem + `image?` (bureau) |
| realisations | `mosaique` | 3–8 images, grande image + vignettes (5 = idéal) | `titre`, `intro?`, `images[{image, legende?}]` |
| | `grille` | 3, 6 ou 8 images régulières, légende sous l'image | idem |
| avis | `badge` | note géante centrée + lien fiche | `titre`, `texte?` (exige `entreprise.noteGoogle`, jamais de texte d'avis) |
| | `bandeau` | bande compacte sombre, transition entre deux grosses sections | idem |
| zone | `carte` | carte SVG schématique (siège, communes à leur position, anneaux km) + liste | `titre`, `intro?` (exige lat/lon) |
| | `liste` | commune en grand + voisines en colonnes, sans coordonnées | `titre`, `intro?` |
| appel | `bande` | relance pleine largeur sombre (urgence, entre deux sections longues) | `titre`, `texte?`, `image?` (fond voilé) |
| | `carte` | relance douce en carte arrondie avec photo | `titre`, `texte?`, `image?` |
| devis | `scinde` | défaut : coordonnées à gauche, formulaire à droite | `titre`, `intro` (ce qui se passe après l'envoi, sans délai inventé), `besoins?` (défaut : titres des services), `boutonEnvoyer?` |
| | `encadre` | fin de page solennelle, fond sombre, formulaire centré | idem |

Toujours présents : bandeau démo (si démo), en-tête collant (menu mobile), barre d'action mobile Appeler/Devis,
pied de page, pages `/mentions-legales/` et `/confidentialite/`, `robots.txt`, `sitemap` (si `seo.url`), `favicon.svg`,
`apple-touch-icon.png`, `og.jpg` (photo du hero + nom), JSON-LD LocalBusiness (aggregateRating seulement si la note est affichée).
Icônes : noms Lucide (https://lucide.dev), ex. zap, shield-check, circuit-board, house, lamp-ceiling, fan, wrench, droplets, flame, user-round, file-text.

### Thème (`theme`)
`{ preset, couleurs?, polices? {titres?, corps?}, rayon? (0|2|4|6|8|12|16), signature? }` — toute surcharge est vérifiée (contrastes AA).

| preset | palette | polices titres / corps | rayon | signature |
|---|---|---|---|---|
| electricien | bleu nuit, accent ambre | archivo / inter | 4 | faisceau (trame technique, cadres à équerres) |
| plombier | bleu profond sur blanc cassé, accent orange | bricolage-grotesque / source-sans-3 | 12 | onde |
| chauffagiste | anthracite chaud, accent brique | manrope / inter | 8 | isobares |
| couvreur | ardoise et pierre, accent terre cuite | fraunces / work-sans | 2 | tuiles (écailles, cadres en arche) |
| menuisier | crème, accent vert profond | dm-serif-display / inter | 6 | veinage (cadres décalés) |
| peintre | blanc chaud, accent bleu franc | schibsted-grotesk / inter | 0 | aplat (cadres décalés) |

Jetons couleur (`couleurs`, #RRGGBB) : `fond`, `surface`, `teinte` (fond alterné), `encre`, `encreDouce`, `trait`, `sombre`, `sombreSurface`,
`surSombre`, `surSombreDoux`, `accent` (boutons), `surAccent` (texte sur bouton), `accentTexte` (liens/accents sur clair), `accentSurSombre`.
Polices disponibles : archivo, barlow-semi-condensed, bricolage-grotesque, dm-serif-display, fraunces, inter, manrope, plus-jakarta-sans,
schibsted-grotesk, source-sans-3, space-grotesk, work-sans (auto-hébergées, sous-ensemble latin, repli ajusté sans CLS).
Signatures : faisceau, onde, isobares, tuiles, veinage, aplat (motif de fond, marqueur de surtitre, cadre d'image).
Ne jamais livrer deux sites du même métier identiques : changer au moins `accent`/`sombre`, une police ou la signature, et les variantes.
Classes Tailwind issues des jetons : `bg-fond`, `bg-teinte`, `text-encre`, `text-encre-douce`, `bg-sombre`, `bg-accent`, `text-sur-accent`,
`text-accent-texte`, `rounded-ui`, `rounded-ui-l`, `font-titres`, `font-corps` ; composants CSS `.btn .btn-primaire .btn-secondaire .lien .conteneur .section`.
