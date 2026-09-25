// Cubes bundled with the site as static JSON snapshots (public/presets/<id>.json), so a first-time
// visitor can start drafting with one click and no Scryfall/CubeCobra lookups.
// Regenerate with `npm run presets:build`.

import type { ImportResult } from "./room";

export interface PresetCube {
  id: string;
  name: string;
  cards: number;
  /** Where the snapshot came from; `npm run presets:build` imports this source. */
  from: string;
}

export const PRESET_CUBES: PresetCube[] = [{ id: "hypercube", name: "Hypercube", cards: 384, from: "https://cubecobra.com/cube/list/hc" }];

const PREFIX = "preset:";

export function presetSource(id: string): string {
  return PREFIX + id;
}

/** The bundled preset an import source refers to (`preset:<id>`), or null for anything else. */
export function presetFor(source: string): PresetCube | null {
  const s = source.trim();
  if (!s.startsWith(PREFIX)) return null;
  return PRESET_CUBES.find((p) => p.id === s.slice(PREFIX.length)) ?? null;
}

export function presetPath(preset: PresetCube): string {
  return `/presets/${preset.id}.json`;
}

/** Light sanity check on a fetched snapshot, so a bad deploy fails with a readable message. */
export function checkPreset(data: unknown, preset: PresetCube): ImportResult {
  const r = data as ImportResult;
  if (!r || !Array.isArray(r.cards) || !Array.isArray(r.pool) || r.pool.length === 0 || typeof r.name !== "string") {
    throw new Error(`The bundled ${preset.name} cube looks damaged. Try importing it from CubeCobra instead.`);
  }
  return r;
}
