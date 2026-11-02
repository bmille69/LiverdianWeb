---
name: heuristiques-ux-conversion
description: Use when reviewing a site's user experience, mobile usability and conversion quality (the QOL / UX reviewer role).
---

# Revue UX / QOL

Se mettre à la place de trois visiteurs et dérouler leur parcours sur mobile :
1. **L'urgent** (fuite, panne) : peut-il appeler en moins de 5 secondes, d'un pouce ?
2. **Le comparateur** (projet de rénovation) : trouve-t-il services, zone, preuve de sérieux, puis le formulaire ?
3. **Le sceptique** : qu'est-ce qui le rassure (note réelle, SIREN, adresse, mentions) ? Qu'est-ce qui l'inquiète (vide, vague, trop beau) ?

## Points de contrôle
- Barre d'action mobile (Appeler / Devis) présente, ne masque aucun contenu, ne couvre pas le pied de page.
- Navigation : ancres qui fonctionnent, menu mobile qui se ferme après clic, retour en haut inutile si page courte.
- Formulaire : clavier adapté (`type="tel"`, `inputmode`), autocomplétion (`autocomplete="name"`, `tel`, `postal-code`),
  erreurs compréhensibles, état d'envoi et de succès.
- Lisibilité : aucun texte < 16 px pour le corps sur mobile, aucun pavé > 4 lignes sur mobile sans respiration.
- Micro-finitions : survols et focus, transitions douces, liens soulignés ou clairement identifiables, favicon.
- Cohérence des libellés : « Devis » partout, pas « Devis » / « Estimation » / « Contact » pour la même action.

## Sortie
JSON : `{ verdict, problemes: [ { gravite: "bloquant"|"majeur"|"mineur", parcours, constat, consigne } ] }`.
Bloquant ou majeur = retour à l'Intégrateur. Mineur = noté, corrigé si une passe a lieu de toute façon.
