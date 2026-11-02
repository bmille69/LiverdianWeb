import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentService } from "../agents/agent-service.ts";
import type { DeepSeekClient } from "../agents/deepseek.ts";
import { Flou, type ExtracteurFlou, type Lighthouse, type LighthouseRunner } from "./audit.ts";

/**
 * L'Éclaireur tranche le flou de l'audit : DeepSeek quand la clé est configurée (peu cher pour du volume),
 * sinon Claude haiku en mode structuré. Il ne reçoit que des extraits exacts du site ; sa réponse est revalidée
 * (schéma zod, puis l'audit vérifie que l'email retenu figure bien sur le site).
 */
export function extracteurEclaireur(agents: Pick<AgentService, "ask">, deepseek: Pick<DeepSeekClient, "configured">): ExtracteurFlou {
  return async (e, signal) => {
    const provider = deepseek.configured ? "deepseek" : "claude";
    const prompt = `Entreprise : ${e.entreprise}${e.commune ? ` (${e.commune})` : ""}
Site visité : ${e.url}

<extraits>
Titre : ${e.titre ?? "(aucun)"}
Description : ${e.description ?? "(aucune)"}
Titres de la page : ${e.titres.join(" | ") || "(aucun)"}
Début du texte :
${e.debut}
${e.fin ? `Fin du texte (pied de page) :\n${e.fin}` : ""}
Emails relevés par le code : ${e.emails.join(", ") || "(aucun)"}
Domaines liés : ${e.liensExternes.join(", ") || "(aucun)"}
</extraits>

Réponds d'après ces extraits seulement :
1. franchise : true si le site montre une franchise, une enseigne ou un réseau national (« membre du réseau », « franchisé », logo d'enseigne connue, site sous le domaine d'un réseau), false si c'est clairement une entreprise indépendante, null si rien ne permet de le dire.
2. vrai_site : « oui » si c'est le site propre de cette entreprise ; « annuaire » pour une fiche d'annuaire ou de plateforme ; « en_construction » pour une page vide ou « site en construction » ; « autre_activite » si le site est celui d'une autre entreprise ou activité ; « incertain » sinon.
3. email : l'adresse professionnelle à retenir, copiée exactement depuis « Emails relevés » (aucune autre), ou null.
Pour chaque réponse, cite l'extrait qui la justifie (ou null).`;
    const r = await agents.ask({ agent: "eclaireur", prompt, schema: Flou, provider, signal, timeoutMs: 120_000, summary: `Audit du site de ${e.entreprise}` });
    return { flou: r.data, fournisseur: provider === "deepseek" ? "DeepSeek" : "Claude", modele: r.model };
  };
}

const HUB_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Lighthouse dans un processus séparé (une mesure, 90 s au plus) ; null si le kit n'a pas Lighthouse installé. */
export function lighthouseParDefaut(kitDir: string): LighthouseRunner | null {
  const script = join(HUB_ROOT, "scripts", "lighthouse-mobile.ts");
  if (!existsSync(join(kitDir, "node_modules", "lighthouse"))) return null;
  return (url, signal) =>
    new Promise<Lighthouse>((resolvePromise) => {
      execFile(process.execPath, [script, url, kitDir], { timeout: 90_000, signal, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        const ligne = String(stdout ?? "").trim().split("\n").at(-1) ?? "";
        try {
          const r = JSON.parse(ligne) as Lighthouse;
          return resolvePromise(r);
        } catch {
          return resolvePromise({ erreur: err ? (err.killed ? "Lighthouse : délai dépassé" : err.message.slice(0, 200)) : "Lighthouse : sortie illisible" });
        }
      });
    });
}
