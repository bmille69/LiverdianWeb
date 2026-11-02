/**
 * Typographie française appliquée automatiquement aux textes du site.json.
 * - espace fine insécable (U+202F) avant ; ! ? et à l'intérieur des guillemets « »
 * - espace insécable (U+00A0) avant :
 * - apostrophe typographique ’
 * - espace insécable entre un nombre et son unité courante (km, €, %, h, min, m²)
 */
const FINE = " ";
const INSEC = " ";

export function typoFr(s: string): string {
  let t = s;
  // Apostrophe droite entre lettres → ’
  t = t.replace(/([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])/g, "$1’$2");
  // Guillemets droits appariés → « »
  t = t.replace(/"([^"]+)"/g, "«$1»");
  // Espaces dans les guillemets français
  t = t.replace(/«[   ]*/g, `«${FINE}`).replace(/[   ]*»/g, `${FINE}»`);
  // ; ! ? : espace fine insécable (remplace une espace existante, ou s'insère après un mot)
  t = t.replace(/([^\s;!?(«])[   ]?([;!?]+)(?=[\s»).,]|$)/g, `$1${FINE}$2`);
  // Deux-points suivis d'une espace ou en fin de texte (évite https://, 14:30)
  t = t.replace(/([^\s:])[   ]?:(?=\s|$)/g, `$1${INSEC}:`);
  // Nombre + unité
  t = t.replace(/(\d) (km|€|%|h|min|m²|m2|ans|cm|mm)(?![A-Za-zÀ-ÿ])/g, `$1${INSEC}$2`);
  // Tiret d'incise entouré d'espaces : insécable avant
  t = t.replace(/ — /g, `${INSEC}— `);
  return t;
}

/** Clés dont la valeur n'est jamais du texte affiché (pas de retouche typographique). */
const CLES_BRUTES = new Set([
  "url",
  "agenceUrl",
  "action",
  "email",
  "telephone",
  "siren",
  "siret",
  "naf",
  "tva",
  "codePostal",
  "fichier",
  "focale",
  "slug",
  "image",
  "icone",
  "ancre",
  "preset",
  "signature",
  "variante",
  "type",
  "metier",
  "titres",
  "corps",
  "ouverture",
  "fermeture",
  "dateCreation",
  "dateSuppression",
  "jours",
]);

/** Applique `typoFr` à toutes les chaînes affichées d'un objet (copie profonde). */
export function typoFrProfond<T>(v: T, cle?: string): T {
  if (typeof v === "string") return (cle && CLES_BRUTES.has(cle) ? v : typoFr(v)) as T;
  if (Array.isArray(v)) return v.map((x) => typoFrProfond(x, cle)) as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = cle === "couleurs" ? x : typoFrProfond(x, k);
    return o as T;
  }
  return v;
}
