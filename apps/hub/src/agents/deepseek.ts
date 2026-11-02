/**
 * Client DeepSeek (API compatible OpenAI), facultatif (ADR-07) : le hub démarre sans clé.
 * Servira aux tâches de volume de la prospection (extraction sur des centaines de sites, tri).
 */
export class DeepSeekError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export type DeepSeekResult = { text: string; structured: unknown; costUsd: number | null; durationMs: number; model: string };

/** Prix indicatifs en $ par million de jetons (deepseek-chat, hors cache). À ajuster si les tarifs changent. */
const PRICE_PER_MTOK = { input: 0.27, output: 1.1 };

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export class DeepSeekClient {
  readonly #key: () => string | null;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(opts: { apiKey: () => string | null; baseUrl?: string; fetch?: FetchLike }) {
    this.#key = opts.apiKey;
    this.#baseUrl = (opts.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.#fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  get configured(): boolean {
    return !!this.#key();
  }

  /** Réponse JSON (mode `json_object`) : le schéma est donné dans le prompt, la validation est faite par l'appelant. */
  async structured(req: { model?: string; systemPrompt: string; prompt: string; jsonSchema?: object; timeoutMs?: number; signal?: AbortSignal }): Promise<DeepSeekResult> {
    const key = this.#key();
    if (!key) throw new DeepSeekError("DeepSeek n'est pas configuré : ajoutez DEEPSEEK_API_KEY (environnement ou .data/settings/secrets.json)");
    const model = req.model ?? "deepseek-chat";
    const started = Date.now();
    const system = req.jsonSchema
      ? `${req.systemPrompt}\n\nRéponds uniquement par un objet JSON conforme à ce schéma :\n${JSON.stringify(req.jsonSchema)}`
      : req.systemPrompt;
    const timeout = AbortSignal.timeout(req.timeoutMs ?? 120_000);
    const res = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: req.prompt },
        ],
        ...(req.jsonSchema ? { response_format: { type: "json_object" } } : {}),
        temperature: 0.2,
      }),
      signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout,
    }).catch((err: Error) => {
      throw new DeepSeekError(`DeepSeek injoignable : ${err.message}`);
    });
    if (!res.ok) {
      // Le corps d'erreur ne contient pas la clé ; on le tronque quand même.
      throw new DeepSeekError(`DeepSeek a répondu ${res.status} : ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const text = body.choices?.[0]?.message?.content ?? "";
    let structured: unknown = null;
    if (req.jsonSchema) {
      try {
        structured = JSON.parse(text);
      } catch {
        throw new DeepSeekError("DeepSeek n'a pas rendu de JSON valide");
      }
    }
    const u = body.usage;
    const costUsd = u ? ((u.prompt_tokens ?? 0) * PRICE_PER_MTOK.input + (u.completion_tokens ?? 0) * PRICE_PER_MTOK.output) / 1_000_000 : null;
    return { text, structured, costUsd, durationMs: Date.now() - started, model };
  }
}
