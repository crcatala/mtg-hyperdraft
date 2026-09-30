// UI themes: the look of the screens and the table HUD (not the 3D table itself). The theme lives on
// <html data-theme>: styles.css + screens.css are the base (and the Arcane look), and each other
// theme layers its overrides on top from themes/<id>.css. Players pick one on Home (ThemePicker),
// from the debug console, or cycle with Alt+Shift+T; that choice is remembered. ?theme=<id> previews
// a theme for one visit without changing it.

import { useSyncExternalStore } from "react";

// index.html keeps its own copy of these ids (to set the theme before the first paint); a test checks
// the two match.
export const THEMES = [
  { id: "gamenight", label: "Game Night" },
  { id: "signal", label: "Signal" },
  { id: "arcane", label: "Arcane" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "gamenight";
/** localStorage key. index.html reads it too. */
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

const listeners = new Set<() => void>();
let theme: ThemeId = DEFAULT_THEME;

function apply(next: ThemeId) {
  theme = next;
  document.documentElement.dataset.theme = next;
  listeners.forEach((l) => l());
}

/**
 * Startup: applies the theme from the URL or storage without saving anything, so a ?theme= link
 * doesn't overwrite the visitor's choice, and visitors who never chose follow the default if it
 * changes.
 */
export function initTheme() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    // Storage blocked: the default it is.
  }
  apply(resolveTheme(new URLSearchParams(location.search).get("theme"), saved));
}

/** A player's explicit choice: applied and remembered. */
export function setTheme(next: ThemeId) {
  apply(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Not remembered, still applied.
  }
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

/** Alt+Shift+T cycles through the themes, except while typing (it's a character on macOS). */
export function installThemeShortcut() {
  window.addEventListener("keydown", (e) => {
    if (!(e.altKey && e.shiftKey && e.code === "KeyT")) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
    e.preventDefault();
    setTheme(nextTheme(theme));
  });
}
