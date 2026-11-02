import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Texte rendu d'un site construit (`dist/`), tel qu'un visiteur le lit, pour le contrôle des faits et la
 * relecture UX. Extraction en code, sans résumé : titres repérés, texte des sections, liens tel:/mailto:,
 * textes alternatifs, balises title/description, données structurées, et le formulaire tel quel.
 */
const ENTITES: Record<string, string> = { "&nbsp;": " ", "&#160;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&rsquo;": "’", "&laquo;": "«", "&raquo;": "»" };

function decoder(s: string): string {
  return s
    .replace(/&(?:nbsp|#160|amp|lt|gt|quot|#39|rsquo|laquo|raquo);/g, (m) => ENTITES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/[   ]/g, " ");
}

/** HTML → texte lisible, en gardant la structure : un titre par ligne préfixé de #, une ligne par bloc. */
export function texteDe(html: string): string {
  const corps = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<section[^>]*\bid="([^"]+)"[^>]*>/gi, "\n\n[section #$1]\n")
    .replace(/<(header|footer|nav|main)[^>]*>/gi, "\n\n[$1]\n")
    .replace(/<(br|\/p|\/li|\/dd|\/dt|\/div|\/a|\/button|\/label|\/option|\/address)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decoder(corps)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l, i, a) => l && l !== a[i - 1])
    .join("\n");
}

export function pagesHtml(dist: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (n.endsWith(".html")) out.push(f);
    }
  };
  if (existsSync(dist)) walk(dist);
  return out.sort((a, b) => (a.endsWith(join("dist", "index.html")) ? -1 : b.endsWith(join("dist", "index.html")) ? 1 : a.localeCompare(b)));
}

export function rendu(siteDir: string, opts: { formulaire?: boolean } = {}): string {
  const dist = join(siteDir, "dist");
  const parts: string[] = [];
  for (const f of pagesHtml(dist)) {
    const html = readFileSync(f, "utf8");
    const page = "/" + relative(dist, f).replace(/\\/g, "/").replace(/index\.html$/, "");
    const title = decoder(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
    const desc = decoder(/<meta name="description" content="([^"]*)"/i.exec(html)?.[1] ?? "");
    const tels = [...new Set([...html.matchAll(/href="(tel:[^"]+)"/g)].map((m) => m[1]))];
    const mails = [...new Set([...html.matchAll(/href="(mailto:[^"]+)"/g)].map((m) => m[1]))];
    const externes = [...new Set([...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => decoder(m[1]!)))];
    const alts = [...new Set([...html.matchAll(/<img[^>]*\balt="([^"]*)"/g)].map((m) => decoder(m[1]!)))];
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!.trim());
    parts.push(
      [
        `=== Page ${page}`,
        `<title> ${title}`,
        `<meta description> ${desc}`,
        `Liens tel: ${tels.join(" · ") || "aucun"}`,
        `Liens mailto: ${mails.join(" · ") || "aucun"}`,
        `Liens externes : ${externes.join(" · ") || "aucun"}`,
        `Textes alternatifs des images : ${alts.map((a) => `« ${a} »`).join(" · ") || "aucun"}`,
        ...(ld.length ? [`Données structurées (JSON-LD) : ${ld.join("\n")}`] : []),
        "",
        "Texte affiché :",
        texteDe(html),
      ].join("\n"),
    );
    if (opts.formulaire && page === "/") {
      const form = /<form[\s\S]*?<\/form>/i.exec(html)?.[0];
      if (form) parts.push(`=== Formulaire de la page d'accueil (HTML exact)\n${form.replace(/<svg[\s\S]*?<\/svg>/gi, "<svg…/>")}`);
    }
  }
  return parts.join("\n\n");
}
