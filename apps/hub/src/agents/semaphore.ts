/** Limite le nombre de tâches simultanées ; le plafond est relu à chaque libération (réglable à chaud). */
export class Semaphore {
  readonly #cap: () => number;
  #active = 0;
  readonly #queue: (() => void)[] = [];

  constructor(cap: number | (() => number)) {
    this.#cap = typeof cap === "number" ? () => cap : cap;
  }

  get active(): number {
    return this.#active;
  }

  get waiting(): number {
    return this.#queue.length;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#acquire(signal);
    try {
      return await fn();
    } finally {
      this.#active--;
      this.#drain();
    }
  }

  #limit(): number {
    return Math.max(1, Math.floor(this.#cap()) || 1);
  }

  #acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("Annulé avant de démarrer"));
    if (this.#active < this.#limit() && !this.#queue.length) {
      this.#active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", onAbort);
        this.#active++;
        resolve();
      };
      const onAbort = () => {
        const i = this.#queue.indexOf(go);
        if (i >= 0) this.#queue.splice(i, 1);
        reject(new Error("Annulé avant de démarrer"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#queue.push(go);
    });
  }

  #drain(): void {
    while (this.#queue.length && this.#active < this.#limit()) this.#queue.shift()!();
  }
}
