// What changed between two table states, as far as animation cares: cards changing zone (draws,
// plays, discards, mills…), mulligans, shuffles and taps. Pure so it can be unit tested; the
// motion director (motion.ts) turns it into flights.

import type { TableCard, TableState } from "../../shared/types";
import type { PileZone } from "../../shared/tableLayout";

export type Spot =
  | { kind: "battlefield" }
  | { kind: "pile"; owner: string; zone: PileZone }
  | { kind: "hand"; owner: string }
  /** Doesn't exist (a token being created, or one that left the battlefield and ceased to exist). */
  | { kind: "none" };

export interface Hop {
  /** The card's id after the move. */
  id: string;
  /**
   * Its id before: different when the viewer knows it by a new id now (a hidden card revealed, or
   * given a new stand-in). Anything looked up from the old state (hand DOM, live poses) uses this.
   */
  fromId: string;
  from: Spot;
  to: Spot;
  /** The card before and after (either is missing for tokens appearing / disappearing). */
  prev?: TableCard;
  next?: TableCard;
  /** Hops in phase 1 start once phase 0 is done (a mulligan's new hand is drawn after the old one is shuffled away). */
  phase: 0 | 1;
}

export interface TableChanges {
  hops: Hop[];
  /** Players whose library was shuffled. */
  shuffled: string[];
  /** Players who took a mulligan. */
  mulligans: string[];
  /** Battlefield cards whose tapped state changed, when several changed at once (e.g. untap all), left to right. */
  taps: string[];
  /** Cards that got a new id without going anywhere (old id → new), e.g. a face-down card turned up. */
  renamed: Record<string, string>;
}

export function spotOf(card: TableCard | undefined): Spot {
  if (!card) return { kind: "none" };
  if (card.zone === "battlefield") return { kind: "battlefield" };
  if (card.zone === "hand") return { kind: "hand", owner: card.owner };
  return { kind: "pile", owner: card.owner, zone: card.zone };
}

export function sameSpot(a: Spot, b: Spot): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "pile" && b.kind === "pile") return a.owner === b.owner && a.zone === b.zone;
  if (a.kind === "hand" && b.kind === "hand") return a.owner === b.owner;
  return true;
}

/** A different game (or the first table state): nothing to animate. */
function unrelated(prev: TableState, next: TableState): boolean {
  return next.nextZ < prev.nextZ || prev.seats.join() !== next.seats.join();
}

export function diffTables(prev: TableState | null | undefined, next: TableState | null | undefined): TableChanges {
  const out: TableChanges = { hops: [], shuffled: [], mulligans: [], taps: [], renamed: {} };
  if (!prev || !next || unrelated(prev, next)) return out;

  const ids = new Set([...Object.keys(prev.cards), ...Object.keys(next.cards)]);
  const moved: Hop[] = [];
  const tapped: TableCard[] = [];
  const gone: TableCard[] = [];
  const added: TableCard[] = [];
  for (const id of ids) {
    const a = prev.cards[id];
    const b = next.cards[id];
    if (a && b) {
      if (!sameSpot(spotOf(a), spotOf(b))) moved.push({ id, fromId: id, from: spotOf(a), to: spotOf(b), prev: a, next: b, phase: 0 });
      else if (a.zone === "battlefield" && a.tapped !== b.tapped) tapped.push(b);
    } else if (a) gone.push(a);
    else if (b) added.push(b);
  }

  // Hidden cards change id: revealed ones get their real id, and shuffles (or a card leaving a hand
  // unseen) give them new stand-ins. Such a card shows up as one card gone and another new: pair
  // them up by owner, same place first (renamed), then in order (moved). Only tokens really come
  // and go.
  const [pairs, left, arrived] = pairUp(prev, next, gone, added);
  for (const [a, b] of pairs) {
    if (sameSpot(spotOf(a), spotOf(b))) out.renamed[a.id] = b.id;
    else moved.push({ id: b.id, fromId: a.id, from: spotOf(a), to: spotOf(b), prev: a, next: b, phase: 0 });
  }
  for (const a of left) moved.push({ id: a.id, fromId: a.id, from: spotOf(a), to: { kind: "none" }, prev: a, phase: 0 });
  for (const b of arrived) moved.push({ id: b.id, fromId: b.id, from: { kind: "none" }, to: spotOf(b), next: b, phase: 0 });

  // Mulligan: the whole hand went into the library and a new one came out of it, in one update.
  // Whatever the ids did, it's shown as exactly that: the old hand out, then the new hand in.
  for (const pid of next.seats) {
    if (!counted(prev, next, pid, "mulligans")) continue;
    out.mulligans.push(pid);
    const library: Spot = { kind: "pile", owner: pid, zone: "library" };
    const hand: Spot = { kind: "hand", owner: pid };
    const oldHand = prev.players[pid]?.zones.hand ?? [];
    const newHand = next.players[pid]?.zones.hand ?? [];
    for (let i = moved.length - 1; i >= 0; i--) {
      const h = moved[i];
      if ((h.from.kind === "hand" && h.from.owner === pid) || (h.to.kind === "hand" && h.to.owner === pid)) moved.splice(i, 1);
    }
    for (const id of oldHand) moved.push({ id, fromId: id, from: hand, to: library, prev: prev.cards[id], next: next.cards[id], phase: 0 });
    for (const id of newHand) moved.push({ id, fromId: id, from: library, to: hand, prev: prev.cards[id], next: next.cards[id], phase: 1 });
  }
  out.hops = moved;

  for (const pid of next.seats) if (counted(prev, next, pid, "shuffles")) out.shuffled.push(pid);

  if (tapped.length > 1) out.taps = tapped.sort((p, q) => p.x - q.x || p.y - q.y).map((c) => c.id);
  return out;
}

/** Whether a player's shuffle / mulligan counter went up. */
function counted(prev: TableState, next: TableState, pid: string, key: "shuffles" | "mulligans"): boolean {
  return (next.players[pid]?.[key] ?? 0) > (prev.players[pid]?.[key] ?? 0);
}

/** Where a card sits in its zone, to pair cards up in order (top of the library first, and so on). */
function placeIn(t: TableState, card: TableCard): number {
  if (card.zone === "battlefield") return card.z;
  return t.players[card.owner]?.zones[card.zone].indexOf(card.id) ?? 0;
}

/**
 * Pairs cards that disappeared with cards that appeared, per owner: first those in the same place,
 * then the rest in order. Tokens aren't paired. Returns the pairs and what's left on either side.
 */
function pairUp(prev: TableState, next: TableState, gone: TableCard[], added: TableCard[]): [[TableCard, TableCard][], TableCard[], TableCard[]] {
  const byPlace = (t: TableState) => (p: TableCard, q: TableCard) => placeIn(t, p) - placeIn(t, q);
  const a = gone.filter((c) => !c.token).sort(byPlace(prev));
  const b = added.filter((c) => !c.token).sort(byPlace(next));
  const pairs: [TableCard, TableCard][] = [];
  const take = (match: (p: TableCard, q: TableCard) => boolean) => {
    for (let i = 0; i < a.length; i++) {
      const j = b.findIndex((q) => match(a[i], q));
      if (j < 0) continue;
      pairs.push([a[i], b[j]]);
      a.splice(i--, 1);
      b.splice(j, 1);
    }
  };
  take((p, q) => p.owner === q.owner && sameSpot(spotOf(p), spotOf(q)));
  take((p, q) => p.owner === q.owner);
  return [pairs, [...a, ...gone.filter((c) => c.token)], [...b, ...added.filter((c) => c.token)]];
}
