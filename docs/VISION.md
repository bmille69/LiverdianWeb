# Liverdian — hub multi-agents de création et de vente de sites web

Document de cadrage (2 nov. 2026). Il reprend le plan « Pipeline de prospection » (racine du dossier),
le corrige là où il le faut et l'élargit à un outil qui servira au-delà des artisans.

---

## 1. Ce qu'on construit

Une application locale (comme Nidavellir) qui fait tourner une petite agence web :

```
 PROSPECTION ──► COMMERCIAL ──► ATELIER ──► LIVRAISON ──► SUIVI & SAV
 (trouver)       (convaincre)   (fabriquer)  (mettre en ligne) (garder le client)
        └────────────── FINANCE (devis, factures, abonnements, CA) ──────────────┘
```

Un seul objet relie tout : **l'entreprise** (prospect puis client). Une fiche entreprise porte son
audit, son score, ses maquettes, ses échanges, ses sites, ses factures. On ne ressaisit jamais rien.

Principe de travail des agents (leçons de Nidavellir) :
- **Le code du hub enchaîne les étapes, les agents font le travail créatif.** Pas d'agent
  « orchestrateur » qui résume ou oublie : une machine à états déterministe passe les fichiers
  exacts d'une étape à l'autre.
- **La mesure remplace l'œil.** Chaque livrable passe des contrôles automatiques bloquants
  (Lighthouse, accessibilité, captures relues par vision, vérification des faits). Un contrôle
  raté renvoie en correction, jamais « validé avec remarques ».
- **Une seule validation humaine obligatoire : ce qui part chez un prospect ou un client**
  (maquette, email, mise en ligne). En un clic, dans une file « À valider ».

---

## 2. Les modules

### 2.1 Prospection (sourcing, audit, scoring)

**Sources — légales et stables** (le scraping de Google Maps ou des Pages Jaunes est interdit par
leurs conditions et casse au premier changement de page ; on ne le fait pas) :

| Source | Coût | Ce qu'elle donne |
|---|---|---|
| API Recherche d'entreprises (api.gouv.fr) | gratuite, sans clé | SIREN, NAF, adresse, date de création, dirigeant, état actif |
| Google Places API (New) | quota gratuit mensuel puis ~0,03 $/fiche (à confirmer sur la console) | téléphone, site web, note, nombre d'avis, horaires |
| Le site du prospect lui-même | gratuit | audit : HTTPS, mobile, Lighthouse, année du copyright, email, mentions légales, techno |
| OpenStreetMap (option) | gratuit | complément site/téléphone quand Places ne trouve pas |

