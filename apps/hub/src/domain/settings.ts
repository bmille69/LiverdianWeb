import { readFileSync } from "node:fs";
import { join } from "node:path";
import { now, parseJson, type Db } from "../db/database.ts";

/** Réglages connus, avec leur valeur par défaut. Les autres clés sont refusées par l'API. */
export const SETTING_DEFAULTS = {
  /** Travaux exécutés en même temps, tous types confondus. */
  "jobs.parallel": 2,
  /** Appels simultanés au CLI claude (quota de l'abonnement). */
  "agents.parallel": 2,
  /** Modèle choisi par agent ; absent = modèle par défaut du registre. */
  "agents.models": {} as Record<string, string>,
  /** Délai maximum d'un travail d'atelier (Claude Code agentique), en minutes. */
  "atelier.timeoutMinutes": 30,
  /** Prospection : grille de score (null = grille du plan, voir prospection/scoring.ts). */
  "prospection.grille": null as unknown,
  /** Appels Google Places permis par mois civil (sous le quota gratuit de 1 000 appels « Enterprise »). */
  "prospection.places.plafondMensuel": 900,
  /** Maquettes fabriquées en même temps quand elles sont lancées depuis la prospection. */
  "prospection.maquettes.parallele": 1,
  /** Purge des prospects non convertis, en mois sans activité (RGPD). */
  "prospection.purge.mois": 6,
  /** Moteur des agents : « abonnement » (Claude Code Max), « deepseek » (via le CLI claude), « automatique » (abonnement, puis DeepSeek quand la limite est atteinte). */
  "agents.moteur": "abonnement" as "abonnement" | "deepseek" | "automatique",
  /** Hébergement des démos : domaine racine de la zone Cloudflare (ex. mondomaine.fr → <slug>.mondomaine.fr). */
  "hebergement.domaine": "" as string,
  /** Chemin d'un script wrangler personnalisé (essais) ; vide = celui du dépôt. */
  "hebergement.wranglerBin": "" as string,
  /** Espace KV Cloudflare des compteurs de visites, posé à la première publication. */
  "hebergement.kvNamespaceId": "" as string,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K] extends number ? number : (typeof SETTING_DEFAULTS)[K];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFAULTS, key);
}

export class Settings {
  readonly #db: Db;
  readonly #dataDir: string | null;
  constructor(db: Db, dataDir: string | null = null) {
    this.#db = db;
    this.#dataDir = dataDir;
  }

  get<K extends SettingKey>(key: K): SettingValue<K> {
    const row = this.#db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
    return parseJson(row?.value_json, SETTING_DEFAULTS[key] as SettingValue<K>);
  }

  set<K extends SettingKey>(key: K, value: SettingValue<K>): void {
    this.#db
      .prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), now());
  }

  all(): Record<SettingKey, unknown> {
    return Object.fromEntries((Object.keys(SETTING_DEFAULTS) as SettingKey[]).map((k) => [k, this.get(k)])) as Record<SettingKey, unknown>;
  }

  /**
   * Secret lu dans l'environnement, sinon dans `.data/settings/secrets.json` (jamais en base, jamais journalisé).
   */
  secret(name: string): string | null {
    const fromEnv = process.env[name];
    if (fromEnv) return fromEnv;
    if (!this.#dataDir) return null;
    try {
      const file = parseJson<Record<string, unknown>>(readFileSync(join(this.#dataDir, "settings", "secrets.json"), "utf8"), {});
      const v = file[name];
      return typeof v === "string" && v ? v : null;
    } catch {
      return null;
    }
  }
}
