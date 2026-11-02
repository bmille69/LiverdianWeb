---
name: revue-visuelle
description: Use when reviewing screenshots of a generated site (mobile, tablet, desktop) and scoring its visual quality against a fixed rubric.
---

# Revue visuelle sur captures

Entrée : captures pleine page à 375, 768 et 1440 px (+ capture de l'écran initial mobile, sans défilement).

## Défauts bloquants (un seul = échec)
- Texte coupé, débordant, superposé, illisible sur son fond ; élément qui sort de l'écran (défilement horizontal).
- Zone vide anormale, image cassée ou absente, placeholder visible (lorem, `[À COMPLÉTER]` sur une démo, `undefined`).
- Sur mobile : le téléphone ou le bouton « Appeler » n'est pas visible dans l'écran initial.
- Bandeau « maquette » absent sur une démo.
- Incohérence grossière : deux styles de boutons, polices différentes de celles du thème, alignements cassés.

## Grille de qualité (note /5 chacun, seuil : moyenne ≥ 4 et aucun critère < 3)
1. **Hiérarchie** : on comprend qui / quoi / comment contacter en 3 secondes.
2. **Espacement et rythme** : sections aérées, alternance de fonds, pas de monotonie.
3. **Typographie** : contraste titre/corps, longueur de ligne, interlignage.
4. **Couleur et images** : palette cohérente avec le métier, images cohérentes entre elles, accent réservé aux actions.
5. **Finition** : détails soignés, élément signature, rien qui fasse « gabarit » ou « généré par IA ».
6. **Mobile** : la version 375 px est conçue, pas seulement rétrécie.

## Méthode
Décrire d'abord ce qu'on voit (sans juger), puis noter. Chaque note < 5 cite le défaut précis et où il est.
Les captures peuvent être réduites : ne pas affirmer qu'un élément est aligné ou centré au pixel près sans le mesurer.

## Sortie
JSON : `{ verdict, blocking: [..], scores: { hierarchie, espacement, typographie, couleur_images, finition, mobile }, corrections: [ { section, probleme, consigne } ] }`.
Les consignes sont actionnables par l'Intégrateur (« réduire le H1 mobile à 2.25rem », pas « améliorer le titre »).
