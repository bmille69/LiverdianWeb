# Kit de sites Liverdian (`packages/site-kit`)

Projet Astro 7 + Tailwind 4 qui fabrique tous les sites clients. Hors workspaces npm : il a son propre
`package.json` et son propre `node_modules`, partagé par jonction avec chaque site généré.

```
packages/site-kit/
  src/schema.ts          schéma zod de site.json (types exportés, messages français)
  src/integration.ts     intégration Astro : validation, contrastes, polices du thème, sitemap
  src/lib/               thèmes, polices, typographie FR, formats (téléphone, dates…), SEO, carte de zone
  src/sections/          sections <Famille><Variante>.astro (HeroPhoto, ServicesCartes…)
  src/components/        briques communes (Section, Surtitre, Icone, Cadre, FormulaireDevis…)
  src/pages/             accueil, mentions-legales, confidentialite, robots.txt, favicon, og.jpg
  src/data/site.json     site par défaut (copie de l'exemple électricien)
  stock/<metier>/        banque d'images libres (Unsplash / Pexels) + stock/CREDITS.json
  examples/<nom>/        3 sites d'exemple (site.json + captures/)
  scripts/new-site.mjs   générateur d'un site client
  scripts/check-site.mjs contrôle automatique (build, Lighthouse, axe, captures)
  scripts/decouper-captures.mjs  captures découpées en tranches d'écran (relecture par vision) + vignette
```

## Installation (une fois)

```bash
cd packages/site-kit
npm install
```

Le navigateur utilisé par les contrôles est Microsoft Edge
(`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, modifiable par la variable `CHROME_PATH`).

## Créer un site

```bash
node scripts/new-site.mjs <dossier-cible> <site.json> [--images <dossier>] [--force]
cd <dossier-cible> && npm run build      # → dist/
```

- Valide le `site.json` ; s'il est invalide : liste des erreurs en français, code de sortie 1.
- Copie `src/`, `astro.config.mjs`, `tsconfig.json`, `package.json`, écrit `src/data/site.json`.
- Copie seulement les images de banque citées (`stock/…`) et leurs crédits (`stock/CREDITS.json`).
- `--images <dossier>` : photos du client copiées dans `photos/` (référencées `photos/<fichier>` dans site.json).
- `node_modules` est une jonction Windows vers celui du kit : aucune installation par site.
- `--force` : régénère un dossier existant (sources et banque remplacées ; `photos/` conservé sauf si `--images`).
- Fonctionne hors du dépôt (ex. `.data/sites/<slug>`). Dernière ligne de stdout : JSON `{ ok, message, cible, slug, images, photos }`.

## Contrôler un site

```bash
node scripts/check-site.mjs <dossier-site> [--sans-build] [--runs <n>]
```

Build → service local de `dist/` (gzip, cache long sur `/_astro/`, comme Cloudflare) → Lighthouse mobile →
axe-core (375 et 1440 px) → captures → contrôles. Sorties dans `<dossier-site>/.check/` :

| Fichier | Contenu |
|---|---|
| `check-report.json` | rapport (format ci-dessous) |
| `capture-375.png`, `capture-768.png`, `capture-1440.png` | pages entières |
| `capture-375-initial.png` | écran initial mobile 375×667 (sans défilement) |
| `lighthouse.json`, `build.log` | données brutes |

Code de sortie : `0` tout passe, `1` au moins un contrôle bloquant échoue, `2` erreur technique.
Dernière ligne de stdout : `{ "ok": bool, "rapport": "<chemin>", "echecs": ["…"] }`.

### Format de `check-report.json` (version 1)

```jsonc
{
  "version": 1,
  "site": "C:\\…\\mon-site", "date": "2026-11-02T…Z",
  "ok": true,                       // aucun échec bloquant
  "demo": true,                     // site.json > demo.actif
  "seuils": { "lighthouse": 95, "poidsMaxOctets": 1048576 },
  "build": { "ok": true, "dureeMs": 9000, "avertissements": [], "erreur": "…si échec" },
  "lighthouse": {
    "performance": 100, "accessibilite": 100, "bonnesPratiques": 100, "seo": 66,
    "seoNote": "démo : … noindex …",   // présent en démo : SEO hors seuil
    "metriques": { "fcpMs", "lcpMs", "tbtMs", "cls", "speedIndexMs", "poidsOctets" },
    "auditsRates": { "performance": [{ "id", "titre", "score" }], "accessibilite": [], "bonnesPratiques": [], "seo": [] },
    "runs": 1, "performancesMesurees": [ … ]  // si --runs > 1 (médiane retenue)
  },
  "axe": { "graves": 0, "violations": [{ "id", "impact", "aide", "url", "noeuds", "exemples": [] }] },
  "controles": [{ "id": "defilement-horizontal 375px", "ok": true, "bloquant": true, "detail": "aucun" }],
  "captures": { "375": "capture-375.png", "768": "…", "1440": "…", "initial": "capture-375-initial.png" },
  "echecs": ["id : détail", …]       // contrôles bloquants ratés
}
```

Le hub (atelier) lance ensuite `node scripts/decouper-captures.mjs <site>/.check <site>/.atelier/revue` : chaque
capture pleine page est découpée en tranches de la hauteur d'un écran, dans l'ordre de la page, et une vignette
`<site>/.atelier/vignette.jpg` (haut de la page bureau) sert à la liste des sites.

`entreprise.siren` et `entreprise.naf` sont facultatifs (fiche saisie à la main) ; sans SIREN, les mentions légales
d'une démo affichent « non communiqué (maquette) ». Sans horaires, le pied de page n'en invente pas : il donne le téléphone.

Contrôles (`controles[].id`) : `build-sans-avertissement` (non bloquant), `texte-interdit <page>`
(`[À COMPLÉTER`, `undefined`, `lorem`, `NaN`), `h1-unique <page>`, `lang-fr <page>`, `liens-internes`,
`json-ld`, `lighthouse-performance|accessibilite|bonnes-pratiques` (≥ 95), `lighthouse-seo` (≥ 95, hors démo) ou
`lighthouse-seo-hors-noindex` (démo : seul `is-crawlable` peut échouer), `poids-page` (≤ 1 Mo), `cls` (≤ 0,05),
`defilement-horizontal <l>px`, `images-cassees <l>px`, `axe-graves` (0 violation serious/critical),
`appel-visible-ecran-initial`, et en démo `demo-bandeau <page>`, `demo-noindex <page>`, `demo-robots`,
`demo-bandeau-visible` ; hors démo `formulaire-destination`.

## Développer le kit

```bash
npm run dev       # sert src/data/site.json (exemple électricien)
npm run build
npx astro check   # types
```

Les règles de conception (sections, variantes, jetons) sont décrites pour les agents dans
`skills/dev/astro-site-kit/SKILL.md`, section « API du kit ».

## Images

`stock/CREDITS.json` liste chaque photo : fichier, métier, auteur, URL source, licence (Unsplash License /
Pexels License, usage commercial libre), description, orientation, dimensions, aptitude au hero.
