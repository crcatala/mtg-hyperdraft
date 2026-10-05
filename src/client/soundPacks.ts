// Sound packs: which set of sound-effect samples plays (public/sfx/<pack>/). Like UI themes they can be
// switched at any time (from Settings) and the choice is remembered; ?sounds=<id>
// previews one for a visit without saving it.
//
// This is deliberately only about *sound effects*. Background music is its own thing (music.ts: its own
// tracks, volume and on/off).

import { useSyncExternalStore } from "react";

export const SOUND_PACKS = [
  { id: "tabletop", label: "Tabletop", blurb: "Wood, cardstock and soft chimes" },
  { id: "arcane", label: "Arcane", blurb: "Crystal chimes, harp and spellcraft" },
  { id: "library", label: "Library", blurb: "Parchment, leather and a music box" },
  { id: "grove", label: "Grove", blurb: "Leaves, twigs, kalimba and pond drops" },
] as const;
export type PackId = (typeof SOUND_PACKS)[number]["id"];

export const DEFAULT_PACK: PackId = "tabletop";
/** The pack used if a chosen one is missing a sound (every pack should be complete; this is the net). */
export const FALLBACK_PACK: PackId = "tabletop";
/** localStorage key. */
export const SOUNDS_KEY = "hd.sounds";

export function isPack(v: string | null | undefined): v is PackId {
  return SOUND_PACKS.some((p) => p.id === v);
}

/**
 * The pack to use: the URL's ?sounds= wins, then the saved one, then the default. A saved pack that no
 * longer exists (an old "foil", "signal" or "theme") falls through to the default.
 */
export function resolvePack(param: string | null, saved: string | null): PackId {
  if (isPack(param)) return param;
  if (isPack(saved)) return saved;
  return DEFAULT_PACK;
}

// --- state ---------------------------------------------------------------------------------------

const listeners = new Set<() => void>();
let pack: PackId = DEFAULT_PACK;

/** Startup: applies ?sounds= or the saved choice without saving anything. */
export function initSoundPack() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SOUNDS_KEY);
  } catch {
    /* storage blocked: the default it is */
  }
  pack = resolvePack(new URLSearchParams(location.search).get("sounds"), saved);
}

/** A player's explicit choice: applied and remembered. */
export function setSoundPack(next: PackId) {
  pack = next;
  try {
    localStorage.setItem(SOUNDS_KEY, next);
  } catch {
    /* not remembered, still applied */
  }
  listeners.forEach((l) => l());
}

/** The pack playing right now. */
export function activePack(): PackId {
  return pack;
}

export function useSoundPack(): PackId {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pack,
  );
}
