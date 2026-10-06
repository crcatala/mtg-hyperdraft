// The debug console is for playtesting, not for players: it stays out of sight (no bug tab, and the
// backtick does nothing) until a visit with ?debug turns it on. That's remembered in this browser, so
// it survives moving between screens and reloads; ?debug=0 (or the console's own switch) turns it off.

import { useSyncExternalStore } from "react";

/** localStorage key. */
export const DEBUG_KEY = "hd.debug";

const OFF = new Set(["0", "false", "off", "no"]);

/** What the URL asks for: true (?debug, ?debug=1), false (?debug=0) or null (nothing said). */
export function debugParam(search: string): boolean | null {
  const value = new URLSearchParams(search).get("debug");
  if (value === null) return null;
  return !OFF.has(value.trim().toLowerCase());
}

const listeners = new Set<() => void>();
let enabled = false;

/** Startup: the URL wins (and is remembered), then what this browser remembers; off by default. */
export function initDebugAccess() {
  const asked = debugParam(location.search);
  if (asked !== null) return setDebugAccess(asked);
  try {
    enabled = localStorage.getItem(DEBUG_KEY) === "1";
  } catch {
    enabled = false;
  }
}

export function setDebugAccess(on: boolean) {
  enabled = on;
  try {
    if (on) localStorage.setItem(DEBUG_KEY, "1");
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    // Not remembered, still applied for this visit.
  }
  listeners.forEach((l) => l());
}

export function debugAccess(): boolean {
  return enabled;
}

export function useDebugAccess(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
  );
}
