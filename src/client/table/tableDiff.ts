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
  id: string;
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
  const out: TableChanges = { hops: [], shuffled: [], mulligans: [], taps: [] };
  if (!prev || !next || unrelated(prev, next)) return out;

  const ids = new Set([...Object.keys(prev.cards), ...Object.keys(next.cards)]);
  const moved: Hop[] = [];
  const tapped: TableCard[] = [];
  for (const id of ids) {
    const a = prev.cards[id];
    const b = next.cards[id];
    const from = spotOf(a);
    const to = spotOf(b);
    if (!sameSpot(from, to)) moved.push({ id, from, to, prev: a, next: b, phase: 0 });
    else if (a && b && a.zone === "battlefield" && a.tapped !== b.tapped) tapped.push(b);
  }

  // Mulligan: the whole hand went into the library and a new one came out of it, in one update.
  // Cards that happen to be redrawn never changed zone, so they get both legs explicitly.
  for (const pid of next.seats) {
    const toLibrary = moved.some((h) => h.from.kind === "hand" && h.from.owner === pid && h.to.kind === "pile" && h.to.zone === "library");
    const fromLibrary = moved.some((h) => h.to.kind === "hand" && h.to.owner === pid && h.from.kind === "pile" && h.from.zone === "library");
    if (!toLibrary || !fromLibrary) continue;
    out.mulligans.push(pid);
    const library: Spot = { kind: "pile", owner: pid, zone: "library" };
    const hand: Spot = { kind: "hand", owner: pid };
    const oldHand = prev.players[pid]?.zones.hand ?? [];
    const newHand = next.players[pid]?.zones.hand ?? [];
    for (let i = moved.length - 1; i >= 0; i--) {
      const h = moved[i];
      if ((h.from.kind === "hand" && h.from.owner === pid) || (h.to.kind === "hand" && h.to.owner === pid)) moved.splice(i, 1);
    }
    for (const id of oldHand) moved.push({ id, from: hand, to: library, prev: prev.cards[id], next: next.cards[id], phase: 0 });
    for (const id of newHand) moved.push({ id, from: library, to: hand, prev: prev.cards[id], next: next.cards[id], phase: 1 });
  }
  out.hops = moved;

  for (const pid of next.seats) {
    const a = prev.players[pid]?.zones.library ?? [];
    const b = next.players[pid]?.zones.library ?? [];
    if (out.mulligans.includes(pid)) out.shuffled.push(pid);
    else if (a.length === b.length && a.length > 1 && a.join() !== b.join() && [...a].sort().join() === [...b].sort().join()) out.shuffled.push(pid);
  }

  if (tapped.length > 1) out.taps = tapped.sort((p, q) => p.x - q.x || p.y - q.y).map((c) => c.id);
  return out;
}
