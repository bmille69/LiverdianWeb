import { randomUUID } from "node:crypto";
import { now, type Db } from "../db/database.ts";
import type { Atelier } from "../atelier/moteur.ts";
import { HubError } from "../domain/errors.ts";
import type { Bus, EventLog } from "../domain/events.ts";
import type { Settings } from "../domain/settings.ts";
import type { Job } from "../jobs/job-queue.ts";

export type EtatFile = "en_attente" | "lancee" | "annulee" | "refusee";
export type EntreeFile = { id: string; companyId: string; companyName: string; campagneId: string | null; etat: EtatFile; siteId: string | null; message: string | null; createdAt: string; updatedAt: string };

/**
 * « Créer la maquette » depuis la prospection, sur une ligne ou une sélection : les demandes attendent dans une file
 * visible, et le hub n'en lance qu'autant que le plafond de fabrications simultanées le permet (1 par défaut).
 * Chaque fin d'étape de l'atelier relance la file. L'atelier reste seul juge des prérequis (refus = motif affiché).
 */
export class FileMaquettes {
  readonly #db: Db;
  readonly #events: EventLog;
  readonly #settings: Settings;
  readonly #atelier: Pick<Atelier, "lancer">;
  #unsubscribe: (() => void) | null = null;
  #enCours = false;

  constructor(deps: { db: Db; bus: Bus; events: EventLog; settings: Settings; atelier: Pick<Atelier, "lancer"> }) {
    this.#db = deps.db;
    this.#events = deps.events;
    this.#settings = deps.settings;
    this.#atelier = deps.atelier;
    this.#unsubscribe = deps.bus.subscribe((m) => {
      if (m.kind !== "job") return;
      const job = m.job as Job;
      if (job.type === "atelier.etape" && (job.state === "done" || job.state === "failed" || job.state === "cancelled")) setTimeout(() => this.pomper(), 0);
    });
  }

  close(): void {
    this.#unsubscribe?.();
  }

  list(): EntreeFile[] {
    const rows = this.#db
      .prepare(
        `SELECT m.*, COALESCE(c.nom_commercial, c.raison_sociale) AS company_name FROM maquettes_file m JOIN companies c ON c.id = m.company_id
         ORDER BY CASE m.etat WHEN 'en_attente' THEN 0 WHEN 'lancee' THEN 1 ELSE 2 END, m.created_at DESC LIMIT 200`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      companyId: String(r.company_id),
      companyName: String(r.company_name),
      campagneId: (r.campagne_id as string | null) ?? null,
      etat: r.etat as EtatFile,
      siteId: (r.site_id as string | null) ?? null,
      message: (r.message as string | null) ?? null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }));
  }

  /** Fabrications de l'atelier en cours (tous lancements confondus) : c'est elles que le plafond limite. */
  enFabrication(): number {
    return Number((this.#db.prepare("SELECT COUNT(*) AS n FROM fabrications WHERE etat = 'en_cours'").get() as { n: number }).n);
  }

  ajouter(companyIds: string[], campagneId: string | null = null): { ajoutees: number; dejaEnFile: number } {
    if (!companyIds.length) throw new HubError("Aucune entreprise sélectionnée");
    let ajoutees = 0;
    let dejaEnFile = 0;
    for (const id of [...new Set(companyIds)]) {
      if (!this.#db.prepare("SELECT 1 FROM companies WHERE id = ?").get(id)) continue;
      if (this.#db.prepare("SELECT 1 FROM maquettes_file WHERE company_id = ? AND etat = 'en_attente'").get(id)) {
        dejaEnFile++;
        continue;
      }
      const at = now();
      this.#db.prepare("INSERT INTO maquettes_file (id, company_id, campagne_id, etat, created_at, updated_at) VALUES (?, ?, ?, 'en_attente', ?, ?)").run(randomUUID().slice(0, 10), id, campagneId, at, at);
      ajoutees++;
    }
    if (ajoutees) this.#events.append({ type: "prospection.maquettes", message: `${ajoutees} maquette(s) ajoutée(s) à la file` });
    this.pomper();
    return { ajoutees, dejaEnFile };
  }

  annuler(id: string): void {
    const r = this.#db.prepare("UPDATE maquettes_file SET etat = 'annulee', updated_at = ? WHERE id = ? AND etat = 'en_attente'").run(now(), id);
    if (!r.changes) throw new HubError("Cette demande n'est plus en attente", 409);
    this.#events.append({ type: "prospection.maquettes", message: "Demande de maquette retirée de la file" });
  }

  /** Lance les demandes en attente tant que le plafond le permet (le plus ancien d'abord). */
  pomper(): void {
    if (this.#enCours) return;
    this.#enCours = true;
    try {
      const cap = Math.max(1, Math.floor(this.#settings.get("prospection.maquettes.parallele")) || 1);
      while (this.enFabrication() < cap) {
        const next = this.#db.prepare("SELECT id, company_id FROM maquettes_file WHERE etat = 'en_attente' ORDER BY created_at, rowid LIMIT 1").get() as { id: string; company_id: string } | undefined;
        if (!next) break;
        try {
          const r = this.#atelier.lancer(next.company_id);
          this.#db.prepare("UPDATE maquettes_file SET etat = 'lancee', site_id = ?, message = NULL, updated_at = ? WHERE id = ?").run(r.site.id, now(), next.id);
        } catch (err) {
          this.#db.prepare("UPDATE maquettes_file SET etat = 'refusee', message = ?, updated_at = ? WHERE id = ?").run((err as Error).message.slice(0, 400), now(), next.id);
        }
        this.#events.append({ type: "prospection.maquettes", message: "File des maquettes mise à jour" });
      }
    } finally {
      this.#enCours = false;
    }
  }
}
