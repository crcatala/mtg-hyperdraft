// Every Magic set from Scryfall's /sets (one free request, ~70KB gzipped), for the lobby's set picker:
// search by name or code, and check a typed code without asking Scryfall again. Kept in localStorage
// for a day, as Scryfall asks API users to cache.

import { useEffect, useState } from "react";
import { HEADERS, SCRYFALL } from "../shared/cardSources";
import { setProblem, type ScryfallSet } from "../shared/setSource";

const KEY = "hyperdraft.setCatalog.v1";
const TTL_MS = 24 * 60 * 60 * 1000;
/** Sets sold as draft, set or play boosters. Precons, Secret Lairs, digital sets etc. are "other products". */
const BOOSTER_TYPES = new Set(["expansion", "core", "masters", "draft_innovation", "funny"]);

let loaded: ScryfallSet[] | null = null;
let loading: Promise<ScryfallSet[]> | null = null;

function readCache(now: number): ScryfallSet[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; sets: ScryfallSet[] };
    return now - cached.at < TTL_MS && Array.isArray(cached.sets) ? cached.sets : null;
  } catch {
    return null;
  }
}

function writeCache(sets: ScryfallSet[], now: number) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: now, sets }));
  } catch {
    // Storage full or blocked: the list just gets fetched again next time.
  }
}

/** Loads the catalog once per session (from the day's cache when there is one). */
export function loadSetCatalog(fetchFn: typeof fetch = (url, init) => fetch(url, init)): Promise<ScryfallSet[]> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = (async () => {
      const now = Date.now();
      const cached = readCache(now);
      if (cached) return (loaded = cached);
      const res = await fetchFn(`${SCRYFALL}/sets`, { headers: HEADERS });
      if (!res.ok) throw new Error(`Scryfall set list failed (${res.status})`);
      const body = (await res.json()) as { data: ScryfallSet[] };
      // Only what the picker needs: the full list is ~600KB, this is ~190KB.
      const sets = body.data.map(({ code, name, set_type, released_at, card_count, digital, icon_svg_uri }) => ({
        code,
        name,
        set_type,
        released_at,
        card_count,
        ...(digital ? { digital } : {}),
        icon_svg_uri,
      }));
      writeCache(sets, now);
      return (loaded = sets);
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

/** The catalog once `active` (the picker has been opened); null while loading or if Scryfall is unreachable. */
export function useSetCatalog(active: boolean): ScryfallSet[] | null {
  const [sets, setSets] = useState<ScryfallSet[] | null>(loaded);
  useEffect(() => {
    if (!active || sets) return;
    let live = true;
    loadSetCatalog().then(
      (list) => live && setSets(list),
      () => {}, // The picker falls back to checking typed codes one at a time.
    );
    return () => {
      live = false;
    };
  }, [active, sets]);
  return sets;
}

export function isBoosterSet(set: ScryfallSet): boolean {
  return BOOSTER_TYPES.has(set.set_type) && !set.digital;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Draftable sets matching a name or code, best match first (exact code, code prefix, a word of the name
 * starting with it, then anywhere in the name), newest first within each. Empty query: newest sets.
 * Only booster sets unless `includeOther`; an exact code match is always included.
 */
export function searchSets(sets: ScryfallSet[], query: string, includeOther: boolean): ScryfallSet[] {
  const q = fold(query.replace(/^(?:set|e):\s*/i, ""));
  const scored: { set: ScryfallSet; score: number }[] = [];
  for (const set of sets) {
    if (setProblem(set)) continue;
    const exact = q !== "" && set.code === q;
    if (!exact && !includeOther && !isBoosterSet(set)) continue;
    const name = fold(set.name);
    let score: number;
    if (!q) score = 0;
    else if (exact) score = 0;
    else if (set.code.startsWith(q)) score = 1;
    else if (name.split(/[\s:'-]+/).some((w) => w.startsWith(q))) score = 2;
    else if (q.split(/\s+/).every((t) => name.includes(t))) score = 3;
    else continue;
    scored.push({ set, score });
  }
  return scored.sort((a, b) => a.score - b.score || (b.set.released_at ?? "").localeCompare(a.set.released_at ?? "")).map((s) => s.set);
}

/** "draft_innovation" → "Draft innovation". */
export function setTypeLabel(type: string): string {
  if (type === "core") return "Core set";
  if (type === "funny") return "Un-set";
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Test hook. */
export function resetSetCatalog(): void {
  loaded = null;
  loading = null;
}
