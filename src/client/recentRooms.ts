// Rooms this browser has been in, so Home can offer a way back after a closed tab or a dropped
// connection. Kept in localStorage (per `?as=` alias) next to the seat secrets that make rejoining
// work (identity.ts): a list kept anywhere else couldn't get you back into your seat anyway. Home
// merges it with an invite's server-side "My rooms" ledger into one "Your rooms" list.
//
// Nothing here asks the server: entries are a snapshot from the last time this browser saw the
// room. Rooms that turn out to be gone are dropped when a join says so (see net.ts).

import type { RoomRecord } from "../shared/invites";
import type { RoomView } from "../shared/protocol";
import type { Phase } from "../shared/types";
import { aliasedKey } from "./identity";

export const RECENT_LIMITS = {
  /** Rooms remembered at once; the least recently seen fall off. */
  maxRooms: 8,
  /** Rooms not seen for this long are forgotten. */
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
};

/** What the list shows about a room, as this browser last saw it. */
export interface RoomSnapshot {
  phase: Phase;
  /** Human player names in seat order. */
  players: string[];
  bots: number;
  cubeName: string | null;
  cardCount: number;
  /** Public rooms: when the room closes for good. */
  expiresAt: number | null;
}

export interface RecentRoom extends RoomSnapshot {
  code: string;
  /** Created from this browser (with an invite, or from the public pool) rather than joined. */
  hosted: boolean;
  /** When this browser last joined the room or saw it change. */
  seenAt: number;
}

/** One row of "Your rooms": an invite ledger room, a remembered room, or both. */
export interface RoomEntry extends RoomSnapshot {
  code: string;
  role: "hosted" | "joined";
  /** On the invite's ledger: the invite holder can delete it for everyone. */
  onInvite: boolean;
  /** Ledger rooms: last activity by anyone. Others: when this browser last saw the room. */
  activeAt: number;
  /** Ledger rooms only. */
  createdAt: number | null;
}

const EMPTY: RoomSnapshot = { phase: "lobby", players: [], bots: 0, cubeName: null, cardCount: 0, expiresAt: null };

export function snapshotOf(view: RoomView): RoomSnapshot {
  const humans = view.players.filter((p) => !p.isBot);
  return {
    phase: view.phase,
    players: humans.map((p) => p.name),
    bots: view.players.length - humans.length,
    cubeName: view.cube?.name ?? null,
    cardCount: view.cube?.size ?? 0,
    expiresAt: view.expiresAt,
  };
}

/** Drops closed public rooms and rooms not seen for a long time; newest first, capped. */
export function pruneRecent(list: RecentRoom[], now: number): RecentRoom[] {
  return list
    .filter((r) => (r.expiresAt === null || r.expiresAt > now) && now - r.seenAt < RECENT_LIMITS.maxAgeMs)
    .sort((a, b) => b.seenAt - a.seenAt)
    .slice(0, RECENT_LIMITS.maxRooms);
}

/** Adds a room or refreshes what's known about it, as just seen. A hosted room stays hosted. */
export function upsertRecent(list: RecentRoom[], code: string, update: Partial<RoomSnapshot> & { hosted?: boolean }, now: number): RecentRoom[] {
  const old = list.find((r) => r.code === code);
  const room: RecentRoom = { ...EMPTY, ...old, ...update, code, hosted: !!(old?.hosted || update.hosted), seenAt: now };
  return pruneRecent([room, ...list.filter((r) => r.code !== code)], now);
}

/**
 * One list from the invite's ledger and this browser's rooms, most recently active first. Ledger
 * rooms are hosted (the invite created them) and their details are the server's, so fresher.
 */
export function mergeRooms(ledger: RoomRecord[], recent: RecentRoom[]): RoomEntry[] {
  const local = new Map(recent.map((r) => [r.code, r]));
  const entries: RoomEntry[] = ledger.map((r) => ({
    code: r.code,
    role: "hosted",
    onInvite: true,
    phase: r.phase,
    players: r.players,
    bots: r.bots,
    cubeName: r.cubeName,
    cardCount: r.cardCount,
    expiresAt: null,
    activeAt: Math.max(r.lastActiveAt, local.get(r.code)?.seenAt ?? 0),
    createdAt: r.createdAt,
  }));
  const onLedger = new Set(ledger.map((r) => r.code));
  for (const r of recent) {
    if (onLedger.has(r.code)) continue;
    const { code, hosted, seenAt, ...snapshot } = r;
    entries.push({ ...snapshot, code, role: hosted ? "hosted" : "joined", onInvite: false, activeAt: seenAt, createdAt: null });
  }
  return entries.sort((a, b) => b.activeAt - a.activeAt);
}

// --- storage ------------------------------------------------------------------------------------

const KEY = "hyperdraft:recent";

function isRecentRoom(r: unknown): r is RecentRoom {
  const o = r as RecentRoom | null;
  return typeof o?.code === "string" && typeof o.seenAt === "number" && typeof o.phase === "string" && Array.isArray(o.players);
}

export function loadRecent(now = Date.now()): RecentRoom[] {
  try {
    const raw = JSON.parse(localStorage.getItem(aliasedKey(KEY)) ?? "[]") as unknown;
    return Array.isArray(raw) ? pruneRecent(raw.filter(isRecentRoom), now) : [];
  } catch {
    return [];
  }
}

function save(list: RecentRoom[]) {
  try {
    localStorage.setItem(aliasedKey(KEY), JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode): no list */
  }
}

/** Remembers a room as just seen: on each join, when it changes, or when this browser creates it. */
export function rememberRoom(code: string, update: Partial<RoomSnapshot> & { hosted?: boolean } = {}) {
  const now = Date.now();
  save(upsertRecent(loadRecent(now), code, update, now));
}

/** Takes a room off the list (it's gone, or the player asked). Its seat secret is kept. */
export function forgetRoom(code: string) {
  const list = loadRecent();
  if (list.some((r) => r.code === code)) save(list.filter((r) => r.code !== code));
}
