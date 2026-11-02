import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { Icon } from "./Icon.tsx";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ icon, title, children, action }: { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ animationDelay: `${i * 70}ms` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <Icon name="alert" size={16} />
      <span>{text}</span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Panneau latéral (détail, formulaire). Échap ferme, le focus entre dans le panneau. */
export function Drawer({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Portail : hors de la transition de page, dont la transformation fausserait position: fixed.
  return createPortal(
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" style={{ width }} ref={ref} tabIndex={-1} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** Rendu markdown des skills (fichiers du dépôt) : le HTML brut éventuel est affiché comme du texte. */
const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function Markdown({ source }: { source: string }) {
  const html = marked.parse(source, { renderer, async: false, gfm: true }) as string;
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
export function timeAgo(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return "à l'instant";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export const usd = (n: number | null | undefined) => (n == null ? "—" : n < 0.01 && n > 0 ? "< 0,01 $" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