**Campagne de recherche** = un formulaire de critères, enregistrable et relançable :
métiers (liste lisible → codes NAF), zone (commune + rayon, départements, liste de villes),
présence de site (aucun / daté / sans HTTPS / non mobile / peu importe), ancienneté minimale,
avis minimum et note, exclusions (franchises, déjà contactés, liste d'opposition).

**Pipeline** : Sirene trouve les entreprises → Places les enrichit → l'auditeur visite les sites
(navigateur sans fenêtre + Lighthouse) → le score est calculé par une **grille réglable dans
l'interface** (celle du plan par défaut). Tout est du code, sauf l'extraction floue sur les sites
(email, année, « est-ce une franchise ? ») confiée à DeepSeek, peu cher et suffisant pour ça.

**Écran Prospects** : tableau filtrable et triable (score, ville, métier, statut du site),
fiche à droite avec la capture de son site actuel et les défauts relevés. Actions en un clic,
une ligne ou une sélection : **Créer la maquette · Préparer l'email · Ajouter à une séquence ·
Exclure · Appeler (copie du numéro + script)**.

### 2.2 Atelier (fabrication des sites) — le cœur de la qualité

**Pourquoi la qualité tient** : on ne demande pas à un agent d'inventer un site à partir de rien
à chaque fois (résultat inégal, lent, cher). On construit d'abord, une fois, avec le plus grand soin,
une **bibliothèque de sections premium** (en-têtes, services, zone, avis, réalisations, devis, pied
de page), chacune en plusieurs variantes, plus des **thèmes** (palettes, paires de polices,
iconographie) adaptés par métier. Chaque site client est ensuite **composé, adapté et réécrit** :
textes propres à l'entreprise et à sa commune, choix de variantes, ajustements de design.
La formule Pro et les futurs types de sites ajoutent une passe de design sur mesure.

**Techno des sites** : **Astro + Tailwind** plutôt que Next.js (proposé par le plan). Astro sort du
HTML statique pur, sans JavaScript inutile : Lighthouse 95-100 presque gratuit, hébergement
quasi gratuit, et il sait aussi faire blog, multi-pages, pages locales SEO, plus tard boutique.

**Types de sites = recettes.** « Vitrine artisan 1 page », « Vitrine Pro 5 pages », puis demain
« Landing de vente », « Site de niche / affiliation », « Annuaire local »… Une recette déclare ses
étapes, ses agents, ses sections, ses contrôles. Ajouter un type de site = ajouter une recette,
pas réécrire le hub.

**Chaîne d'une maquette** (machine à états du hub) :
1. **Brief** auto (données de la fiche entreprise, sources citées)
2. **Directeur artistique web** : thème, variantes, images (banques libres de droits : Pexels/Unsplash)
3. **Rédacteur** : textes locaux, zéro fait inventé, SEO local
4. **Intégrateur** : assemble le projet Astro, construit
5. **Contrôles automatiques** (bloquants, détaillés §4)
6. **Relecteur UX/QOL** : parcours mobile, bouton d'appel visible, devis en 2 clics, lisibilité
7. **Aperçu** dans le hub (mobile + bureau côte à côte) → validation humaine → publication démo

### 2.3 Commercial

- **Séquences** (J0 / J3 / J7 / J14 par défaut, éditables) : email, courrier postal avec QR code
  (via un service de courrier en ligne à API), tâche « appeler » ou SMS.
- **Agent commercial** : personnalise chaque message à partir de la fiche et de la maquette ;
  classe les réponses (intéressé / question / refus / STOP) ; prépare la réponse.
- **Signaux** : les démos sont servies par notre propre hébergement, donc on sait qui ouvre sa
  maquette, quand, combien de temps. Un prospect qui a regardé remonte en tête des appels.
- **Délivrabilité** : domaine d'envoi dédié, préchauffage, plafond quotidien par boîte, surveillance
  des rebonds, liste d'opposition à vie, mention STOP partout. Le hub refuse d'envoyer hors règles.
- **Closing** : fiche d'appel (ce qu'il a vu, ses défauts, l'offre), devis généré en un clic.

### 2.4 Livraison et sites clients

- Formulaire d'onboarding envoyé au client (logo, photos, services, horaires) → les photos
  remplacent les images de banque, le site repasse les contrôles.
- Domaine au nom du client, bascule démo → production, retrait du bandeau et du noindex.
- **Tableau des sites** : un écran qui liste tous les sites clients avec état (en ligne, HTTPS,
  dernier contrôle, score Lighthouse, abonnement, modifications restantes du mois).
- Surveillance de disponibilité + sauvegardes automatiques + alerte.
- **SAV** : une demande arrive (formulaire, email) → l'agent SAV prépare la modification sur une
  copie → contrôles → aperçu → tu valides → déploiement. Compteur « 2 modifications/mois incluses ».

### 2.5 Finance

- Devis et factures conformes (numérotation continue, mentions micro-entreprise, « TVA non
  applicable, art. 293 B du CGI » tant que franchise), PDF.
- Paiement : liens Stripe (acompte / solde), abonnements Stripe Billing, rapprochement automatique
  par webhook (une facture passe « payée » seule).
- Tableau de bord : CA encaissé, MRR (récurrent), impayés, panier moyen, coût d'acquisition
  (API + courriers + emails ramenés à chaque vente), CA à déclarer à l'URSSAF par période,
  alerte avant les plafonds micro-entreprise et franchise de TVA.
- **Facturation électronique** : réception obligatoire pour toutes les entreprises depuis
  septembre 2026, émission obligatoire pour les micro-entreprises en septembre 2027. Le module
  stocke les factures en données structurées dès le départ (export Factur-X / plateforme agréée
  le moment venu) au lieu de simples PDF.

### 2.6 Pilotage

Entonnoir en direct (sourcés → qualifiés → maquettes → envoyés → ouverts → réponses → ventes →
abonnés) comparé aux cibles du plan, par campagne, métier, canal. C'est ce qui dira quoi changer.

---

## 3. L'équipe d'agents et leurs skills

| Agent | Rôle | Modèle | Skills hérités (extraits) |
|---|---|---|---|
| **Directeur** | conversation principale, lance les actions, répond « où en est-on » | Claude | pilotage agence, lecture CRM |
| **Éclaireur** | sourcing, audit des sites existants | code + DeepSeek | NAF du bâtiment, audit web, RGPD prospection |
| **Directeur artistique web** | thème, composition, images, cohérence visuelle | Claude (Opus) | design web pro, typographie, couleur, design par métier, banques d'images et droits |
| **Rédacteur** | textes, SEO local, mentions légales | Claude | copywriting artisan, SEO local, règles « rien d'inventé », mentions légales FR |
| **Intégrateur** | code Astro, performance, formulaires | Claude Code | conventions Astro/Tailwind, bibliothèque de sections, perf web, accessibilité |
| **Contrôleur QA** | vérification des faits, conformité, technique | code + Claude (vision) | grille QA, faits vs sources, WCAG, checklist publication |
| **Relecteur UX/QOL** | expérience mobile, conversion, finitions | Claude (vision) | heuristiques UX, conversion locale, micro-interactions |
| **Commercial** | messages, relances, classement des réponses | Claude (messages) / DeepSeek (tri) | prospection B2B légale, ton sobre, objections, délivrabilité |
| **SAV** | comprend et prépare les modifications | Claude Code | même socle que l'Intégrateur + périmètre abonnement |
| **Comptable** | devis, factures, déclarations | code (aucun LLM sur les montants) | règles micro-entreprise, mentions obligatoires |

**Skills** : chaque agent reçoit son jeu de skills (format SKILL.md, lu nativement par Claude
Code dans le dossier du projet). Je les écris et les maintiens ; la bibliothèque est versionnée,
chaque skill a ses tests (une maquette de référence qui doit toujours passer les contrôles). On
peut ensuite reprendre le mécanisme d'amélioration automatique de Nidavellir (essai mesuré,
quarantaine, retour arrière).

