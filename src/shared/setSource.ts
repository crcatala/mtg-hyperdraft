// Imports a whole Magic set by its code ("WTH", "MH3") from Scryfall: one copy of every card a
// booster of that set can contain, without alternate-art treatments, promos, deck-only cards or basics.
// The lobby also uses `checkSet` to validate a code as the host types it.

import { HEADERS, SCRYFALL, SCRYFALL_CARD_DELAY_MS, type FetchLike, type ScryfallCard } from "./cardSources";

export interface ScryfallSet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital?: boolean;
  icon_svg_uri?: string;
}

export type SetCheck =
  | { ok: true; set: ScryfallSet }
  /** `retry`: Scryfall couldn't be reached, so the code itself may be fine. */
  | { ok: false; message: string; retry?: boolean };

/** "Weatherlight (WTH)". */
export function setLabel(set: ScryfallSet): string {
  return `${set.name} (${set.code.toUpperCase()})`;
}

/** Why a set can't be drafted, or null when it can. */
export function setProblem(set: ScryfallSet): string | null {
  const label = setLabel(set);
  switch (set.set_type) {
    case "token":
      return `${label} is a token set, so there are no cards to draft in it.`;
    case "memorabilia":
      return `${label} is a memorabilia set (art cards and collectibles), not one you can draft.`;
    case "minigame":
    case "vanguard":
      return `${label} isn't made of regular Magic cards.`;
    case "promo":
      return `${label} only has promo printings of other sets' cards. Try the main set's code instead.`;
  }
  if (set.card_count === 0) return `${label} has no cards on Scryfall yet.`;
  return null;
}

/** Looks a set code up on Scryfall and checks it can be drafted. Never throws. */
export async function checkSet(code: string, fetchFn: FetchLike): Promise<SetCheck> {
  let res: Response;
  try {
    res = await fetchFn(`${SCRYFALL}/sets/${encodeURIComponent(code)}`, { headers: HEADERS });
  } catch {
    return { ok: false, message: "Couldn't reach Scryfall to check that set code.", retry: true };
  }
  if (res.status === 404) return { ok: false, message: `No Magic set has the code "${code.toUpperCase()}".` };
  if (!res.ok) return { ok: false, message: `Scryfall set lookup failed (${res.status}).`, retry: true };
  const set = (await res.json()) as ScryfallSet;
  const problem = setProblem(set);
  return problem ? { ok: false, message: problem } : { ok: true, set };
}

const MAX_PAGES = 12; // 175 printings a page; the biggest real sets need about 7.
/** Layouts that aren't cards you put in a deck. */
const EXTRA_LAYOUTS = new Set(["token", "double_faced_token", "emblem", "art_series", "planar", "scheme", "vanguard"]);
/** Alternate-art treatments (Booster Fun, collector-booster variants). */
const SPECIAL_FRAMES = new Set(["showcase", "extendedart", "inverted", "etched"]);

function isSpecialPrinting(c: ScryfallCard): boolean {
  return !!c.promo || !!c.variation || c.border_color === "borderless" || (c.frame_effects ?? []).some((f) => SPECIAL_FRAMES.has(f));
}

function typeLine(c: ScryfallCard): string {
  return c.type_line ?? c.card_faces?.[0]?.type_line ?? "";
}

/**
 * The set as drafters know it: one printing per card, from the printings found in boosters (every
 * printing, for sets with no boosters), skipping alternate-art treatments, promos and plain basic
 * lands (the lobby supplies basics; snow basics stay since they're real picks).
 */
export function mainSetPrintings(cards: ScryfallCard[]): ScryfallCard[] {
  const playable = cards.filter((c) => !EXTRA_LAYOUTS.has(c.layout) && !/^Basic Land\b/.test(typeLine(c)));
  const inBoosters = playable.filter((c) => c.booster);
  const seen = new Set<string>();
  const out: ScryfallCard[] = [];
  for (const c of inBoosters.length > 0 ? inBoosters : playable) {
    if (isSpecialPrinting(c)) continue;
    const key = c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? c.name;
    if (seen.has(key)) continue; // Same card again: the other arts of old commons, numbered copies like LTR's Nazgûl.
    seen.add(key);
    out.push(c);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Throws an Error with a player-facing message when the set is unknown, can't be drafted or is empty. */
export async function fetchSetCards(
  code: string,
  fetchFn: FetchLike,
  onProgress: (message: string) => void = () => {},
  delayMs = SCRYFALL_CARD_DELAY_MS,
): Promise<{ set: ScryfallSet; cards: ScryfallCard[]; warnings: string[] }> {
  onProgress(`Looking up set ${code.toUpperCase()} on Scryfall…`);
  const check = await checkSet(code, fetchFn);
  if (!check.ok) throw new Error(check.message);
  const { set } = check;

  const all: ScryfallCard[] = [];
  let url: string | null = `${SCRYFALL}/cards/search?q=${encodeURIComponent(`set:${set.code}`)}&unique=prints&order=set`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    await sleep(delayMs);
    onProgress(`Fetching ${setLabel(set)} cards${all.length ? ` (${all.length} so far)` : ""}…`);
    const res: Response = await fetchFn(url, { headers: HEADERS });
    if (res.status === 404) break; // Scryfall's "no cards matched".
    if (!res.ok) throw new Error(`Scryfall card search failed (${res.status}).`);
    const body = (await res.json()) as { data: ScryfallCard[]; has_more?: boolean; next_page?: string };
    all.push(...body.data);
    url = body.has_more && body.next_page ? body.next_page : null;
  }

  const cards = mainSetPrintings(all);
  if (cards.length === 0) throw new Error(`${setLabel(set)} has no regular booster cards to draft.`);
  const skipped = all.length - cards.length;
  const warnings =
    skipped > 0 ? [`One of each of the ${cards.length} main-set cards; skipped ${skipped} other printing(s) (alternate art, promos, deck-only cards, basic lands).`] : [];
  return { set, cards, warnings };
}
