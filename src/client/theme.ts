// UI themes: the look of the screens and the table HUD (not the 3D table itself). The theme lives on
// <html data-theme>: styles.css + screens.css are the base (and the Arcane look), and each other
// theme layers its overrides on top from themes/<id>.css. Pick one with ?theme=<id> (remembered in
// localStorage), from the debug console, or cycle with Alt+Shift+T.

import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "gamenight", label: "Game Night" },
  { id: "signal", label: "Signal" },
  { id: "arcane", label: "Arcane" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "gamenight";
/** localStorage key. index.html reads it too, to set the theme before the first paint. */
export const THEME_KEY = "hd.theme";

export function isTheme(v: string | null | undefined): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

/** The theme to use: the URL's ?theme= wins, then the saved choice, then the default. */
export function resolveTheme(param: string | null, saved: string | null): ThemeId {
  if (isTheme(param)) return param;
  if (isTheme(saved)) return saved;
  return DEFAULT_THEME;
}

export function nextTheme(current: ThemeId): ThemeId {
  const i = THEMES.findIndex((t) => t.id === current);
  return THEMES[(i + 1) % THEMES.length].id;
}

function loadSaved(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let theme: ThemeId = DEFAULT_THEME;

/** Applies and remembers a theme. Without an argument, the one from the URL or storage. */
export function applyTheme(next: ThemeId = resolveTheme(new URLSearchParams(location.search).get("theme"), loadSaved())) {
  theme = next;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not remembered, still applied.
  }
  listeners.forEach((l) => l());
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => theme,
  );
}

/** Alt+Shift+T cycles through the themes, anywhere in the app. */
export function installThemeShortcut() {
  window.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyT") {
      e.preventDefault();
      applyTheme(nextTheme(theme));
    }
  });
}