**Coûts** : le travail lourd (design, code, textes finaux) passe par Claude Code sur ton abonnement
Max, comme Nidavellir. DeepSeek prend les tâches de volume où il est aussi bon (extraction sur des
centaines de sites, tri des réponses, premières ébauches). Aucun texte client final ni aucune
ligne de design ne sort de DeepSeek seul.

---

## 4. Contrôles qualité automatiques (bloquants)

1. **Faits** : nom, téléphone, adresse, SIREN identiques aux sources ; tout chiffre, label
   (RGE, Qualibat…) ou ancienneté absent des sources = rejet.
2. **Anti-gabarit** : similarité de texte avec les autres sites du même métier sous un seuil.
3. **Technique** : build OK, Lighthouse mobile ≥ 95 (perf, accessibilité, SEO, bonnes pratiques),
   axe 0 erreur grave, liens et images valides, poids de page plafonné.
4. **Visuel** : captures 375 / 768 / 1440 px relues par vision sur une grille (rien de coupé, vide,
   superposé, contrasté trop faiblement ; bouton d'appel visible sans défiler sur mobile).
5. **Conformité** : bandeau « maquette » + noindex sur les démos ; mentions légales, RGPD du
   formulaire sur les sites livrés.
6. **Note de design** : le DA et le Relecteur notent sur une grille fixe ; sous le seuil, nouvelle
   passe (2 max, puis signalement).

---

## 5. Architecture technique

- **Même socle que Nidavellir, éprouvé** : Node 26 + Fastify + SQLite (`node:sqlite`) côté hub,
  React + Vite côté interface, agents via le CLI `claude`, Electron plus tard pour l'appli de bureau.
  On repart d'un dépôt neuf et propre, en reprenant les modules qui ont fait leurs preuves
  (appel du CLI, pool d'agents, skills, notifications, design de l'interface) — sans traîner tout
  ce qui est propre au jeu vidéo.
- **File de travaux** persistante : chaque action (audit, maquette, envoi) est un travail repris
  après un redémarrage, avec plafond de parallélisme et coût suivi.
- **Hébergement des sites : Cloudflare** (gratuit à ce volume) — démos sur
  `nom.demo.tondomaine.fr` servies par un seul Worker (suivi des visites, suppression à 30 jours
  automatique), sites clients en projets Pages avec leur domaine.
- **Données personnelles** : base locale, purge auto des prospects non convertis à 6 mois,
  registre de traitement généré.
- **Interface** : simple d'abord — barre latérale « Aujourd'hui · Prospects · Commercial ·
  Atelier · Sites · Finance · Équipe », un écran « Aujourd'hui » qui dit quoi faire (à valider,
  à appeler, à facturer). Style Linear/Raycast, animations, mode mouvement réduit.

