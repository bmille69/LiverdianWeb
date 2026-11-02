import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Company } from "../api.ts";
import { useLive } from "../live.tsx";
import { usePrefs } from "../prefs.ts";
import { Link, navigate, usePath } from "../router.tsx";
import { Icon } from "./Icon.tsx";
import { Kbd } from "./common.tsx";

export type NavItem = { path: string; label: string; icon: string; soon?: boolean; group: "travail" | "bientot" | "agence" };

export const NAV: NavItem[] = [
  { path: "/", label: "Aujourd'hui", icon: "today", group: "travail" },
  { path: "/entreprises", label: "Entreprises", icon: "companies", group: "travail" },
  { path: "/atelier", label: "Atelier", icon: "atelier", group: "travail" },
  { path: "/sites", label: "Sites", icon: "sites", group: "travail" },
  { path: "/prospection", label: "Prospection", icon: "prospection", soon: true, group: "bientot" },
  { path: "/commercial", label: "Commercial", icon: "commercial", soon: true, group: "bientot" },
  { path: "/finance", label: "Finance", icon: "finance", soon: true, group: "bientot" },
  { path: "/equipe", label: "Équipe", icon: "team", group: "agence" },
  { path: "/reglages", label: "Réglages", icon: "settings", group: "agence" },
];

export function activeNav(path: string): NavItem | undefined {
  return NAV.find((n) => (n.path === "/" ? path === "/" : path === n.path || path.startsWith(n.path + "/")));
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="8" className="logo-bg" />
      <path d="M10 7v18h12" fill="none" stroke="var(--accent)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21.5" cy="10.5" r="3" fill="var(--warm)" />
    </svg>
  );
}

export function Sidebar({ onPalette }: { onPalette: () => void }) {
  const path = usePath();
  const { online, jobs } = useLive();
  const [prefs, setPrefs] = usePrefs();
  const active = activeNav(path);
  const running = [...jobs.values()].filter((j) => j.state === "running" || j.state === "queued").length;
  const groups: { id: NavItem["group"]; title: string | null }[] = [
    { id: "travail", title: null },
    { id: "bientot", title: "Bientôt" },
    { id: "agence", title: "Agence" },
  ];
  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <div className="brand">
        <Logo />
        <span className="brand-name">Liverdian</span>
      </div>
      <button className="search-trigger" onClick={onPalette}>
        <Icon name="search" size={15} />
        <span>Rechercher…</span>
        <span className="search-keys">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      {groups.map((g) => (
        <div key={g.id} className="nav-group">
          {g.title && <div className="nav-title">{g.title}</div>}
          {NAV.filter((n) => n.group === g.id).map((n) => (
            <Link key={n.path} to={n.path} className={`nav-link${active?.path === n.path ? " active" : ""}${n.soon ? " soon" : ""}`} aria-current={active?.path === n.path ? "page" : undefined}>
              <Icon name={n.icon} size={17} className="nav-icon" />
              <span className="nav-label">{n.label}</span>
              {n.path === "/atelier" && running > 0 && (
                <span className="nav-badge live" title={`${running} travail(aux) en cours ou en file`}>
                  {running}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}
      <div className="sidebar-spacer" />
      <div className="sidebar-foot">
        <span className={`conn ${online ? "on" : "off"}`} title={online ? "Connecté au hub" : "Hub injoignable"}>
          <span className="conn-dot" />
          {online ? "En direct" : "Hors ligne"}
        </span>
        <button className="icon-btn" onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })} aria-label={prefs.theme === "dark" ? "Passer en thème clair" : "Passer en thème sombre"} title={prefs.theme === "dark" ? "Thème clair" : "Thème sombre"}>
          <Icon name={prefs.theme === "dark" ? "sun" : "moon"} size={16} />
        </button>
      </div>
    </nav>
  );
}

type Command = { id: string; label: string; hint?: string; icon: string; run: () => void; keywords?: string };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    requestAnimationFrame(() => input.current?.focus());
    api
      .get<{ companies: Company[] }>("/api/companies")
      .then((r) => setCompanies(r.companies))
      .catch(() => setCompanies([]));
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (p: string) => () => navigate(p);
    const base: Command[] = [
      { id: "new-company", label: "Nouvelle entreprise", hint: "Action", icon: "plus", run: go("/entreprises?nouvelle=1"), keywords: "créer ajouter fiche prospect client" },
      ...NAV.map((n) => ({ id: `nav-${n.path}`, label: n.label, hint: n.soon ? "Bientôt" : "Aller à", icon: n.icon, run: go(n.path) })),
    ];
    const comp: Command[] = companies.map((c) => ({
      id: `c-${c.id}`,
      label: c.nomCommercial ?? c.raisonSociale,
      hint: [c.metier, c.adresse.commune].filter(Boolean).join(" · ") || "Entreprise",
      icon: "companies",
      run: go(`/entreprises/${c.id}`),
      keywords: `${c.raisonSociale} ${c.siren ?? ""} ${c.telephone ?? ""}`,
    }));
    const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = norm(q.trim());
    if (!needle) return [...base, ...comp.slice(0, 5)];
    return [...base, ...comp].filter((c) => norm(`${c.label} ${c.keywords ?? ""} ${c.hint ?? ""}`).includes(needle)).slice(0, 12);
  }, [q, companies]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return createPortal(
    <div className="palette-layer" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={17} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Aller à une page, chercher une entreprise…"
            aria-label="Recherche"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, commands.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(commands[sel]);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <Kbd>Échap</Kbd>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {commands.length === 0 && <div className="palette-empty">Aucun résultat pour « {q} »</div>}
          {commands.map((c, i) => (
            <button key={c.id} data-index={i} role="option" aria-selected={i === sel} className={`palette-item${i === sel ? " sel" : ""}`} onMouseMove={() => setSel(i)} onClick={() => run(c)}>
              <Icon name={c.icon} size={16} />
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
              {i === sel && <Icon name="enter" size={14} className="palette-enter" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Transition de page : le contenu réapparaît en fondu léger à chaque changement de route. */
export function PageTransition({ path, children }: { path: string; children: ReactNode }) {
  return (
    <div key={path.split("/")[1] ?? ""} className="page-enter">
      {children}
    </div>
  );
}
