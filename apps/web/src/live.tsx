import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type HubEvent, type Job, type JobLogLine, type Meta } from "./api.ts";

/** Ce qui change en direct : la connexion au hub, les travaux, le fil d'activité, et des compteurs pour recharger. */
type Topic = "companies" | "sites" | "jobs" | "agents" | "settings" | "prospection";
type Live = {
  meta: Meta | null;
  online: boolean;
  jobs: Map<string, Job>;
  events: HubEvent[];
  versions: Record<Topic, number>;
  bump(topic: Topic): void;
};

const LiveContext = createContext<Live | null>(null);

function topicOf(type: string): Topic | null {
  if (type.startsWith("company.")) return "companies";
  if (type.startsWith("site.") || type.startsWith("atelier.")) return "sites";
  if (type.startsWith("job")) return "jobs";
  if (type.startsWith("agent.")) return "agents";
  if (type.startsWith("settings.")) return "settings";
  if (type.startsWith("prospection.")) return "prospection";
  return null;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [online, setOnline] = useState(true);
  const [jobs, setJobs] = useState<Map<string, Job>>(new Map());
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [versions, setVersions] = useState<Record<Topic, number>>({ companies: 0, sites: 0, jobs: 0, agents: 0, settings: 0, prospection: 0 });
  const bump = useCallback((topic: Topic) => setVersions((v) => ({ ...v, [topic]: v[topic] + 1 })), []);

  const seed = useCallback(async () => {
    const [m, ev, running, queued] = await Promise.all([
      api.get<Meta>("/api/meta"),
      api.get<{ events: HubEvent[] }>("/api/events?limit=60"),
      api.get<{ jobs: Job[] }>("/api/jobs?state=running"),
      api.get<{ jobs: Job[] }>("/api/jobs?state=queued"),
    ]);
    setMeta(m);
    setEvents(ev.events);
    setJobs(new Map([...running.jobs, ...queued.jobs].map((j) => [j.id, j])));
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    seed().catch(() => setOnline(false));
    const open = () => {
      source = new EventSource("/api/stream");
      source.onopen = () => {
        setOnline((was) => {
          // Retour après une coupure : on recharge tout ce qui a pu changer.
          if (!was) {
            seed().catch(() => {});
            setVersions((v) => Object.fromEntries(Object.entries(v).map(([k, n]) => [k, n + 1])) as Record<Topic, number>);
          }
          return true;
        });
      };
      source.onerror = () => {
        if (!closed) setOnline(false);
      };
      source.addEventListener("event", (e) => {
        const { event } = JSON.parse((e as MessageEvent).data) as { event: HubEvent };
        setEvents((list) => [event, ...list].slice(0, 120));
        const t = topicOf(event.type);
        if (t) bump(t);
      });
      source.addEventListener("job", (e) => {
        const { job } = JSON.parse((e as MessageEvent).data) as { job: Job };
        setJobs((m) => new Map(m).set(job.id, job));
      });
      source.addEventListener("job-log", (e) => {
        const { jobId, line } = JSON.parse((e as MessageEvent).data) as { jobId: string; line: JobLogLine };
        setJobs((m) => {
          const j = m.get(jobId);
          if (!j) return m;
          return new Map(m).set(jobId, { ...j, progress: { ...j.progress, lines: [...j.progress.lines, line].slice(-60) } });
        });
      });
    };
    open();
    return () => {
      closed = true;
      source?.close();
    };
  }, [seed, bump]);

  const value = useMemo(() => ({ meta, online, jobs, events, versions, bump }), [meta, online, jobs, events, versions, bump]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("LiveProvider manquant");
  return ctx;
}

/** Charge une ressource de l'API, et la recharge quand un des sujets suivis change en direct. */
export function useApi<T>(url: string | null, topics: Topic[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const { versions } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const key = topics.map((t) => versions[t]).join(",");
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // Seul un changement d'adresse remontre l'état de chargement ; un rechargement en direct est silencieux.
    if (lastUrl.current !== url) setLoading(true);
    lastUrl.current = url;
    api
      .get<T>(url)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [url, key, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1), setData };
}
