// Style exploration: the UI theme lives on <html data-theme>. Pick one with ?theme=<id> (kept in
// localStorage), from the debug console, or cycle with Alt+Shift+T. "current" is the original look.

import { useSyncExternalStore } from "react";

export const THEMES = [
  { id: "current", label: "Current" },
  { id: "folio", label: "A · Folio" },
  { id: "gamenight", label: "B · Game Night" },
  { id: "signal", label: "C · Signal" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "hd.theme";
const listeners = new Set<() => void>();
const isTheme = (v: string | null): v is ThemeId => THEMES.some((t) => t.id === v);

function read(): ThemeId {
  const param = new URLSearchParams(location.search).get("theme");
  if (isTheme(param)) return param;
  try {
    const saved = localStorage.getItem(KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  return "current";
}

let theme: ThemeId = read();

export function applyTheme(next: ThemeId = theme) {
  theme = next;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // not remembered, still applied
  }
  listeners.forEach((l) => l());
}

export function cycleTheme() {
  const i = THEMES.findIndex((t) => t.id === theme);
  applyTheme(THEMES[(i + 1) % THEMES.length].id);
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

window.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && e.code === "KeyT") {
    e.preventDefault();
    cycleTheme();
  }
});
