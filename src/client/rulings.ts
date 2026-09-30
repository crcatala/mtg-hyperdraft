// Official card rulings from Scryfall, fetched only when a player asks for them and kept for the
// rest of the session. Rulings belong to the card's oracle text, so every printing shares them.

import type { CardData } from "../shared/types";

export interface Ruling {
  /** "wotc" for Wizards' rulings, "scryfall" for Scryfall's own notes. */
  source: string;
  publishedAt: string;
  comment: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const loaded = new Map<string, Ruling[]>();
const pending = new Map<string, Promise<Ruling[]>>();

/** Only real Scryfall printings have rulings to look up. */
export function hasRulingsLookup(card: CardData): boolean {
  return UUID.test(card.id);
}

/** Rulings already fetched this session, or undefined if they haven't been asked for yet. */
export function cachedRulings(card: CardData): Ruling[] | undefined {
  return loaded.get(card.oracleId);
}

export function fetchRulings(card: CardData, fetchFn: FetchLike = (url, init) => fetch(url, init)): Promise<Ruling[]> {
  const key = card.oracleId;
  const done = loaded.get(key);
  if (done) return Promise.resolve(done);
  let p = pending.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetchFn(`https://api.scryfall.com/cards/${card.id}/rulings`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Scryfall rulings lookup failed (${res.status})`);
      const body = (await res.json()) as { data?: { source: string; published_at: string; comment: string }[] };
      const rulings = (body.data ?? []).map((r) => ({ source: r.source, publishedAt: r.published_at, comment: r.comment }));
      loaded.set(key, rulings);
      return rulings;
    })().finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

/** Test hook: forget everything fetched so far. */
export function clearRulingsCache(): void {
  loaded.clear();
  pending.clear();
}
