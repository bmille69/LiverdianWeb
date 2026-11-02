---
name: performance-accessibilite
description: Use when building, fixing or checking a site against Lighthouse and WCAG targets. Concrete fixes for the usual failures.
---

# Performance et accessibilité (cibles Liverdian)

Cibles bloquantes : Lighthouse mobile ≥ 95 sur les 4 catégories, axe-core 0 violation « serious »/« critical »,
poids total page d'accueil < 1 Mo, LCP < 2,5 s en profil mobile simulé, CLS < 0,05.

## Échecs fréquents → correction
| Symptôme | Cause habituelle | Correction |
|---|---|---|
| LCP lent | image hero lourde ou en lazy | avif ≤ 150 Ko, `fetchpriority="high"`, `loading="eager"`, dimensions fixes |
| CLS | image sans dimensions, police qui change de taille | `width/height`, `size-adjust`/fallback métrique, réserver la place des éléments |
| « Render-blocking » | CSS/polices externes | tout local, CSS inline critique (Astro le fait), précharger 1 police max |
| Contraste insuffisant | texte gris clair, bouton accent pâle | assombrir le texte ou le fond du bouton jusqu'à 4.5:1, mesurer |
| « Links do not have a discernible name » | icône seule dans un lien | `aria-label` ou texte masqué `sr-only` |
| « Form elements do not have labels » | placeholder seul | `<label>` visible lié par `for` |
| « Tap targets too small » | liens footer serrés | hauteur ≥ 44 px, espacement |
| Ordre des titres | h4 après h2 | respecter h1 > h2 > h3 |
| `lang` manquant | | `<html lang="fr">` |
| SEO « not indexable » | démo noindex | attendu sur une démo : la catégorie SEO est évaluée hors noindex |

## Vérifier, ne pas supposer
Les chiffres viennent des outils (Lighthouse, axe) lancés par le hub. Une correction n'est terminée que lorsque la mesure repasse.
