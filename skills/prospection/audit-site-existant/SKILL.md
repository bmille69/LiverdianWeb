---
name: audit-site-existant
description: Use when auditing a prospect's current website or online presence to qualify it (HTTPS, mobile, age, contact email, franchise).
---

# Auditer la présence en ligne d'un prospect

Objectif : savoir vite si l'entreprise est **active, crédible et mal représentée en ligne** (le prospect idéal).

## Relevés (le code en fait l'essentiel, l'agent ne traite que le flou)
- Le site répond-il ? Redirection vers HTTPS ? Certificat valide ?
- Adapté au mobile : balise viewport, largeur du contenu à 375 px, taille de texte, défilement horizontal.
- Âge : année du copyright, dates d'actualités, technologies datées (Flash, tableaux de mise en page, jQuery 1.x, Wix/Jimdo anciens gabarits), dernier `Last-Modified`.
- Score Lighthouse mobile rapide (performance + accessibilité) si le site répond.
- Contact : email professionnel visible (page contact, mentions légales), téléphone affiché.
- Signaux d'exclusion : franchise ou réseau national (mentions « réseau », « franchisé », logo d'enseigne connue,
  site hébergé sous le domaine d'un réseau), page « site en construction » d'un annuaire, entreprise fermée.
- Page Facebook / annuaire seulement = « pas de vrai site ».

## Règles
- Respecter `robots.txt`, une seule visite légère par site (page d'accueil + contact/mentions au plus), délai entre requêtes, user-agent identifiable.
- Ne rien stocker de plus que nécessaire (RGPD) : pas de copie des pages, seulement les relevés.
- Une donnée incertaine reste `inconnue`, jamais devinée. L'email retenu doit apparaître tel quel sur le site.

## Sortie
`{ statut_site: "aucun"|"annuaire_seulement"|"date"|"sans_https"|"non_mobile"|"correct", https, mobile, annee_copyright,
email, technologie, franchise: bool, preuves: [ { constat, url } ] }`.
