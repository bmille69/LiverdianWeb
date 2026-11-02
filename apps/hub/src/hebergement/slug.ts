/**
 * Slug d'une démo : dérivé du nom commercial, sans accents, stable une fois publié.
 * Format : `[a-z0-9-]{1,63}`, sans tiret aux extrémités (accepté par le Worker et par les DNS).
 */

export function slugifier(nom: string): string {
  const sansAccents = nom.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const s = sansAccents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return s || "demo";
}

/** Base avec suffixe numérique tant qu'elle est déjà prise (`mon-site`, `mon-site-2`, …). */
export function slugUnique(base: string, pris: Set<string>): string {
  let s = base;
  for (let n = 2; pris.has(s); n++) s = `${base.slice(0, 63 - String(n).length - 1)}-${n}`;
  return s;
}

/**
 * Sous-domaines jamais attribués à une démo : les démos vivent directement sous le domaine
 * (`<slug>.<domaine>`, seul niveau couvert par le certificat gratuit de Cloudflare).
 */
export const SLUGS_RESERVES: readonly string[] = ["www", "mail", "smtp", "imap", "pop", "webmail", "mx", "ftp", "demo", "demos", "app", "api", "admin", "hub", "blog", "contact", "shop", "boutique", "status", "liverdian", "autoconfig", "autodiscover"];
