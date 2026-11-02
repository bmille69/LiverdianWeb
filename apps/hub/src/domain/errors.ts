/** Erreur métier : son message, en français, est montré tel quel à l'utilisateur. */
export class HubError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "HubError";
    this.status = status;
  }
}

export const notFound = (what: string) => new HubError(`${what} introuvable`, 404);
