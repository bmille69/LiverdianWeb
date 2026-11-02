import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string; leaving?: boolean };
type ToastApi = { ok(text: string): void; error(text: string): void; info(text: string): void };

const ToastContext = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((l) => l.filter((t) => t.id !== id)), 180);
  }, []);

  const push = useCallback(
    (kind: Toast["kind"], text: string) => {
      const id = ++seq;
      setToasts((l) => [...l.slice(-3), { id, kind, text }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 3800);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(() => ({ ok: (t) => push("ok", t), error: (t) => push("error", t), info: (t) => push("info", t) }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}${t.leaving ? " leaving" : ""}`}>
            <Icon name={t.kind === "ok" ? "check" : t.kind === "error" ? "alert" : "info"} size={16} />
            <span>{t.text}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Fermer">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider manquant");
  return ctx;
}
