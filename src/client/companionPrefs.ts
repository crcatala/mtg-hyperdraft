// Whether this player hears companions' voices and sees their speech bubbles (Settings → Companions). Both are
// local: they change only what this browser plays and shows, never what is sent, so turning speech off doesn't
// silence anyone else's view of your emotes. Remembered per browser, on by default.
//
// The gates themselves are in single places: `voice`/`say` in table/companionTalk.ts and the lobby's sayHello in
// companionVoice.ts. The dev pages (lab, sound studio) play regardless: they exist to be listened to.

import { useSyncExternalStore } from "react";

export interface CompanionPrefs {
  /** Companions' voice sounds (their reactions still move when off). */
  sounds: boolean;
  /** Companions' speech bubbles, and the screen reader's reading of emotes (sounds and motion stay). */
  speech: boolean;
}
export const DEFAULT_COMPANION_PREFS: CompanionPrefs = { sounds: true, speech: true };
/** localStorage key for the saved CompanionPrefs (JSON). */
export const COMPANION_PREFS_KEY = "hd.companions";

/** Saved prefs from storage text; anything missing or malformed falls back to the default (on). */
export function parseCompanionPrefs(raw: string | null | undefined): CompanionPrefs {
  let v: Partial<Record<keyof CompanionPrefs, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") v = parsed;
  } catch {
    // Corrupt: the defaults it is.
  }
  const flag = (x: unknown, fallback: boolean) => (typeof x === "boolean" ? x : fallback);
  return { sounds: flag(v.sounds, DEFAULT_COMPANION_PREFS.sounds), speech: flag(v.speech, DEFAULT_COMPANION_PREFS.speech) };
}

const listeners = new Set<() => void>();
let prefs: CompanionPrefs = DEFAULT_COMPANION_PREFS;

function set(patch: Partial<CompanionPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(COMPANION_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered, still applied.
  }
  listeners.forEach((l) => l());
}

/** Startup: reads the saved prefs. */
export function initCompanionPrefs() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(COMPANION_PREFS_KEY);
  } catch {
    // Storage blocked: the defaults it is.
  }
  prefs = parseCompanionPrefs(saved);
}

export const companionSounds = () => prefs.sounds;
export const companionSpeech = () => prefs.speech;
export const setCompanionSounds = (on: boolean) => set({ sounds: on });
export const setCompanionSpeech = (on: boolean) => set({ speech: on });

export function useCompanionPrefs(): CompanionPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => prefs,
    () => prefs,
  );
}
