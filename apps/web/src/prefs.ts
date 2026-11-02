import { useCallback, useEffect, useState } from "react";

/**
 * Préférences d'affichage gardées sur ce poste : thème (sombre par défaut) et animations.
 * « Réduire les animations » suit par défaut le réglage du système (prefers-reduced-motion).
 */
type Theme = "dark" | "light";
type Motion = "full" | "reduced";
type Prefs = { theme: Theme; motion: Motion };

const KEYS = { theme: "liverdian:theme", motion: "liverdian:motion" } as const;

function read(): Prefs {
  let theme: Theme = "dark";
  let motion: Motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  try {
    const t = localStorage.getItem(KEYS.theme);
    if (t === "dark" || t === "light") theme = t;
    const m = localStorage.getItem(KEYS.motion);
    if (m === "full" || m === "reduced") motion = m;
  } catch {
    /* stockage indisponible : valeurs par défaut */
  }
  return { theme, motion };
}

let current: Prefs = read();
const listeners = new Set<(p: Prefs) => void>();

function apply(p: Prefs) {
  current = p;
  document.documentElement.dataset.theme = p.theme;
  document.documentElement.dataset.motion = p.motion;
  for (const l of listeners) l(p);
}

export function initPrefs(): void {
  apply(read());
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [p, setP] = useState(current);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  const set = useCallback((patch: Partial<Prefs>) => {
    const next = { ...current, ...patch };
    try {
      localStorage.setItem(KEYS.theme, next.theme);
      localStorage.setItem(KEYS.motion, next.motion);
    } catch {
      /* sans gravité */
    }
    apply(next);
  }, []);
  return [p, set];
}
