// Resolves import entries into card data via Scryfall (and CubeCobra for cube URLs).
// `fetch` is injected so the Worker can pass its global fetch and tests can pass a fake.

import type { CardData, CardFaceData, CardImages, Color, Rarity } from "./types";
import { frontFaceName, type ImportEntry } from "./importParser";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const SCRYFALL = "https://api.scryfall.com";
const HEADERS = {
  // Scryfall asks API clients to identify themselves and send an Accept header.
  "User-Agent": "HyperDraft/0.1 (private MTG cube drafting with friends)",
  Accept: "application/json",
};
const BATCH = 75; // Scryfall /cards/collection maximum.
const MAX_FUZZY = 25;

export interface ResolveResult {
  cards: CardData[];
  /** Card id per copy, in import order. */
  pool: string[];
  notFound: string[];
  warnings: string[];
}

export interface ResolveOptions {
  /** Pause between Scryfall requests (they ask for 50–100ms). */
  delayMs?: number;
  onProgress?: (message: string) => void;
}

type Identifier = { id: string } | { name: string } | { name: string; set: string } | { set: string; collector_number: string };

function identifierFor(e: ImportEntry): Identifier {
  if (e.id) return { id: e.id };
  if (e.set && e.collectorNumber) return { set: e.set, collector_number: e.collectorNumber };
  if (e.set) return { name: e.name, set: e.set };
  return { name: e.name };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function resolveEntries(
  entries: ImportEntry[],
  fetchFn: FetchLike,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  const delay = opts.delayMs ?? 100;
  const warnings: string[] = [];
  const cardsById = new Map<string, CardData>();
  const resolved = new Map<ImportEntry, string>();

  async function lookup(batch: ImportEntry[], ids: (e: ImportEntry) => Identifier, byNameOnly = false) {
    const res = await fetchFn(`${SCRYFALL}/cards/collection`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map(ids) }),
    });
    if (!res.ok) throw new Error(`Scryfall lookup failed (${res.status})`);
    const body = (await res.json()) as { data: ScryfallCard[] };
    for (const raw of body.data) {
      const card = toCardData(raw);
      if (!cardsById.has(card.id)) cardsById.set(card.id, card);
      for (const e of batch) {
        if (!resolved.has(e) && entryMatches(byNameOnly ? { name: e.name, count: 1 } : e, raw)) resolved.set(e, card.id);
      }
    }
  }

  const batches = chunk(entries, BATCH);
  for (let i = 0; i < batches.length; i++) {
    opts.onProgress?.(`Looking up cards ${i * BATCH + 1}–${Math.min((i + 1) * BATCH, entries.length)} of ${entries.length}…`);
    await lookup(batches[i], identifierFor);
    if (i < batches.length - 1) await sleep(delay);
  }

  // Printing not found (bad set/number)? Fall back to the plain name.
  const retry = entries.filter((e) => !resolved.has(e) && (e.set || e.id));
  if (retry.length > 0) {
    for (const b of chunk(retry, BATCH)) {
      await sleep(delay);
      await lookup(b, (e) => ({ name: e.name }), true);
    }
    const fixed = retry.filter((e) => resolved.has(e)).length;
    if (fixed > 0) warnings.push(`${fixed} card(s) used a different printing than requested.`);
  }

  // Typos: try Scryfall's fuzzy name match for what's left.
  const missing = entries.filter((e) => !resolved.has(e));
  for (const e of missing.slice(0, MAX_FUZZY)) {
    await sleep(delay);
    const res = await fetchFn(`${SCRYFALL}/cards/named?fuzzy=${encodeURIComponent(e.name)}`, { headers: HEADERS });
    if (!res.ok) continue;
    const card = toCardData((await res.json()) as ScryfallCard);
    if (!cardsById.has(card.id)) cardsById.set(card.id, card);
    resolved.set(e, card.id);
    warnings.push(`"${e.name}" matched as "${card.name}".`);
  }

  const pool: string[] = [];
  const notFound: string[] = [];
  for (const e of entries) {
    const id = resolved.get(e);
    if (!id) {
      notFound.push(e.name);
      continue;
    }
    if (e.elo !== undefined) cardsById.get(id)!.elo = e.elo;
    for (let i = 0; i < e.count; i++) pool.push(id);
  }
  return { cards: [...cardsById.values()], pool, notFound, warnings };
}

