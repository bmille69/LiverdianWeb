/**
 * Catalogue lisible du kit pour le Directeur artistique : ce que fait chaque variante de section, chaque signature,
 * chaque valeur de mise en page et de palette. Le hub l'injecte tel quel dans le prompt du DA.
 * Une variante ajoutée au schéma sans description ici est signalée par le test du hub (catalogue complet).
 */
import type { MISE, PALETTE, SIGNATURES, VARIANTES, ENTETES, PIEDS } from "./schema.ts";

type Desc<T extends Record<string, readonly string[]>> = { [K in keyof T]: Record<T[K][number], string> };

export const CATALOGUE_VARIANTES: Desc<typeof VARIANTES> = {
  hero: {
    photo: "Photo plein cadre, voile dégradé, texte en bas à gauche par-dessus. Seulement avec une photo excellente ET calme côté texte (hero:true).",
    typo: "Sans photo : très grand titre sur fond teinté texturé (motif signature), mot géant en contour, fiche contact sombre à droite.",
    scinde: "Texte à gauche sur fond clair, grande photo cadrée à droite (cadre du site). Sûr avec une belle photo chargée.",
    panorama: "Grand titre et boutons en haut sur fond clair (2 colonnes au bureau), puis une photo panoramique pleine largeur dessous. Éditorial, aéré.",
    encart: "Photo pleine largeur et texte dans un panneau plein posé en bas à gauche, qui chevauche la photo au bureau ; jamais de texte sur la photo.",
  },
  services: {
    cartes: "Titre collant à gauche, cartes 2 colonnes (icône, numéro, titre, texte). 4 à 8 prestations.",
    liste: "Liste éditoriale numérotée, une ligne par prestation avec points concrets ; photo du 1er service à côté au bureau. 2 à 5 prestations.",
    bandes: "Une bande par prestation, photo et texte en alternance gauche/droite. 2 à 4 prestations, une photo chacune.",
    index: "Sommaire éditorial sans image : 2 colonnes, titres en grand avec points de conduite et filets fins. 3 à 8 prestations.",
    tuiles: "Grille de tuiles sur fond teinté, grande icône dans un carré d'accent ; la première tuile peut être mise en avant. 3 à 7 prestations.",
  },
  pourquoi: {
    colonnes: "2 à 4 arguments sobres côte à côte, filet au-dessus de chacun.",
    manifeste: "Fond sombre, grande phrase-titre à gauche (photo facultative), arguments numérotés à droite. Casse le rythme.",
    etapes: "Arguments en étapes numérotées reliées par un trait (horizontal au bureau, vertical sur mobile), gros numéros d'accent.",
    encadre: "Grande photo cadrée à gauche (image requise), titre et arguments à icônes dans un bloc bordé à droite.",
  },
  realisations: {
    mosaique: "Grande photo + vignettes en grille asymétrique, légendes en étiquette. 3 à 8 photos (5 idéal).",
    grille: "Vignettes régulières, légende sous chaque photo. 3, 6 ou 8 photos.",
    bande: "Bande de photos hautes qui défile horizontalement (sans JavaScript), légendes dessous. 4 à 8 photos ; belle sur fond sombre.",
    diptyque: "Deux grandes photos côte à côte (la seconde décalée), légendes éditoriales numérotées, puis vignettes. 2 à 6 photos.",
  },
  avis: {
    badge: "Note Google en très grand, centrée, lien vers la fiche.",
    bandeau: "Bande compacte (sombre) : titre à gauche, note et lien à droite.",
  },
  zone: {
    carte: "Carte SVG schématique (siège, communes à leur position, anneaux en km) + pastilles des communes. Demande les coordonnées.",
    liste: "Commune du siège en très grand + voisines en colonnes typographiques.",
    tableau: "Tableau des communes triées par distance à vol d'oiseau (calculée), colonne de gauche avec titre et téléphone.",
    bandeau: "Bande compacte (sombre) : siège en très grand, voisines en ligne. Section courte.",
  },
  appel: {
    bande: "Relance pleine largeur sombre, titre court + gros bouton téléphone ; photo facultative très voilée.",
    carte: "Relance douce dans une carte sombre arrondie avec photo.",
  },
  devis: {
    scinde: "Coordonnées à gauche, formulaire dans une carte à droite.",
    encadre: "Fin de page solennelle sur fond sombre, formulaire centré dans une carte claire.",
    plein: "Titre en haut, bandeau de coordonnées (téléphone en gros), formulaire large dans une carte.",
    appel: "Téléphone d'abord : grand bloc sombre avec le numéro en très grand, horaires, adresse ; formulaire à côté.",
  },
};

export const CATALOGUE_ENTETES: Record<(typeof ENTETES)[number], string> = {
  simple: "Une barre : logo, menu, téléphone, bouton devis.",
  double: "Barre + bandeau d'informations sombre au-dessus (adresse, horaires, note) sur tablette/bureau.",
  centre: "Logo centré, téléphone à gauche et devis à droite, menu centré sur une seconde ligne (bureau).",
};

