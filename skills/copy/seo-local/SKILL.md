---
name: seo-local
description: Use when setting titles, meta descriptions, headings, structured data and local pages of a small-business site.
---

# SEO local

- `<title>` ≤ 60 caractères : « Métier à Commune | Nom de l'entreprise ». Unique par page.
- Meta description 140–160 caractères, avec commune, service principal et action (« Devis gratuit » seulement si sourcé).
- Un seul H1 par page contenant métier + commune ; H2 par section ; pas de saut de niveau.
- Données structurées JSON-LD `LocalBusiness` (ou sous-type : `Electrician`, `Plumber`, `HVACBusiness`, `RoofingContractor`,
  `HousePainter`, `GeneralContractor`) avec name, telephone, address, areaServed (communes), openingHoursSpecification
  si connus, url, et `aggregateRating` UNIQUEMENT si la note vient d'une source vérifiable affichée sur la page.
- Images : `alt` descriptif réel (« Tableau électrique rénové dans une maison ») pas de bourrage de mots-clés.
- URLs courtes en minuscules sans accents : `/depannage-electrique`, `/electricien-villeurbanne`.
- `sitemap.xml` et `robots.txt` générés. Démo : `noindex, nofollow` + robots `Disallow: /`.
- Pages locales (Pro) : contenu substantiellement différent d'une commune à l'autre ; jamais de page qui ne change que le nom.
- Liens `tel:` au format international (`tel:+33478…`), affichage au format français (04 78 …).
