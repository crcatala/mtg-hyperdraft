// Turns an import source (CubeCobra link or pasted list) into an ImportResult. Shared by the room
// Durable Object and offline solo mode, which runs the same lookups straight from the browser
// (Scryfall and CubeCobra both allow cross-origin requests).

import type { BasicLand } from "./types";
import { BASIC_NAMES } from "./types";
import { parseImport, type ImportEntry } from "./importParser";
import { fetchCubeCobra, resolveEntries, type FetchLike } from "./cardSources";
import type { ImportResult } from "./room";

/** Throws an Error with a player-facing message when the import fails. */
export async function importCube(source: string, fetchFn: FetchLike, onProgress: (message: string) => void): Promise<ImportResult> {
  const parsed = parseImport(source);
  let name: string;
  let entries: ImportEntry[];
  let warnings: string[] = [];
  if (parsed.kind === "cubecobra") {
    onProgress("Fetching cube from CubeCobra…");
    const cube = await fetchCubeCobra(parsed.id, fetchFn);
    name = cube.name;
    entries = cube.entries;
  } else {
    name = "Custom list";
    entries = parsed.entries;
    warnings = parsed.warnings;
  }
  if (entries.length === 0) throw new Error("No cards found in that list.");

  const res = await resolveEntries(entries, fetchFn, { onProgress });
  const basicKeys = Object.keys(BASIC_NAMES) as BasicLand[];
  const basics = await resolveEntries(
    basicKeys.map((b) => ({ name: BASIC_NAMES[b], count: 1 })),
    fetchFn,
    { delayMs: 100 },
  );
  const basicIds: ImportResult["basics"] = {};
  for (const card of basics.cards) {
    const key = basicKeys.find((b) => BASIC_NAMES[b] === card.name);
    if (key) basicIds[key] = card.id;
  }

  if (res.pool.length === 0) throw new Error("None of those cards were found on Scryfall.");
  return {
    name: parsed.kind === "list" ? `${name} (${res.pool.length} cards)` : name,
    source: parsed.kind === "cubecobra" ? `cubecobra:${parsed.id}` : "pasted list",
    cards: [...res.cards, ...basics.cards],
    pool: res.pool,
    notFound: res.notFound,
    warnings: [...warnings, ...res.warnings],
    basics: basicIds,
  };
}