function entryMatches(e: ImportEntry, raw: ScryfallCard): boolean {
  if (e.id) return e.id === raw.id;
  if (e.set && e.collectorNumber) {
    return e.set === raw.set && e.collectorNumber.toLowerCase() === raw.collector_number.toLowerCase();
  }
  const wanted = normalizeName(e.name);
  const names = [raw.name, frontFaceName(raw.name), ...(raw.card_faces ?? []).map((f) => f.name)].map(normalizeName);
  if (!names.includes(wanted)) return false;
  return !e.set || e.set === raw.set;
}

/** Case- and accent-insensitive name key ("Lim-Dûl's Vault" == "lim-dul's vault"). */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .trim();
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// --- CubeCobra --------------------------------------------------------------------------------

interface CubeCobraCard {
  cardID: string;
  finish?: string;
  details?: { name?: string; elo?: number };
}
interface CubeCobraCube {
  name: string;
  cards: { mainboard: CubeCobraCard[] };
}

export async function fetchCubeCobra(id: string, fetchFn: FetchLike): Promise<{ name: string; entries: ImportEntry[] }> {
  const res = await fetchFn(`https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CubeCobra returned ${res.status} for cube "${id}". Is the cube public?`);
  const cube = (await res.json()) as CubeCobraCube;
  const entries: ImportEntry[] = cube.cards.mainboard.map((c) => ({
    id: c.cardID,
    name: c.details?.name ?? c.cardID,
    count: 1,
    elo: c.details?.elo,
    ...(c.finish === "Foil" ? { foil: true } : {}),
  }));
  return { name: cube.name, entries };
}

// --- Scryfall → CardData ----------------------------------------------------------------------

interface ScryfallFace {
  name: string;
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors?: string[];
  image_uris?: Record<string, string>;
}

export interface ScryfallCard extends ScryfallFace {
  id: string;
  oracle_id?: string;
  layout: string;
  cmc?: number;
  color_identity?: string[];
  rarity: string;
  set: string;
  collector_number: string;
  artist?: string;
  card_faces?: ScryfallFace[];
  all_parts?: { id: string; name: string; component: string }[];
}

function pickImages(uris?: Record<string, string>): CardImages | undefined {
  if (!uris) return undefined;
  return { small: uris.small, normal: uris.normal, large: uris.large };
}

const COLOR_SET = new Set(["W", "U", "B", "R", "G"]);
const toColors = (c?: string[]) => (c ?? []).filter((x): x is Color => COLOR_SET.has(x));

function toRarity(r: string): Rarity {
  if (r === "common" || r === "uncommon" || r === "rare" || r === "mythic") return r;
  return "special";
}

export function toCardData(raw: ScryfallCard): CardData {
  const faces: CardFaceData[] | undefined = raw.card_faces?.map((f) => ({
    name: f.name,
    manaCost: f.mana_cost ?? "",
    typeLine: f.type_line ?? "",
    oracleText: f.oracle_text ?? "",
    power: f.power,
    toughness: f.toughness,
    loyalty: f.loyalty,
    colors: toColors(f.colors ?? raw.colors),
    images: pickImages(f.image_uris),
  }));
  const front = faces?.[0];
  const colors = toColors(raw.colors ?? (faces ? [...new Set(faces.flatMap((f) => f.colors))] : []));
  return {
    id: raw.id,
    oracleId: raw.oracle_id ?? raw.id,
    name: raw.name,
    layout: raw.layout,
    manaCost: raw.mana_cost ?? front?.manaCost ?? "",
    cmc: raw.cmc ?? 0,
    typeLine: raw.type_line ?? front?.typeLine ?? "",
    oracleText: raw.oracle_text ?? faces?.map((f) => f.oracleText).join("\n—\n") ?? "",
    power: raw.power ?? front?.power,
    toughness: raw.toughness ?? front?.toughness,
    loyalty: raw.loyalty ?? front?.loyalty,
    colors,
    colorIdentity: toColors(raw.color_identity),
    rarity: toRarity(raw.rarity),
    set: raw.set,
    collectorNumber: raw.collector_number,
    artist: raw.artist,
    images: pickImages(raw.image_uris) ?? front?.images,
    faces,
    tokens: raw.all_parts?.filter((p) => p.component === "token").map((p) => ({ id: p.id, name: p.name })),
  };
}