export const CATALOGUE_PIEDS: Record<(typeof PIEDS)[number], string> = {
  complet: "Fond sombre, 4 colonnes (identité, coordonnées, horaires, zone) + ligne légale.",
  sobre: "Fond teinté, deux lignes compactes.",
  signature: "Nom de l'entreprise composé en très grand sur toute la largeur, puis colonnes compactes et ligne légale.",
};

export const CATALOGUE_SIGNATURES: Record<(typeof SIGNATURES)[number], string> = {
  faisceau: "Trame de plan technique (quadrillage fin, repères en croix) ; cadres à équerres.",
  onde: "Ondulations fines ; cadres simples.",
  isobares: "Cercles concentriques (chaleur, diffusion) ; cadres simples.",
  tuiles: "Écailles de tuiles canal ; cadres en arche.",
  veinage: "Veines de bois ; cadres décalés.",
  aplat: "Hachures fines d'atelier ; cadres décalés.",
  cotes: "Lignes de cote d'un plan (traits, flèches, repères) ; cadres à équerres.",
  points: "Trame de points (similigravure) ; cadres à coin d'accent.",
  chevrons: "Chevrons en zigzag ; cadres à liseré.",
  briques: "Appareillage de briques à joints décalés ; cadres à coin d'accent.",
  rayures: "Larges rayures diagonales de chantier, très discrètes ; cadres à liseré.",
  topo: "Courbes de niveau d'une carte ; cadres simples.",
};

export const CATALOGUE_MISE: Desc<typeof MISE> = {
  echelle: {
    equilibree: "Titres de taille standard.",
    sobre: "Titres plus petits, page calme et dense en information.",
    affirmee: "Titres plus grands.",
    monumentale: "Titres très grands au bureau : affiche, impact.",
  },
  densite: {
    standard: "Respiration verticale normale (64/96/128 px).",
    compacte: "Sections plus serrées : page courte, efficace.",
    aeree: "Beaucoup d'air : haut de gamme, posé.",
  },
  images: {
    naturel: "Photos telles quelles.",
    franc: "Photos à bords francs (sans arrondi), même si le reste est arrondi.",
    "passe-partout": "Photos dans un passe-partout clair avec ombre portée légère.",
    duotone: "Photos désaturées teintées par l'accent (duotone léger) : très reconnaissable.",
    contraste: "Photos un peu plus contrastées et saturées.",
  },
  cadre: {
    auto: "Cadre de la signature.",
    simple: "Coins arrondis seulement.",
    equerres: "Équerres d'accent aux quatre coins.",
    decale: "Aplat d'accent décalé derrière la photo.",
    arche: "Haut cintré.",
    lisere: "Contour d'accent décalé.",
    coin: "Bloc d'accent plein dans l'angle supérieur droit.",
  },
  boutons: {
    plein: "Boutons pleins au rayon du thème.",
    pilule: "Boutons entièrement arrondis.",
    marque: "Boutons carrés avec ombre portée pleine décalée (style affiche).",
    carre: "Boutons carrés en capitales espacées.",
  },
  rythme: {
    alterne: "Alternance standard clair / teinté / sombre.",
    contraste: "Plus de sections sombres : fort contraste.",
    clair: "Presque tout clair, le sombre réservé aux bandes d'appel et d'avis.",
    chaud: "Page teintée, sections claires en respiration.",
  },
  titres: { normale: "Titres en casse normale.", capitales: "Titres en capitales (superbe avec une police condensée)." },
  surtitres: {
    marqueur: "Surtitre précédé du marqueur de la signature.",
    filet: "Surtitre précédé d'un filet.",
    pastille: "Surtitre dans une pastille à contour.",
    simple: "Surtitre seul.",
  },
};

export const CATALOGUE_PALETTE: Desc<typeof PALETTE> & { teinte: string; accent: string } = {
  teinte: "Teinte (0–359°, cercle OKLCH) des neutres et du fond sombre : 20-60 terre/brun chaud, 80-110 sable/olive, 140-170 vert, 190-230 bleu-vert/bleu acier, 240-270 bleu nuit/indigo, 280-330 prune.",
  accent: "Teinte de l'accent (boutons, liens) : 20-40 rouge brique/corail, 45-70 orange/cuivre, 80-100 ambre/jaune, 120-160 vert, 180-210 cyan/pétrole, 230-270 bleu, 290-340 violet/framboise.",
  vivacite: { franche: "Accent franc.", sourde: "Accent assourdi, élégant.", vive: "Accent très saturé, énergique." },
  accentTon: { clair: "Accent lumineux, texte foncé dessus (jaune, ambre, corail clair…).", fonce: "Accent profond, texte blanc dessus." },
  neutres: { teintes: "Neutres légèrement teintés.", gris: "Neutres presque gris.", colores: "Neutres nettement colorés." },
  fond: { casse: "Fond blanc cassé.", blanc: "Fond blanc franc.", teinte: "Fond nettement teinté." },
  sombre: { profond: "Sombre profond coloré par la teinte.", nuit: "Sombre presque noir.", colore: "Sombre franchement coloré (vert sapin, bleu pétrole, aubergine…)." },
};
