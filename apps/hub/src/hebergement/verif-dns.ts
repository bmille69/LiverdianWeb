/**
 * Vérifie une démo en ligne SANS passer par le DNS de la box.
 *
 * Constaté à la première publication réelle : la box (Livebox) avait mémorisé « cette adresse n'existe pas »
 * lors d'un essai précédent (cache négatif ~30 min) alors que la démo répondait déjà partout ailleurs.
 * On résout donc le nom auprès de résolveurs publics (Cloudflare, Google), puis on se connecte à l'IP
 * obtenue en gardant le vrai nom pour le certificat (SNI) et l'en-tête Host.
 */
import { Resolver } from "node:dns/promises";
import { request } from "node:https";

const RESOLVEURS = ["1.1.1.1", "8.8.8.8", "1.0.0.1"];

async function resoudre(hote: string): Promise<string> {
  const r = new Resolver({ timeout: 4_000, tries: 2 });
  r.setServers(RESOLVEURS);
  const ips = await r.resolve4(hote);
  if (!ips.length) throw new Error(`aucune adresse pour ${hote}`);
  return ips[0]!;
}

export async function getSansCacheDns(url: string, timeoutMs = 10_000): Promise<{ status: number; texte: string }> {
  const u = new URL(url);
  const ip = await resoudre(u.hostname);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: u.hostname,
        servername: u.hostname,
        port: Number(u.port) || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { "user-agent": "Liverdian-verification" },
        lookup: (_h, opts, cb) => {
          if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: ip, family: 4 }]);
          else cb(null, ip, 4);
        },
        timeout: timeoutMs,
      },
      (res) => {
        const morceaux: Buffer[] = [];
        res.on("data", (c: Buffer) => morceaux.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texte: Buffer.concat(morceaux).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("délai dépassé")));
    req.on("error", reject);
    req.end();
  });
}
