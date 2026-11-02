---
name: unicite-des-sites
description: Use when designing or writing a client site, so that it never resembles another site Liverdian has produced. Uniqueness rules and how to read the registry of existing sites.
---

# Chaque site est unique

Les artisans d'une même zone se parlent et regardent les sites de leurs concurrents. Deux sites Liverdian qui se
ressemblent, c'est la réputation de l'agence qui tombe et des clients qui se sentent floués. Le hub fournit le
**registre des sites existants** (empreinte de chaque site déjà produit : thème, teintes, polices, variantes et ordre
des sections, image hero, élément signature, élément sur mesure, ton). Le lire avant de décider.

## Règles de design (Directeur artistique)
- Comparer d'abord aux sites du **même métier** et de la **même zone (≈ 30 km)** : ce sont eux que le client verra.
- Ne jamais réutiliser la même **image hero** qu'un site de la même zone ni la même combinaison police titres + police corps qu'un site du même métier.
- La teinte d'accent doit s'écarter nettement de celles des sites du même métier (au moins 25° sur le cercle chromatique, ou un changement de luminosité/saturation franc si la palette métier l'impose).
- L'ordre et les variantes des sections ne reprennent jamais à l'identique ceux d'un site existant ; changer au moins 3 choix (variante de hero, de services, de preuve, rythme des fonds…).
- **Un élément sur mesure par site**, conçu pour CETTE entreprise : une section, un traitement graphique ou une interaction
  sobre qui n'existe dans aucun autre site (ex. frise « de la panne à la remise en service » pour un dépanneur, nuancier de tuiles
  pour un couvreur, carte des communes avec temps de trajet sourcé, illustration SVG d'un détail du métier). Le décrire
  précisément dans `design.json` ; l'Intégrateur le code.
- Partir de ce que l'entreprise a de singulier (son nom, sa commune, son ancienneté, sa spécialité, son logo s'il existe) plutôt que du préréglage métier.

## Règles de texte (Rédacteur)
- Le hub fournit les phrases déjà utilisées par les sites du même métier : n'en reprendre aucune, même reformulée de près.
- Titres de hero et de sections : formulations neuves. Interdit de recycler une structure de titre déjà employée
  (« Votre X à Y, du A au B » ne sert qu'une fois).
- Ancrer chaque bloc dans le concret de l'entreprise (ses prestations exactes, ses communes, ses faits) : un texte qui
  pourrait aller chez un concurrent est un texte à réécrire.

## Ce que le hub vérifie (bloquant)
- Distance de design avec chaque site existant ≥ seuil (plus strict même zone + même métier).
- Similarité de texte (n-grammes) avec chaque site existant ≤ seuil.
- Image hero et paire de polices non dupliquées dans la zone / le métier.
