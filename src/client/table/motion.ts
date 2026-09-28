// Card motion on the table. Every state update is diffed against the previous one (tableDiff.ts);
// cards that changed zone get a "flight": a short-lived 3D card (Flights.tsx) that travels from
// where the card was to where it's going, while the real card waits hidden at its destination.
// Works the same for our own actions and everyone else's, since both arrive as state updates.

import { create } from "zustand";
import type { TableCard, TableState, TokenDef } from "../../shared/types";
import { CARD_W, MAT_D, localToTable, pilePosition, seatAngle } from "../../shared/tableLayout";
import { useStore } from "../store";
import { sfx } from "../sfx";
import { diffTables, type Hop, type Spot } from "./tableDiff";

/** Where a flight starts or ends. */
export type Anchor =
  /** Lying flat on the table (table coordinates), `h` above it, turned to `yaw`. */
  | { kind: "table"; x: number; y: number; h: number; yaw: number; scale?: number }
  /**
   * A DOM card in the hand: screen centre, width and roll (radians). With `id`, the position is
   * looked up live each frame (the hand fans out as cards arrive).
   */
  | { kind: "screen"; id?: string; cx: number; cy: number; w: number; roll: number };

export interface Flight {
  key: number;
  id: string;
  from: Anchor;
  to: Anchor;
  /** performance.now() when it starts moving, and how long it takes (ms). */
  start: number;
  duration: number;
  cardId?: string;
  token?: TokenDef;
  face: number;
  foil?: boolean;
  /** Face up at the start / end (it turns over mid-air in between). */
  faceFrom: boolean;
  faceTo: boolean;
  /** Extra height at mid-flight. */
  arc: number;
  /** Sideways detour at mid-flight in table coordinates (shuffle riffles). */
  swing?: { x: number; y: number };
  /** Shrinks away instead of landing (tokens leaving the battlefield). */
  vanish?: boolean;
  /** Invisible until it starts (the second leg of a mulligan). */
  hideBeforeStart?: boolean;
  /** Reveals the real card once this flight lands. */
  release: boolean;
}

interface MotionState {
  flights: Flight[];
  /** Cards on their way somewhere: hidden where they now are until their flight lands. */
  arriving: Record<string, true>;
  /** New tokens: performance.now() when their pop-in starts. */
  spawns: Record<string, number>;
  /** Stagger (ms) for cards tapped or untapped together, so "untap all" ripples across the table. */
  tapDelay: Record<string, number>;
}

export const useMotion = create<MotionState>(() => ({ flights: [], arriving: {}, spawns: {}, tapDelay: {} }));

/** Height of a card being dragged over the table (battlefield cards and cards from hand alike). */
export const DRAG_LIFT = 1.6;

/** Battlefield cards register a live pose getter, so cards leaving start exactly where they're drawn. */
export const livePoses = new Map<string, () => { x: number; y: number; h: number; yaw: number }>();

/** Where hand cards were let go over the table (they're drawn in 3D there while dragged). */
const dropHints = new Map<string, { x: number; y: number; h: number; yaw: number; at: number }>();

export function noteDrop(ids: string[], x: number, y: number, h: number, yaw: number) {
  const at = performance.now();
  for (const id of ids) dropHints.set(id, { x, y, h, yaw, at });
}

/** How much slower card animations run (the debug console's slow motion). */
export function motionScale() {
  return useStore.getState().debug.slowMotion ? 6 : 1;
}