---

## 6. Feuille de route proposée

| Phase | Contenu | Résultat concret |
|---|---|---|
| **0. Socle** | dépôt, hub, base, interface vide, CLI claude + DeepSeek, file de travaux, skills | l'appli démarre, les agents répondent |
| **1. Atelier v1** | bibliothèque de sections + thèmes, recette « Vitrine artisan », chaîne d'agents, contrôles, aperçu | une maquette de haute qualité générée depuis une fiche saisie à la main |
| **2. Prospection** | campagnes, Sirene + Places, audit, scoring, écran Prospects, « Créer la maquette » | une liste réelle de prospects lyonnais, maquette en un clic |
| **3. Commercial** | démos en ligne (Worker), séquences email, suivi d'ouverture, tri des réponses, opposition | la première campagne de test du plan (semaine 3) |
| **4. Finance + livraison** | devis, factures, Stripe, onboarding, mise en ligne, tableau des sites | encaisser et livrer le premier client |
| **5. SAV + pilotage** | demandes de modification, surveillance, KPI | tenir 30 clients sans y passer ses soirées |
| **6. Nouveaux types** | recettes landing, niche/affiliation, multi-pages Pro | d'autres sources de revenus |

L'atelier passe avant la prospection : sans générateur de maquettes de qualité, une liste de
prospects ne sert à rien, et c'est la partie la plus longue à rendre excellente.

---

## 7. Écarts assumés avec le plan d'origine

- Astro au lieu de Next.js (plus léger, meilleur score, même hébergement).
- Pas de « scraping » des annuaires : API officielles + audit des sites eux-mêmes.
- Démos servies par un Worker unique (suivi des visites, suppression automatique) plutôt qu'un
  déploiement Pages par prospect.
- Bibliothèque de sections + réécriture plutôt que génération libre : qualité constante et vitesse.
- Facturation structurée dès le départ à cause de l'obligation 2027.

## 8. Ce dont j'aurai besoin de toi (au fil des phases, pas maintenant)

Phase 2 : une clé Google Places API. Phase 3 : un domaine principal + un domaine d'envoi, une
boîte email d'envoi. Phase 4 : un compte Stripe, ton SIRET (micro-entreprise créée avant la
première facture), tes mentions légales.
