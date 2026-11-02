# Brief C — La chaîne de l'atelier (fiche entreprise → maquette validée)

Lis d'abord `CLAUDE.md`, `docs/VISION.md` (§2.2, §3, §4), `docs/DECISIONS.md`, puis le code existant :
`apps/hub/src/**` (couche agents, file de travaux, domaine, HTTP), `apps/web/src/**`, `packages/site-kit/README.md`,
`packages/site-kit/src/schema.ts`, `skills/agents.json` et tous les `skills/**/SKILL.md`. Le socle et le kit sont livrés
et vérifiés (commit initial). Tu peux tout modifier dans le dépôt, mais **aucune régression** : les tests existants restent verts.

## Objectif
Un bouton « Créer la maquette » sur une fiche entreprise lance une chaîne d'agents qui produit une maquette de niveau
agence, contrôlée automatiquement, et la dépose dans « À valider » avec son aperçu. La qualité du résultat compte plus
que tout : la chaîne existe pour garantir que chaque maquette égale les exemples du kit (`packages/site-kit/examples`).

## Principes imposés
- **Machine à états déterministe** dans le hub (`apps/hub/src/atelier/`) : le code enchaîne les étapes, passe les
  fichiers exacts (chemins), jamais de résumé. Chaque étape = un job de la file existante, rejouable sans dégât
  (idempotente : elle repart de ses fichiers d'entrée). L'état de la fabrication est persisté (migration ajoutée en fin de liste).
- **Recettes** : une recette décrit le type de site (étapes, agents, contrôles, seuils). Livre `vitrine-artisan`
  (1 page) ; l'architecture doit permettre d'ajouter d'autres recettes sans toucher au moteur.
- **Un contrôle raté bloque** : pas de « validé avec remarques ». Correction automatique, 3 tours maximum, puis
  arrêt « à revoir » avec le motif clair (jamais de maquette ratée présentée comme bonne).
- Les agents ne voient que leurs skills hérités (`skills/agents.json`) + les règles de la maison.

## Étapes de la recette `vitrine-artisan`
1. **Brief** (code) : `brief.json` dans le dossier du site (`.data/sites/<id>/`) depuis la fiche entreprise, avec la
   source de chaque donnée, les services plausibles du code NAF (table NAF → prestations du bâtiment dans le code), les
   communes voisines (saisies sur la fiche ; sinon laisser l'agent proposer seulement des communes réelles de la liste
   fournie — prévois une petite table locale des communes de la métropole de Lyon / Rhône / Isère nord avec coordonnées,
   la carte SVG du kit en a besoin), la date de suppression de la démo (J+30), et le catalogue de la banque d'images
   (`stock/CREDITS.json` : fichier + description).
2. **Directeur artistique** (structured, + vision pour regarder les photos candidates de la banque) → `design.json` :
   préréglage de thème + ajustements de teinte (deux sites du même métier ne doivent pas être identiques), variantes et
   ordre des sections, choix des images avec justification, élément signature, intention en 3 phrases.
3. **Rédacteur** (structured) → `content.json` : tous les textes des sections choisies, conformes au schéma du kit.
4. **Assemblage** (code) : `site.json` = brief + design + contenu, validé par le schéma du kit, puis `new-site.mjs`.
   Une erreur de schéma renvoie à l'agent fautif avec le message exact (1 tour), pas de bricolage silencieux.
5. **Intégrateur** (mode atelier Claude Code dans le dossier du site) : seulement si le DA a demandé du sur-mesure
   ou pendant les tours de correction. Le build doit passer. Ajuste la liste des commandes permises si `check-site`/build
   l'exigent (sans jamais ouvrir `node` à tout faire).
6. **Contrôles automatiques** (code) : `check-site.mjs` du kit. Seuils de la recette : Lighthouse mobile ≥ 95
   performance/accessibilité/bonnes pratiques, axe 0 violation grave, aucun défaut détecté par le script.
7. **Contrôleur QA** : (a) contrôle des faits (structured) sur le texte rendu du `dist` comparé au `brief.json` ;
   (b) revue visuelle (vision) sur les captures selon `qa/revue-visuelle` : moyenne ≥ 4, aucun critère < 3, aucun bloquant.
8. **Relecteur UX** (vision + texte rendu) selon `ux/heuristiques-ux-conversion` : aucun problème bloquant ou majeur.
9. **Correction** : si 6, 7 ou 8 échoue, le hub compile les consignes exactes (verbatim) → Intégrateur → retour en 6.
10. **À valider** : statut du site `a_valider`, apparaît dans « Aujourd'hui ». Actions humaines : **Valider** (statut
    `demo_prete` ou équivalent — la mise en ligne arrivera en phase 3), **Demander des modifications** (texte libre →
    tour de correction avec ce texte verbatim comme exigence, puis toute la chaîne de contrôle), **Refaire** (repart de l'étape 2).

## Interface
- Fiche entreprise : bouton principal « Créer la maquette » (désactivé avec explication si des champs indispensables
  manquent : nom, métier/NAF, commune, téléphone).
- **Écran d'un site** (route dédiée) : frise des étapes avec l'agent de chaque étape, état en direct (SSE), durée ;
  **aperçu** du `dist` servi par le hub, en cadre mobile et cadre ordinateur côte à côte, bascule plein écran et lien
  « ouvrir dans un onglet » ; panneau contrôles (scores Lighthouse, axe, faits, notes visuelles par critère, problèmes UX)
  ; captures ; sortie de chaque agent repliée (intention du DA, etc.) ; historique des tours de correction ; boutons de
  validation. Niveau de finition identique au reste de l'interface (Linear/Raycast, animations, réduction des animations).
- Atelier : liste des fabrications en cours/à valider/arrêtées. Sites : tous les sites avec vignette (capture) et statut.

## Vérification réelle obligatoire
1. Tests Vitest de la machine à états avec agents simulés (enchaînement, blocage sur contrôle raté, 3 tours puis arrêt,
   reprise après redémarrage au milieu, modifications demandées verbatim, refus de schéma renvoyé à l'agent).
2. **Une vraie fabrication de bout en bout** par le hub (vrais agents Claude, abonnement) sur une fiche réaliste mais
   fictive : « Lumen Élec », électricien (43.21A) à Bron, 2 avenue Franklin Roosevelt 69500 Bron, 04 72 00 00 00
   (numéro fictif), entreprise créée en 2019, note 4,7 sur 23 avis, communes voisines Vaulx-en-Velin, Villeurbanne,
   Saint-Priest, Chassieu, Lyon 8e. Fais-la tourner jusqu'au bout, puis **regarde toi-même les captures** (Read) avec
   l'exigence de `qa/revue-visuelle`, et compare à `packages/site-kit/examples/electricien-villeurbanne` : elle doit être
   au moins aussi bonne et visiblement différente. Si la chaîne laisse passer une maquette médiocre, c'est la chaîne qu'il
   faut corriger (prompts, seuils, contrôles), pas la maquette à la main. Note la durée totale et le nombre de tours.
3. Captures de l'écran du site et de l'aperçu dans l'interface (playwright-core, Edge), relues.
4. `npm run typecheck`, `npm test`, `npm run build` verts. Ajoute un `.gitattributes` (`* text=auto eol=lf`).

## Fin
ADR dans `docs/DECISIONS.md` (atelier, recettes, boucle de correction), README à jour. Pas de commit.
Rapport final en français : ce qui est livré, la fabrication réelle (durée, tours, scores, ce que tu as jugé sur les
captures), limites.
