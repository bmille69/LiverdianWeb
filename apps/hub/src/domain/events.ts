import { EventEmitter } from "node:events";
import { now, parseJson, type Db } from "../db/database.ts";

export type HubEvent = {
  seq: number;
  at: string;
  type: string;
  subject: string | null;
  message: string;
  data: Record<string, unknown> | null;
};

/** Ce que le flux temps réel (/api/stream) pousse vers l'interface. */
export type BusMessage =
  | { kind: "event"; event: HubEvent }
  | { kind: "job"; job: unknown }
  | { kind: "job-log"; jobId: string; line: JobLogLine };

export type JobLogLine = { at: string; kind: "info" | "tool" | "text" | "error"; text: string };

/** Bus interne : les services y publient, le flux SSE s'y abonne. */
export class Bus {
  readonly #emitter = new EventEmitter();
  constructor() {
    this.#emitter.setMaxListeners(100);
  }
  publish(msg: BusMessage): void {
    this.#emitter.emit("msg", msg);
  }
  subscribe(fn: (msg: BusMessage) => void): () => void {
    this.#emitter.on("msg", fn);
    return () => void this.#emitter.off("msg", fn);
  }
}

/** Journal d'activité : chaque ligne est une phrase lisible, en français. */
export class EventLog {
  readonly #db: Db;
  readonly #bus: Bus;
  constructor(db: Db, bus: Bus) {
    this.#db = db;
    this.#bus = bus;
  }

  append(e: { type: string; subject?: string | null; message: string; data?: Record<string, unknown> | null }): HubEvent {
    const at = now();
    const res = this.#db
      .prepare("INSERT INTO events (at, type, subject, message, data_json) VALUES (?, ?, ?, ?, ?)")
      .run(at, e.type, e.subject ?? null, e.message, e.data ? JSON.stringify(e.data) : null);
    const event: HubEvent = { seq: Number(res.lastInsertRowid), at, type: e.type, subject: e.subject ?? null, message: e.message, data: e.data ?? null };
    this.#bus.publish({ kind: "event", event });
    return event;
  }

  list(opts: { limit?: number; before?: number; subject?: string } = {}): HubEvent[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.before) {
      where.push("seq < ?");
      params.push(opts.before);
    }
    if (opts.subject) {
      where.push("subject = ?");
      params.push(opts.subject);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM events ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq DESC LIMIT ?`)
      .all(...params, limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      seq: Number(r.seq),
      at: String(r.at),
      type: String(r.type),
      subject: (r.subject as string | null) ?? null,
      message: String(r.message),
      data: parseJson<Record<string, unknown> | null>(r.data_json, null),
    }));
  }
}
