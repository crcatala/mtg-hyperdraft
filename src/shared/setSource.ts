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

const PAGE_SIZE = 175; // Scryfall search results per page.
const MAX_PAGES = 12; // The biggest draftable sets (Commander Masters, ~1,070 printings) need 7.
/** More printings than this is a catch-all list (The List, Secret Lair), not a set to draft; paging it would take too long. */
export const MAX_SET_PRINTINGS = MAX_PAGES * PAGE_SIZE;

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
  if (set.card_count > MAX_SET_PRINTINGS) return tooBig(set, set.card_count);
  return null;
}

/** `atLeast`: paging stopped at the cap, so the real count is higher. */
function tooBig(set: ScryfallSet, printings: number, atLeast = false): string {
  return `${setLabel(set)} has ${atLeast ? "more than " : ""}${printings.toLocaleString("en-US")} printings, too many to import as one set.`;
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
  let set: ScryfallSet;
  try {
    set = (await res.json()) as ScryfallSet;
  } catch {
    // A cut-off or non-JSON body (a proxy's error page, say): as good as not reaching Scryfall.
    return { ok: false, message: "Couldn't read Scryfall's answer for that set code.", retry: true };
  }
  const problem = setProblem(set);
  return problem ? { ok: false, message: problem } : { ok: true, set };
}

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
    if (res.status === 404) {
      url = null; // Scryfall's "no cards matched".
      break;
    }
    if (!res.ok) throw new Error(`Scryfall card search failed (${res.status}).`);
    const body = (await res.json()) as { data: ScryfallCard[]; has_more?: boolean; next_page?: string; total_cards?: number };
    if (page === 0 && (body.total_cards ?? 0) > MAX_SET_PRINTINGS) throw new Error(tooBig(set, body.total_cards!));
    all.push(...body.data);
    url = body.has_more && body.next_page ? body.next_page : null;
  }
  // Never draft a silently truncated set.
  if (url) throw new Error(tooBig(set, all.length, true));

  const cards = mainSetPrintings(all);
  if (cards.length === 0) throw new Error(`${setLabel(set)} has no regular booster cards to draft.`);
  const skipped = all.length - cards.length;
  const warnings =
    skipped > 0 ? [`One of each of the ${cards.length} main-set cards; skipped ${skipped} other printing(s) (alternate art, promos, deck-only cards, basic lands).`] : [];
  return { set, cards, warnings };
}
