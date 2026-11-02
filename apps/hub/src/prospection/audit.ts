import { z } from "zod";
import { messageReseau, type Reseau } from "./reseau.ts";
import type { StatutSite } from "./scoring.ts";
import { domaineDe } from "./texte.ts";

/**
 * Audit du site actuel d'un prospect (skill `prospection/audit-site-existant`). Le code relève tout ce qui se mesure :
 * réponse, redirections, HTTPS et certificat, balise viewport, année du copyright, technologie, emails visibles
 * (accueil + une page contact ou mentions au plus), puis Lighthouse mobile léger via Edge. Seul le flou (franchise ?
 * vrai site ? quel email ?) est confié à l'Éclaireur, sur des extraits exacts ; sa réponse est revérifiée par le code.
 * Politesse : robots.txt respecté, user-agent identifiable, au plus 3 requêtes HTML par site, rien de la page gardé
 * en dehors des relevés.
 */

export type Preuve = { constat: string; url: string | null };
export type Lighthouse = { performance: number; accessibilite: number; lcpMs: number | null } | { erreur: string };

export type AuditSite = {
  version: 1;
  le: string;
  url: string;
  urlFinale: string | null;
  statutSite: StatutSite;
  https: boolean | null;
  certificat: "valide" | "invalide" | null;
  redirections: string[];
  mobile: boolean | null;
  anneeCopyright: number | null;
  derniereModif: string | null;
  technologies: string[];
  techDatee: string | null;
  email: string | null;
  emailsTrouves: string[];
  robots: "permis" | "interdit" | "absent";
  lighthouse: Lighthouse | null;
  franchise: { oui: boolean; raison: string } | null;
  vraiSite: "oui" | "annuaire" | "en_construction" | "autre_activite" | "incertain" | null;
  flou: { fournisseur: string; modele: string } | { erreur: string } | null;
  pagesVisitees: string[];
  preuves: Preuve[];
};

export const Flou = z.object({
  franchise: z.boolean().nullable().describe("true seulement si un extrait montre une franchise, une enseigne nationale ou un réseau"),
  franchise_preuve: z.string().nullable().describe("Extrait exact qui le montre, ou null"),
  vrai_site: z.enum(["oui", "annuaire", "en_construction", "autre_activite", "incertain"]).describe("oui = site propre de cette entreprise"),
  vrai_site_preuve: z.string().nullable(),
  email: z.string().nullable().describe("Email professionnel à retenir, choisi parmi la liste relevée, sinon null"),
  email_preuve: z.string().nullable(),
});
export type Flou = z.infer<typeof Flou>;

export type ExtraitFlou = { entreprise: string; commune: string | null; url: string; titre: string | null; description: string | null; titres: string[]; debut: string; fin: string; emails: string[]; liensExternes: string[] };
export type ExtracteurFlou = (e: ExtraitFlou, signal?: AbortSignal) => Promise<{ flou: Flou; fournisseur: string; modele: string }>;
export type LighthouseRunner = (url: string, signal?: AbortSignal) => Promise<Lighthouse>;

/** Domaines qui ne sont pas un vrai site de l'entreprise (annuaire, réseau social, page de mise en relation). */
const ANNUAIRES = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "pagesjaunes.fr",
  "linktr.ee",
  "business.site",
  "g.page",
  "google.com",
  "houzz.fr",
  "habitatpresto.com",
  "travaux.com",
  "starofservice.com",
  "118712.fr",
  "societe.com",
  "mappy.com",
  "yelp.fr",
  "leboncoin.fr",
  "kompass.com",
  "infobel.com",
  "annuaire-entreprises.data.gouv.fr",
  "doctolib.fr",
  "planity.com",
  "treatwell.fr",
];

export function estAnnuaire(url: string): string | null {
  const d = domaineDe(url);
  if (!d) return null;
  return ANNUAIRES.find((a) => d === a || d.endsWith(`.${a}`)) ?? null;
}

