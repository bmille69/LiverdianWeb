---
name: mentions-legales-fr
description: Use when generating legal notices, privacy policy, form consent text or demo banners for French websites.
---

# Mentions légales et RGPD (sites français)

## Mentions légales (LCEN art. 6) — site livré
- Éditeur : raison sociale ou nom du dirigeant pour un entrepreneur individuel, forme juridique, adresse du siège,
  téléphone, email, SIREN/SIRET, n° RCS ou RM si fourni, n° TVA intracommunautaire si fourni, directeur de la publication.
- Hébergeur : nom, adresse, téléphone (ex. Cloudflare, Inc., 101 Townsend St, San Francisco, CA 94107, USA).
- Réalisation : Liverdian (lien).
- Champs manquants dans les sources : laisser un marqueur `[À COMPLÉTER : …]` sur le site livré → bloque la mise en ligne.
  Sur une démo, la page mentionne qu'il s'agit d'une maquette et reprend les données publiques Sirene.

## Confidentialité (formulaire de devis)
- Finalité : répondre à la demande de devis. Base légale : mesures précontractuelles. Destinataire : l'entreprise seule.
- Durée : 3 ans après le dernier contact. Droits : accès, rectification, effacement, opposition, réclamation CNIL.
- Sous le formulaire, une ligne : « Vos informations servent uniquement à répondre à votre demande. » + lien vers la politique.
- Aucun traceur, aucune police Google chargée depuis Google, aucune carte Google intégrée → pas de bandeau cookies.

## Démo (avant signature)
- Bandeau en haut, non masquable : « Maquette réalisée par Liverdian pour <Entreprise>, non officielle — supprimée le <date> ».
- `<meta name="robots" content="noindex, nofollow">` et robots.txt `Disallow: /`.
- Le formulaire de la démo n'envoie rien à l'entreprise : il affiche un message expliquant que c'est une maquette.
