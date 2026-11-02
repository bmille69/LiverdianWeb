import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** Routeur minimal (historique du navigateur) : le hub renvoie index.html pour toute route non-API. */
const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  for (const l of listeners) l();
}

window.addEventListener("popstate", () => {
  for (const l of listeners) l();
});

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const l = () => setPath(location.pathname);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return path;
}

export function useQuery(): URLSearchParams {
  const path = usePath();
  void path;
  return new URLSearchParams(location.search);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