/** robots.txt : le groupe « liverdianaudit » s'il existe, sinon « * » ; la règle la plus longue l'emporte. */
export function robotsPermet(robots: string, chemin: string, agent = "liverdianaudit"): boolean {
  const groupes: { agents: string[]; regles: { allow: boolean; path: string }[] }[] = [];
  let courant: (typeof groupes)[number] | null = null;
  let dernierEtaitAgent = false;
  for (const brute of robots.split(/\r?\n/)) {
    const ligne = brute.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(ligne);
    if (!m) continue;
    const cle = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (cle === "user-agent") {
      if (!courant || !dernierEtaitAgent) {
        courant = { agents: [], regles: [] };
        groupes.push(courant);
      }
      courant.agents.push(val.toLowerCase());
      dernierEtaitAgent = true;
    } else {
      dernierEtaitAgent = false;
      if (!courant) continue;
      if (cle === "disallow" && val) courant.regles.push({ allow: false, path: val });
      if (cle === "allow" && val) courant.regles.push({ allow: true, path: val });
    }
  }
  const groupe = groupes.find((g) => g.agents.some((a) => a !== "*" && agent.includes(a))) ?? groupes.find((g) => g.agents.includes("*"));
  if (!groupe) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of groupe.regles) {
    const motif = r.path.replace(/\$$/, "");
    const re = new RegExp("^" + motif.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
    if (re.test(chemin) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

function decoder(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&copy;|&#169;|&#xa9;/gi, "©")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&eacute;/gi, "é")
    .replace(/&egrave;/gi, "è")
    .replace(/&agrave;/gi, "à")
    .replace(/&ccedil;/gi, "ç");
}

export function texteVisible(html: string): string {
  return decoder(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|footer|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_IGNORES = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(sentry|wixpress|example|domain|email|votre|exemple)\.|^(nom|name|user|exemple|example|votre|your)@/i;

export function emailsDe(html: string): string[] {
  const brut = decoder(html).replace(/\s*(\[at\]|\(at\)|\[arobase\])\s*/gi, "@");
  const set = new Set<string>();
  for (const m of brut.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase().replace(/^mailto:/, "").replace(/\.$/, "");
    if (!EMAIL_IGNORES.test(e)) set.add(e);
  }
  return [...set].slice(0, 10);
}

/** Année la plus récente d'un « © 2012 », « Copyright 2010-2019 », « © … 2018 » (bornée à l'année en cours). */
export function anneeCopyright(texte: string, maintenant: Date): number | null {
  const max = maintenant.getFullYear();
  let best: number | null = null;
  const re = /(?:©|\(c\)|copyright)[^\n\d]{0,40}((?:19|20)\d{2})(?:\s*[-–à]\s*((?:19|20)\d{2}))?/gi;
  for (const m of texte.matchAll(re)) {
    for (const g of [m[1], m[2]]) {
      const y = g ? Number(g) : NaN;
      if (y >= 1995 && y <= max && (best == null || y > best)) best = y;
    }
  }
  return best;
}

export function technologies(html: string, headers: Headers | null): { liste: string[]; datee: string | null } {
  const l: string[] = [];
  let datee: string | null = null;
  const gen = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/i.exec(html)?.[1] ?? null;
  if (gen) l.push(gen.slice(0, 60));
  const t = (re: RegExp, nom: string) => re.test(html) && !l.some((x) => x.toLowerCase().includes(nom.toLowerCase())) && l.push(nom);
  t(/wp-content|wp-includes/i, "WordPress");
  t(/wixstatic\.com|_wixCssImports|wix-code/i, "Wix");
  t(/jimdo/i, "Jimdo");
  t(/\/media\/jui\/|joomla/i, "Joomla");
  t(/drupal/i, "Drupal");
  t(/prestashop/i, "PrestaShop");
  t(/cdn\.shopify\.com/i, "Shopify");
  t(/squarespace/i, "Squarespace");
  t(/webflow/i, "Webflow");
  t(/e-monsite/i, "e-monsite");
  t(/solocal|pagesjaunes/i, "Solocal");
  if (headers?.get("x-wix-request-id")) t(/./, "Wix");
  if (/jquery[.-]?(1\.\d+)/i.test(html)) datee = `jQuery ${/jquery[.-]?(1\.\d+(?:\.\d+)?)/i.exec(html)![1]}`;
  if (/\.swf\b|shockwave-flash/i.test(html)) datee = "animation Flash";
  if (gen && /frontpage|dreamweaver|iweb|publisher|netobjects/i.test(gen)) datee = `généré par ${gen.slice(0, 40)}`;
  const tables = (html.match(/<table[^>]*\bwidth=/gi) ?? []).length;
  if (!datee && tables >= 3 && !/<meta[^>]+viewport/i.test(html)) datee = "mise en page en tableaux";
  return { liste: l.slice(0, 6), datee };
}

function viewportMobile(html: string): { mobile: boolean; viewport: string | null } {
  const m = /<meta[^>]+name=["']viewport["'][^>]*content=["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']viewport["']/i.exec(html);
  const v = m?.[1] ?? null;
  return { mobile: !!v && /width\s*=\s*device-width/i.test(v), viewport: v };
}

function liensContact(html: string, base: URL): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!;
    const texte = texteVisible(m[2]!).toLowerCase();
    if (!/contact|mentions|legal|l[ée]gales|nous-trouver|coordonn/i.test(href + " " + texte)) continue;
    try {
      const u = new URL(href, base);
      if (u.host === base.host && /^https?:$/.test(u.protocol) && u.pathname !== base.pathname) out.push(u.toString());
    } catch {
      /* lien invalide */
    }
  }
  // Contact d'abord (l'email y est le plus souvent), mentions ensuite.
  return [...new Set(out)].sort((a, b) => Number(/mention|legal/i.test(a)) - Number(/mention|legal/i.test(b)));
}

function liensExternes(html: string, base: URL): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const d = domaineDe(m[1]!);
    if (d && d !== domaineDe(base.toString())) set.add(d);
  }
  return [...set].slice(0, 15);
}

const CERT = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i;
const MAX_OCTETS = 2_000_000;

async function lireTexte(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
    if (total > MAX_OCTETS) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(parts));
}

type Page = { url: string; status: number; html: string; headers: Headers; redirections: string[] };

/** GET avec redirections suivies à la main (5 au plus) pour garder la chaîne exacte. */
async function charger(reseau: Reseau, depart: string, signal?: AbortSignal): Promise<Page> {
  let url = depart;
  const redirections: string[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await reseau.requete(url, { redirect: "manual", signal, timeoutMs: 15_000, essais: 1, headers: { accept: "text/html,application/xhtml+xml" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      const next = new URL(res.headers.get("location")!, url).toString();
      redirections.push(`${res.status} → ${next}`);
      url = next;
      continue;
    }
    const type = res.headers.get("content-type") ?? "";
    const html = /html|xml|text\/plain/i.test(type) || !type ? await lireTexte(res) : (await res.body?.cancel().catch(() => {}), "");
    return { url, status: res.status, html, headers: res.headers, redirections };
  }
  throw new Error("trop de redirections");
}

export type AuditDeps = { reseau: Reseau; flou?: ExtracteurFlou | null; lighthouse?: LighthouseRunner | null; maintenant?: () => Date };

export function urlNormalisee(url: string): string {
  const u = url.trim();
  const brute = /^https?:\/\//i.test(u) ? u : `http://${u}`;
  try {
    return new URL(brute).toString();
  } catch {
    return brute;
  }
}

export async function auditerSite(entree: { url: string; entreprise: string; commune: string | null; lighthouse?: boolean }, deps: AuditDeps, signal?: AbortSignal): Promise<AuditSite> {
  const maintenant = deps.maintenant?.() ?? new Date();
  const url = urlNormalisee(entree.url);
  const a: AuditSite = {
    version: 1,
    le: maintenant.toISOString(),
    url,
    urlFinale: null,
    statutSite: "inconnu",
    https: null,
    certificat: null,
    redirections: [],
    mobile: null,
    anneeCopyright: null,
    derniereModif: null,
    technologies: [],
    techDatee: null,
    email: null,
    emailsTrouves: [],
    robots: "absent",
    lighthouse: null,
    franchise: null,
    vraiSite: null,
    flou: null,
    pagesVisitees: [],
    preuves: [],
  };
  const preuve = (constat: string, u: string | null = null) => a.preuves.push({ constat, url: u });

  const annuaire = estAnnuaire(url);
  if (annuaire) {
    a.statutSite = "annuaire_seulement";
    a.vraiSite = "annuaire";
    preuve(`L'adresse déclarée est une page ${annuaire}, pas un site propre à l'entreprise`, url);
    return a;
  }
  let base: URL;
  try {
    base = new URL(url);
  } catch {
    a.statutSite = "injoignable";
    preuve(`Adresse de site invalide : ${entree.url}`);
    return a;
  }

  // robots.txt : on le lit en HTTPS d'abord, en HTTP sinon. Absent = visite permise.
  let robotsTxt: string | null = null;
  for (const proto of ["https:", "http:"]) {
    try {
      const r = await deps.reseau.requete(`${proto}//${base.host}/robots.txt`, { signal, timeoutMs: 8000, essais: 1 });
      if (r.ok && /text\/plain/i.test(r.headers.get("content-type") ?? "text/plain")) robotsTxt = (await lireTexte(r)).slice(0, 50_000);
      else await r.body?.cancel().catch(() => {});
      break;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  const permis = (u: string) => !robotsTxt || robotsPermet(robotsTxt, new URL(u).pathname || "/");
  if (robotsTxt) a.robots = permis(url) ? "permis" : "interdit";
  if (a.robots === "interdit") {
    preuve("robots.txt interdit la visite automatique : site non audité (il existe)", `${base.protocol}//${base.host}/robots.txt`);
    return a;
  }

  // Accueil, avec la chaîne de redirections.
  let page: Page | null = null;
  try {
    page = await charger(deps.reseau, url, signal);
    a.pagesVisitees.push(page.url);
  } catch (err) {
    if (signal?.aborted) throw err;
    const m = messageReseau(err);
    if (base.protocol === "https:" && CERT.test(m)) {
      a.certificat = "invalide";
      a.https = false;
      preuve(`Certificat HTTPS refusé (${m})`, url);
      // On retente en HTTP pour juger le reste du site.
      try {
        page = await charger(deps.reseau, url.replace(/^https:/, "http:"), signal);
        a.pagesVisitees.push(page.url);
      } catch {
        /* rien de plus */
      }
    }
    if (!page) {
      a.statutSite = "injoignable";
      preuve(`Le site ne répond pas (${m})`, url);
      return a;
    }
  }
  a.redirections = page.redirections;
  a.urlFinale = page.url;
  if (page.status >= 400) {
    a.statutSite = "injoignable";
    preuve(`Le site répond ${page.status}`, page.url);
    return a;
  }

  // HTTPS : la page finale est-elle servie en HTTPS (certificat valide, sinon fetch aurait échoué) ?
  if (a.certificat !== "invalide") {
    if (page.url.startsWith("https:")) {
      a.https = true;
      a.certificat = "valide";
      preuve(page.redirections.length ? `Redirige vers HTTPS (${page.redirections.at(-1)})` : "Servi en HTTPS, certificat valide", page.url);
    } else {
      // Pas de redirection : la version HTTPS existe-t-elle avec un certificat valide ?
      try {
        const r = await deps.reseau.requete(page.url.replace(/^http:/, "https:"), { method: "HEAD", redirect: "manual", signal, timeoutMs: 10_000, essais: 1 });
        await r.body?.cancel().catch(() => {});
        a.certificat = "valide";
        a.https = false;
        preuve("Le site reste en HTTP : pas de redirection vers HTTPS (une version HTTPS existe)", page.url);
      } catch (err) {
        if (signal?.aborted) throw err;
        a.https = false;
        a.certificat = CERT.test(messageReseau(err)) ? "invalide" : null;
        preuve(`Pas de HTTPS (${messageReseau(err)})`, page.url);
      }
    }
  }

  const html = page.html;
  const vp = viewportMobile(html);
  a.mobile = vp.mobile;
  preuve(vp.viewport ? `Balise viewport : « ${vp.viewport.slice(0, 80)} »${vp.mobile ? "" : " (pas width=device-width)"}` : "Aucune balise viewport : page non adaptée au mobile", page.url);
  const texte = texteVisible(html);
  a.anneeCopyright = anneeCopyright(texte, maintenant);
  if (a.anneeCopyright) preuve(`Copyright ${a.anneeCopyright}`, page.url);
  const lm = page.headers.get("last-modified");
  if (lm && !Number.isNaN(Date.parse(lm))) a.derniereModif = new Date(lm).toISOString().slice(0, 10);
  const tech = technologies(html, page.headers);
  a.technologies = tech.liste;
  a.techDatee = tech.datee ?? (a.derniereModif && Number(a.derniereModif.slice(0, 4)) < maintenant.getFullYear() - 5 ? `dernière modification le ${a.derniereModif}` : null);
  if (tech.liste.length) preuve(`Technologie : ${tech.liste.join(", ")}`, page.url);
  if (a.techDatee) preuve(`Indice d'âge : ${a.techDatee}`, page.url);
  const emails = new Set(emailsDe(html));

  // Une page contact ou mentions au plus (politesse), si l'accueil ne montre pas d'email.
  const finale = new URL(page.url);
  if (!emails.size) {
    const lien = liensContact(html, finale).find(permis);
    if (lien) {
      try {
        await deps.reseau.attendre(1000, signal);
        const p2 = await charger(deps.reseau, lien, signal);
        a.pagesVisitees.push(p2.url);
        for (const e of emailsDe(p2.html)) emails.add(e);
        if (!a.anneeCopyright) a.anneeCopyright = anneeCopyright(texteVisible(p2.html), maintenant);
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
  }
  a.emailsTrouves = [...emails];
  if (a.emailsTrouves.length) preuve(`Email(s) visible(s) : ${a.emailsTrouves.join(", ")}`, a.pagesVisitees.at(-1) ?? page.url);

  // Lighthouse mobile léger (une mesure, performance + accessibilité).
  if (entree.lighthouse !== false && deps.lighthouse) {
    try {
      a.lighthouse = await deps.lighthouse(page.url, signal);
      if ("performance" in a.lighthouse) preuve(`Lighthouse mobile : performance ${a.lighthouse.performance}/100, accessibilité ${a.lighthouse.accessibilite}/100`, page.url);
    } catch (err) {
      if (signal?.aborted) throw err;
      a.lighthouse = { erreur: (err as Error).message.slice(0, 200) };
    }
  }

  // Le flou, à l'Éclaireur, sur des extraits exacts.
  if (deps.flou) {
    const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    const desc = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
    const extrait: ExtraitFlou = {
      entreprise: entree.entreprise,
      commune: entree.commune,
      url: page.url,
      titre: titre ? decoder(titre).trim().slice(0, 200) : null,
      description: desc ? decoder(desc).trim().slice(0, 300) : null,
      titres: [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => texteVisible(m[1]!)).filter(Boolean).slice(0, 8).map((s) => s.slice(0, 140)),
      debut: texte.slice(0, 1500),
      fin: texte.length > 1500 ? texte.slice(-1200) : "",
      emails: a.emailsTrouves,
      liensExternes: liensExternes(html, finale),
    };
    try {
      const r = await deps.flou(extrait, signal);
      a.flou = { fournisseur: r.fournisseur, modele: r.modele };
      const f = r.flou;
      a.vraiSite = f.vrai_site;
      if (f.franchise) a.franchise = { oui: true, raison: `Franchise ou réseau : ${f.franchise_preuve ?? "indiqué par l'Éclaireur"}` };
      else if (f.franchise === false) a.franchise = { oui: false, raison: "aucun signe de franchise sur le site" };
      if (f.franchise_preuve && f.franchise) preuve(`Franchise : « ${f.franchise_preuve.slice(0, 160)} »`, page.url);
      if (f.vrai_site !== "oui" && f.vrai_site_preuve) preuve(`Pas un vrai site (${f.vrai_site}) : « ${f.vrai_site_preuve.slice(0, 160)} »`, page.url);
      // L'email retenu doit apparaître tel quel sur le site (skill) : sinon il est ignoré.
      const e = f.email?.toLowerCase().trim() ?? null;
      if (e && a.emailsTrouves.includes(e)) a.email = e;
      else if (e) preuve(`Email proposé par l'Éclaireur ignoré (absent des pages visitées) : ${e}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      a.flou = { erreur: (err as Error).message.slice(0, 200) };
    }
  }
  // Sans réponse de l'agent : l'email du domaine du site s'il y en a un seul, sinon rien (jamais deviné).
  if (!a.email && !(a.flou && "fournisseur" in a.flou)) {
    const dom = domaineDe(page.url);
    const duDomaine = a.emailsTrouves.filter((e) => dom && e.endsWith(`@${dom}`));
    if (duDomaine.length === 1) a.email = duDomaine[0]!;
  }

  a.statutSite =
    a.vraiSite === "annuaire" || a.vraiSite === "en_construction"
      ? "annuaire_seulement"
      : a.vraiSite === "autre_activite"
        ? "aucun"
        : a.https === false
          ? "sans_https"
          : a.mobile === false
            ? "non_mobile"
            : (a.anneeCopyright != null && a.anneeCopyright < maintenant.getFullYear() - 4) || a.techDatee
              ? "date"
              : "correct";
  return a;
}
