// Sound packs: which set of sound-effect samples plays (public/sfx/<pack>/). Like UI themes they can be
// switched at any time (for now from the debug console) and the choice is remembered; ?sounds=<id>
// previews one for a visit without saving it. "Match theme" follows the UI theme.
//
// This is deliberately only about *sound effects*. Background music, when it comes, is its own thing
// (its own tracks, its own volume and mute) that shares nothing but the page's audio context.

import { useSyncExternalStore } from "react";

export const SOUND_PACKS = [
  { id: "foil", label: "Foil", blurb: "Crisp foil and glassy magic" },
  { id: "tabletop", label: "Tabletop", blurb: "Wood, cardstock and brass bells" },
  { id: "arcane", label: "Arcane", blurb: "Crystal chimes, harp and spellcraft" },
  { id: "signal", label: "Signal", blurb: "Clean digital blips and sweeps" },
] as const;
export type PackId = (typeof SOUND_PACKS)[number]["id"];
/** What a player picks: one pack, or whichever suits the UI theme. */
export type SoundChoice = PackId | "theme";

export const DEFAULT_SOUND_CHOICE: SoundChoice = "foil";
/** The pack used if a chosen one is missing a sound (every pack should be complete; this is the net). */
export const FALLBACK_PACK: PackId = "foil";
/** localStorage key. */
export const SOUNDS_KEY = "hd.sounds";

/** Which pack goes with each UI theme, for "Match theme". */
const THEME_PACK: Record<string, PackId> = { gamenight: "tabletop", signal: "signal", arcane: "arcane" };

export function isPack(v: string | null | undefined): v is PackId {
  return SOUND_PACKS.some((p) => p.id === v);
}

export function isSoundChoice(v: string | null | undefined): v is SoundChoice {
  return v === "theme" || isPack(v);
}

/** The choice to use: the URL's ?sounds= wins, then the saved one, then the default. */
export function resolveSoundChoice(param: string | null, saved: string | null): SoundChoice {
  if (isSoundChoice(param)) return param;
  if (isSoundChoice(saved)) return saved;
  return DEFAULT_SOUND_CHOICE;
}

/** The pack that actually plays for a choice, given the current UI theme. */
export function packFor(choice: SoundChoice, themeId: string | null | undefined): PackId {
  if (choice !== "theme") return choice;
  return THEME_PACK[themeId ?? ""] ?? FALLBACK_PACK;
}

// --- state ---------------------------------------------------------------------------------------

const listeners = new Set<() => void>();
let choice: SoundChoice = DEFAULT_SOUND_CHOICE;

/** Startup: applies ?sounds= or the saved choice without saving anything. */
export function initSoundChoice() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(SOUNDS_KEY);
  } catch {
    /* storage blocked: the default it is */
  }
  choice = resolveSoundChoice(new URLSearchParams(location.search).get("sounds"), saved);
}

export function getSoundChoice(): SoundChoice {
  return choice;
}

/** A player's explicit choice: applied and remembered. */
export function setSoundChoice(next: SoundChoice) {
  choice = next;
  try {
    localStorage.setItem(SOUNDS_KEY, next);
  } catch {
    /* not remembered, still applied */
  }
  listeners.forEach((l) => l());
}

/** The pack playing right now (resolves "match theme" against the theme on <html>). */
export function activePack(): PackId {
  return packFor(choice, document.documentElement.dataset.theme);
}

export function useSoundChoice(): SoundChoice {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => choice,
  );
}
