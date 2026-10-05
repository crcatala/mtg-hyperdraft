// The two volumes that aren't music's own: the master volume (everything) and the sound effects
// volume. Music keeps its own volume and mute in music.ts. What you hear is master × the channel's own
// volume, so master can be turned down for everything at once. Remembered per browser.
//
// The master default sits below full on purpose: a first visit shouldn't blast.

import { useSyncExternalStore } from "react";

export interface Volumes {
  /** 0–1, scales everything. */
  master: number;
  /** 0–1, sound effects only. */
  sfx: number;
}
export const DEFAULT_VOLUMES: Volumes = { master: 0.7, sfx: 1 };
/** localStorage key for the saved Volumes (JSON). */
export const VOLUME_KEY = "hd.volume";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Saved volumes from storage text; anything missing or malformed falls back to the default. */
export function parseVolumes(raw: string | null | undefined): Volumes {
  let v: Partial<Record<keyof Volumes, unknown>> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") v = parsed;
  } catch {
    // Corrupt: the defaults it is.
  }
  const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) ? clamp01(x) : fallback);
  return { master: num(v.master, DEFAULT_VOLUMES.master), sfx: num(v.sfx, DEFAULT_VOLUMES.sfx) };
}

const listeners = new Set<() => void>();
let volumes: Volumes = DEFAULT_VOLUMES;

function set(patch: Partial<Volumes>) {
  volumes = { ...volumes, ...patch };
  try {
    localStorage.setItem(VOLUME_KEY, JSON.stringify(volumes));
  } catch {
    // Not remembered, still applied.
  }
  listeners.forEach((l) => l());
}

/** Startup: reads the saved volumes. */
export function initVolumes() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(VOLUME_KEY);
  } catch {
    // Storage blocked: the defaults it is.
  }
  volumes = parseVolumes(saved);
}

export const getVolumes = () => volumes;
export const setMasterVolume = (v: number) => set({ master: clamp01(v) });
export const setSfxVolume = (v: number) => set({ sfx: clamp01(v) });

/** Calls `cb` whenever either volume changes (for the audio code that has to re-apply them). */
export function onVolumes(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useVolumes(): Volumes {
  return useSyncExternalStore(onVolumes, () => volumes);
}
