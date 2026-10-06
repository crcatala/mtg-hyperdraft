// Turns an import source (bundled preset, CubeCobra link, set code or pasted list) into an ImportResult. Shared
// by the room Durable Object and offline solo mode, which runs the same lookups straight from the
// browser (Scryfall and CubeCobra both allow cross-origin requests).

import type { BasicLand } from "./types";
import { BASIC_NAMES } from "./types";
import { parseImport, type ImportEntry } from "./importParser";
import { fetchCubeCobra, resolveEntries, toCardData, type FetchLike, type ResolveResult } from "./cardSources";
import { fetchSetCards, setLabel } from "./setSource";
import type { ImportResult } from "./room";
import { checkPreset, presetFor, presetPath } from "./presets";

/**
 * Throws an Error with a player-facing message when the import fails. `fetchAsset` loads the site's
 * own static files (bundled presets): the browser can use plain fetch, the Worker uses its ASSETS binding.
 */
export async function importCube(
  source: string,
  fetchFn: FetchLike,
  onProgress: (message: string) => void,
  fetchAsset: (path: string) => Promise<Response> = fetchFn,
): Promise<ImportResult> {
  const preset = presetFor(source);
  if (preset) {
    onProgress(`Loading the bundled ${preset.name}…`);
    const res = await fetchAsset(presetPath(preset));
    if (!res.ok) throw new Error(`Couldn't load the bundled ${preset.name} (${res.status}).`);
    return checkPreset(await res.json(), preset);
  }

  const parsed = parseImport(source);
  let res: ResolveResult;
  let name = "Custom list";
  let resultSource: string;
  if (parsed.kind === "set") {
    const set = await fetchSetCards(parsed.code, fetchFn, onProgress);
    const cards = set.cards.map(toCardData);
    res = { cards, pool: cards.map((c) => c.id), notFound: [], warnings: set.warnings };
    name = setLabel(set.set);
    resultSource = `set:${set.set.code}`;
  } else {
    let entries: ImportEntry[];
    let warnings: string[] = [];
    if (parsed.kind === "cubecobra") {
      onProgress("Fetching cube from CubeCobra…");
      const cube = await fetchCubeCobra(parsed.id, fetchFn);
      name = cube.name;
      entries = cube.entries;
      resultSource = `cubecobra:${parsed.id}`;
    } else {
      entries = parsed.entries;
      warnings = parsed.warnings;
      resultSource = "pasted list";
    }
    if (entries.length === 0) throw new Error("No cards found in that list.");
    res = await resolveEntries(entries, fetchFn, { onProgress });
    res.warnings.unshift(...warnings);
    if (res.pool.length === 0) throw new Error("None of those cards were found on Scryfall.");
    if (parsed.kind === "list") name = `Custom list (${res.pool.length} cards)`;
  }

  const basicKeys = Object.keys(BASIC_NAMES) as BasicLand[];
  const basics = await resolveEntries(
    basicKeys.map((b) => ({ name: BASIC_NAMES[b], count: 1 })),
    fetchFn,
  );
  const basicIds: ImportResult["basics"] = {};
  for (const card of basics.cards) {
    const key = basicKeys.find((b) => BASIC_NAMES[b] === card.name);
    if (key) basicIds[key] = card.id;
  }

  return {
    name,
    source: resultSource,
    cards: [...res.cards, ...basics.cards],
    pool: res.pool,
    notFound: res.notFound,
    warnings: res.warnings,
    basics: basicIds,
  };
}
