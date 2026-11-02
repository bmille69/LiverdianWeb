---
name: controle-faits
description: Use when verifying that a generated site contains no invented or wrong facts compared to its source brief.
---

# Contrôle des faits

Entrée : `brief.json` (données sources avec leur origine) et le texte rendu du site (HTML construit).

## Procédure
1. Extraire du site chaque affirmation factuelle : identité (nom, SIREN, adresse, téléphone, email), chiffres
   (années, nombres, notes, prix, délais), labels/certifications, horaires, communes, prestations, garanties.
2. Pour chacune, chercher la source dans le brief. Classer : `conforme`, `reformulation acceptable`, `absente des sources`, `contradictoire`.
3. Prestations : acceptables si cohérentes avec le code NAF ou listées dans les sources ; douteuses sinon (ex. « installation de piscine » pour un électricien).
4. Tout `absente des sources` ou `contradictoire` = échec, avec la phrase exacte et sa localisation (section).

## Pièges
- Les promesses vagues mais factuelles (« intervention en 1 h », « devis gratuit », « garantie décennale ») sont des faits.
- La note Google doit être exactement celle du brief, avec le bon nombre d'avis.
- Le téléphone affiché et le lien `tel:` doivent correspondre au même numéro.
- Un nom de dirigeant n'apparaît que s'il est dans les sources ET utile.

## Sortie
JSON : `{ verdict: "pass"|"fail", items: [{ phrase, section, statut, source? , correction? }] }`.
Pas de « pass avec réserves » : une seule affirmation non sourcée suffit à échouer.
