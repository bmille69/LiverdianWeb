---
name: web-design-pro
description: Use when designing or reviewing any page of a client website. Professional visual design rules that make a small-business site look agency-made, not template-made or AI-made.
---

# Design web professionnel

Le but : qu'un artisan ouvre sa maquette et pense « c'est mieux que ce que mon concurrent a payé 3 000 € ».
Un site médiocre se repère en 2 secondes ; voici ce qui fait la différence.

## 1. Hiérarchie avant tout
- Une seule chose domine chaque écran. En haut de page : le nom/métier + la promesse + le bouton d'appel.
  Si deux éléments crient aussi fort, aucun n'est entendu.
- Trois niveaux de texte maximum par section : titre, sous-titre/intro, corps. Le reste est en petit et atténué.
- Le contraste de taille entre H1 et corps doit être franc (H1 mobile ≥ 2,25rem, desktop 3,5–4,5rem ; corps 1–1,125rem).

## 2. Espacement = luxe
- Échelle d'espacement fixe (4/8/12/16/24/32/48/64/96/128 px), jamais de valeur au hasard.
- Sections : 80–128 px de marge verticale sur desktop, 56–80 px sur mobile. Un site qui respire paraît cher.
- Largeur de lecture 60–75 caractères (max-w-prose). Jamais de paragraphe pleine largeur sur desktop.
- Aligner sur une grille ; un élément décalé de 3 px se voit inconsciemment.

## 3. Typographie
- Deux familles maximum (une pour les titres avec du caractère, une neutre très lisible pour le corps), ou une seule famille avec graisses contrastées.
- Polices auto-hébergées (fichiers woff2 dans le site), `font-display: swap`, 2–4 fichiers au total.
- Titres : interlignage serré (1.05–1.2), légère réduction d'approche (`tracking-tight`). Corps : interlignage 1.6–1.75.
- Éviter : Arial/Times par défaut, plus de 3 graisses, texte justifié, majuscules sur des phrases entières.

## 4. Couleur
- Structure 60/30/10 : neutre dominant (fond), secondaire (surfaces, texte), une couleur d'accent réservée aux actions (boutons, liens, détails).
- Les neutres ne sont jamais gris pur : les teinter légèrement vers la couleur de marque (ex. slate chaud, pierre).
- L'accent n'est jamais utilisé pour de grands aplats de texte. Un seul bouton « primaire » par écran.
- Contraste texte ≥ 4.5:1 (WCAG AA), 3:1 pour le gros texte et les icônes utiles. Vérifier, ne pas estimer.

## 5. Images
- Images réelles et cohérentes (même lumière, même traitement) > images nombreuses. 3 belles photos battent 12 moyennes.
- Toujours `width`/`height` ou `aspect-ratio` (pas de saut de mise en page), format moderne (webp/avif), `loading="lazy"` sauf l'image du haut.
- Superposition de texte sur photo : voile dégradé suffisant pour garantir le contraste, jamais de texte sur zone chargée.
- Interdit : photos de poignées de main génériques, personnes en costume pour un plombier, images avec texte incrusté, illustrations « IA » lisses.

## 6. Composants qui trahissent un site amateur (à éviter)
- Carrousel automatique en haut de page. Icônes clipart multicolores. Ombres portées épaisses. Dégradés arc-en-ciel.
- Cartes toutes identiques sans rythme (alterner : grille, liste avec photo, bande pleine largeur, citation).
- Boutons de 5 styles différents. Coins arrondis incohérents (choisir un rayon et s'y tenir : 0, 6, 12 px…).
- Le « style IA » : dégradé violet-bleu, glassmorphism partout, emojis en guise d'icônes, textes « Bienvenue sur notre site ».

## 7. Détails qui font pro
- Un élément signature par site (une forme, un trait, une texture discrète, un traitement de titre) qui le rend reconnaissable.
- Icônes d'une seule famille, même épaisseur de trait (Lucide, Phosphor), en SVG inline.
- États de survol et de focus soignés (focus visible obligatoire), transitions 150–250 ms, `prefers-reduced-motion` respecté.
- Favicon, balise theme-color, image de partage (Open Graph) générées pour chaque site.
- Pied de page complet et ordonné : coordonnées, horaires, zone, liens légaux.

## 8. Avant de rendre
Regarder la page à 375 px puis 1440 px et se demander : qu'est-ce que je vois en premier, en deuxième, en troisième ?
Si la réponse n'est pas « qui / quoi / appeler », recommencer la hiérarchie.