export function reducedMotion() {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

let flightSeq = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const MAX_HOPS = 40;

/** Starts watching table updates. Returns the unsubscribe function. */
export function startTableMotion(): () => void {
  const unsubscribe = useStore.subscribe((s, prev) => {
    const a = prev.view?.table;
    const b = s.view?.table;
    if (a && b && a !== b) animateChange(a, b, s.view!.you);
  });
  return () => {
    unsubscribe();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    useMotion.setState({ flights: [], arriving: {}, spawns: {}, tapDelay: {} });
  };
}

function animateChange(prev: TableState, next: TableState, me: string) {
  const changes = diffTables(prev, next);
  const now = performance.now();
  if (reducedMotion() || document.hidden) return;
  const slow = motionScale();
  const tapDelay: Record<string, number> = {};
  changes.taps.forEach((id, i) => (tapDelay[id] = Math.min(i * 45, 600) * slow));
  useMotion.setState({ tapDelay });
  const hops = changes.hops;
  if (hops.length === 0 && changes.shuffled.length === 0) return;
  if (hops.length > MAX_HOPS) return;

  // A card that's moving again cancels whatever it was doing.
  const touched = new Set(hops.map((h) => h.id));
  cancel((f) => touched.has(f.id));

  const ctx: Ctx = { prev, next, me };
  const flights: Flight[] = [];
  const arriving: Record<string, true> = {};
  const spawns: Record<string, number> = {};
  const lastHop = new Map<string, Hop>();
  for (const h of hops) lastHop.set(h.id, h);

  // Cards travelling the same way leave one after another.
  const groups = new Map<string, number>();
  const groupKey = (h: Hop) => `${h.phase}|${spotKey(h.from)}|${spotKey(h.to)}`;
  for (const h of hops) groups.set(groupKey(h), (groups.get(groupKey(h)) ?? 0) + 1);
  const seen = new Map<string, number>();
  let phase0End = 0;
  const phase1: { hop: Hop; index: number; count: number }[] = [];

  for (const h of hops) {
    const k = groupKey(h);
    const index = seen.get(k) ?? 0;
    seen.set(k, index + 1);
    const count = groups.get(k)!;
    if (h.phase === 1) {
      phase1.push({ hop: h, index, count });
      continue;
    }
    if (h.from.kind === "none") {
      // A new token: it pops into place.
      if (h.to.kind === "battlefield") spawns[h.id] = now + stagger(index, count);
      continue;
    }
    const f = makeFlight(ctx, h, now + stagger(index, count), lastHop.get(h.id) === h);
    if (!f) continue;
    flights.push(f);
    phase0End = Math.max(phase0End, f.start + f.duration - now);
  }

  const shuffleAt = phase0End + (phase1.length ? 60 : 0);
  let shuffleEnd = 0;
  for (const pid of changes.shuffled) {
    const riffle = shuffleFlights(ctx, pid, now + shuffleAt);
    flights.push(...riffle);
    for (const f of riffle) shuffleEnd = Math.max(shuffleEnd, f.start + f.duration - now);
  }
  const phase1At = Math.max(phase0End, shuffleEnd) + 80;
  for (const { hop, index, count } of phase1) {
    const f = makeFlight(ctx, hop, now + phase1At + index * Math.min(110, 900 / count), lastHop.get(hop.id) === hop);
    if (!f) continue;
    f.hideBeforeStart = true;
    flights.push(f);
  }

  if (slow !== 1) {
    for (const f of flights) {
      f.start = now + (f.start - now) * slow;
      f.duration *= slow;
    }
    for (const id of Object.keys(spawns)) spawns[id] = now + (spawns[id] - now) * slow;
  }
  for (const f of flights) if (f.release) arriving[f.id] = true;
  const st = useMotion.getState();
  useMotion.setState({
    flights: [...st.flights, ...flights],
    arriving: { ...st.arriving, ...arriving },
    spawns: { ...st.spawns, ...spawns },
  });
  for (const f of flights) {
    timers.set(
      f.key,
      setTimeout(() => finish(f.key), Math.max(0, f.start - performance.now()) + f.duration),
    );
  }
  for (const [id, at] of Object.entries(spawns)) setTimeout(() => clearSpawn(id), Math.max(0, at - now) + 1500 * slow);

  // A few soft card sounds, not one per card of a big mill.
  const dealt = flights.filter((f) => !f.swing).slice(0, 4);
  dealt.forEach((f) => setTimeout(() => sfx.deal(), Math.max(0, f.start - now)));
  if (changes.shuffled.length) setTimeout(() => sfx.deal(), shuffleAt * slow);
}

function stagger(index: number, count: number) {
  return index * Math.min(80, 700 / Math.max(1, count));
}

function spotKey(s: Spot) {
  return s.kind === "pile" ? `pile:${s.owner}:${s.zone}` : s.kind === "hand" ? `hand:${s.owner}` : s.kind;
}

function finish(key: number) {
  timers.delete(key);
  const st = useMotion.getState();
  const f = st.flights.find((x) => x.key === key);
  if (!f) return;
  const flights = st.flights.filter((x) => x.key !== key);
  let arriving = st.arriving;
  if (f.release && !flights.some((x) => x.id === f.id && x.release)) {
    const { [f.id]: _, ...rest } = st.arriving;
    arriving = rest;
  }
  useMotion.setState({ flights, arriving });
}

function cancel(match: (f: Flight) => boolean) {
  const st = useMotion.getState();
  const gone = st.flights.filter(match);
  if (gone.length === 0) return;
  const arriving = { ...st.arriving };
  for (const f of gone) {
    clearTimeout(timers.get(f.key));
    timers.delete(f.key);
    delete arriving[f.id];
  }
  useMotion.setState({ flights: st.flights.filter((f) => !match(f)), arriving });
}

function clearSpawn(id: string) {
  const { [id]: _, ...rest } = useMotion.getState().spawns;
  useMotion.setState({ spawns: rest });
}

// --- anchors --------------------------------------------------------------------------------

interface Ctx {
  prev: TableState;
  next: TableState;
  me: string;
}

const HAND_LIFT = 0.3;

function seatOf(t: TableState, pid: string) {
  return Math.max(0, t.players[pid]?.seat ?? t.seats.indexOf(pid));
}

function pileAnchor(t: TableState, owner: string, zone: Exclude<TableCard["zone"], "battlefield" | "hand">): Anchor {
  const seat = seatOf(t, owner);
  const n = t.seats.length;
  const p = pilePosition(zone, seat, n);
  const count = t.players[owner]?.zones[zone].length ?? 0;
  return { kind: "table", x: p.x, y: p.y, h: Math.min(count, 60) * 0.018 + 0.01, yaw: -seatAngle(seat, n) };
}

function opponentHandAnchor(t: TableState, owner: string): Anchor {
  const seat = seatOf(t, owner);
  const n = t.seats.length;
  const p = localToTable({ x: 0, y: MAT_D / 2 + 2.4 }, seat, n);
  return { kind: "table", x: p.x, y: p.y, h: HAND_LIFT, yaw: -seatAngle(seat, n), scale: 0.7 };
}

function battlefieldYaw(t: TableState, card: TableCard) {
  return -seatAngle(seatOf(t, card.controller), t.seats.length) - (card.tapped ? Math.PI / 2 : 0);
}

/** A hand card's current place on screen (it's still in the DOM when the update arrives). */
export function handCardAnchor(id: string): Anchor | null {
  const el = document.querySelector<HTMLElement>(`.hand-card[data-hid="${CSS.escape(id)}"]`);
  const card = el?.querySelector<HTMLElement>(".card");
  if (!el || !card) return null;
  const r = card.getBoundingClientRect();
  if (r.width === 0) return null;
  const roll = (parseFloat(el.style.getPropertyValue("--rot")) || 0) * (Math.PI / 180);
  return { kind: "screen", cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: card.offsetWidth || r.width, roll };
}

function fromAnchor(ctx: Ctx, h: Hop): Anchor | null {
  const { prev, me } = ctx;
  const card = h.prev;
  switch (h.from.kind) {
    case "battlefield": {
      const live = livePoses.get(h.id)?.();
      if (live) return { kind: "table", ...live };
      return card ? { kind: "table", x: card.x, y: card.y, h: 0.05, yaw: battlefieldYaw(prev, card) } : null;
    }
    case "pile":
      return pileAnchor(prev, h.from.owner, h.from.zone);
    case "hand": {
      if (h.from.owner !== me) {
        // They pulled it out over the table (we saw its back under their pointer): start there.
        const remote = useStore.getState().drags[h.id];
        if (remote && performance.now() - remote.at < 1000) return { kind: "table", x: remote.x, y: remote.y, h: DRAG_LIFT, yaw: -seatAngle(seatOf(prev, h.from.owner), prev.seats.length) };
        return opponentHandAnchor(prev, h.from.owner);
      }
      const hint = dropHints.get(h.id);
      dropHints.delete(h.id);
      if (hint && performance.now() - hint.at < 3000) return { kind: "table", x: hint.x, y: hint.y, h: hint.h, yaw: hint.yaw };
      return handCardAnchor(h.id) ?? { kind: "screen", cx: window.innerWidth / 2, cy: window.innerHeight - 80, w: 150, roll: 0 };
    }
    case "none":
      return null;
  }
}

function toAnchor(ctx: Ctx, h: Hop, from: Anchor): Anchor | null {
  const { next, me } = ctx;
  const card = h.next;
  switch (h.to.kind) {
    case "battlefield":
      return card ? { kind: "table", x: card.x, y: card.y, h: 0.05, yaw: battlefieldYaw(next, card) } : null;
    case "pile":
      return pileAnchor(next, h.to.owner, h.to.zone);
    case "hand":
      if (h.to.owner !== me) return opponentHandAnchor(next, h.to.owner);
      return { kind: "screen", id: h.id, cx: window.innerWidth / 2, cy: window.innerHeight - 80, w: 150, roll: 0 };
    case "none":
      // A token leaving the battlefield fades out where it was.
      return from;
  }
}

function faceUpAt(spot: Spot, card: TableCard | undefined, me: string): boolean {
  if (!card || card.hidden) return false;
  switch (spot.kind) {
    case "battlefield":
      return !card.faceDown;
    case "pile":
      return spot.zone === "graveyard" || spot.zone === "exile";
    case "hand":
      return spot.owner === me;
    case "none":
      return true;
  }
}

function makeFlight(ctx: Ctx, h: Hop, start: number, release: boolean): Flight | null {
  const from = fromAnchor(ctx, h);
  if (!from) return null;
  const to = toAnchor(ctx, h, from);
  if (!to) return null;
  const known = h.next?.cardId || h.next?.token ? h.next : h.prev;
  const screen = from.kind === "screen" || to.kind === "screen";
  const dist = from.kind === "table" && to.kind === "table" ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
  // Let go over the table: a short drop onto the spot (it was already hovering there).
  const drop = from.kind === "table" && from.h > 1 && dist < CARD_W * 1.5;
  const vanish = h.to.kind === "none";
  return {
    key: flightSeq++,
    id: h.id,
    from,
    to,
    start,
    duration: vanish ? 320 : drop ? 230 : screen ? 520 : Math.min(680, 360 + dist * 9),
    cardId: known?.cardId,
    token: known?.token,
    face: h.next?.face ?? h.prev?.face ?? 0,
    foil: known?.foil,
    faceFrom: faceUpAt(h.from, h.prev ?? h.next, ctx.me) && !!(h.prev?.cardId || h.prev?.token),
    faceTo: faceUpAt(h.to, h.next ?? h.prev, ctx.me),
    arc: vanish ? 0.8 : drop ? 0 : screen ? 1.2 : Math.min(4, 1.2 + dist * 0.12),
    vanish,
    release: release && !vanish,
  };
}

/** A quick riffle on top of the library: a few cards split to both sides and fold back in. */
function shuffleFlights(ctx: Ctx, pid: string, start: number): Flight[] {
  const t = ctx.next;
  if ((t.players[pid]?.zones.library.length ?? 0) < 2) return [];
  const pile = pileAnchor(t, pid, "library");
  if (pile.kind !== "table") return [];
  const out: Flight[] = [];
  const side = { x: Math.cos(pile.yaw), y: -Math.sin(pile.yaw) };
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 ? 1 : -1;
    const reach = CARD_W * (0.7 + (i % 3) * 0.12);
    out.push({
      key: flightSeq++,
      id: `shuffle:${pid}:${i}`,
      from: pile,
      to: pile,
      start: start + i * 45,
      duration: 380,
      face: 0,
      faceFrom: false,
      faceTo: false,
      arc: 0.35 + i * 0.05,
      swing: { x: side.x * reach * dir, y: side.y * reach * dir },
      release: false,
    });
  }
  return out;
}
