// Invite codes and the per-invite room ledger (quotas, "My rooms", lazy expiry). Pure logic:
// the invite Durable Object owns persistence, tests drive this directly.

import type { Phase } from "./types";

export const INVITE_LIMITS = {
  /** Rooms an invite may create per rolling window. */
  perWindow: 10,
  windowMs: 24 * 60 * 60 * 1000,
  /** Rooms an invite may keep at once; delete one to make space. */
  maxRooms: 25,
  /** Rooms nobody has touched for this long are deleted the next time the invite's ledger is used. */
  idleExpiryMs: 90 * 24 * 60 * 60 * 1000,
};

const LABEL_RE = /^[a-z0-9_-]{1,32}$/i;
const MIN_KEY_LENGTH = 8;

/**
 * Parses the INVITE_CODES secret: `label:key` pairs separated by commas or newlines, e.g.
 * `sam:k3y-for-sam, jo:another-key`. The label names the invite (and its room ledger); the key is
 * what friends type in. Malformed entries are skipped.
 */
export function parseInviteCodes(raw: string | undefined): { label: string; key: string }[] {
  if (!raw) return [];
  const out: { label: string; key: string }[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const label = part.slice(0, i).trim().toLowerCase();
    const key = part.slice(i + 1).trim();
    if (LABEL_RE.test(label) && key.length >= MIN_KEY_LENGTH) out.push({ label, key });
  }
  return out;
}

/** Compares without bailing out early, so response timing doesn't leak how much of a key matched. */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The invite label for a key, or null. */
export function inviteLabelFor(invites: { label: string; key: string }[], key: string | null | undefined): string | null {
  if (!key) return null;
  let found: string | null = null;
  for (const inv of invites) if (sameString(inv.key, key)) found = inv.label;
  return found;
}

// --- ledger -----------------------------------------------------------------------------------

/** What a room reports about itself for the "My rooms" list. */
export interface RoomSummary {
  phase: Phase;
  /** Human player names in seat order. */
  players: string[];
  bots: number;
  cubeName: string | null;
  cardCount: number;
}

export interface RoomRecord extends RoomSummary {
  code: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface InviteLedger {
  label: string;
  rooms: RoomRecord[];
  /** Creation times inside the rolling window (older ones are pruned). */
  created: number[];
}

export interface QuotaInfo {
  createdInWindow: number;
  perWindow: number;
  rooms: number;
  maxRooms: number;
  /** When the next rolling-window slot frees up, if the window is full. */
  nextSlotAt: number | null;
}

/** What GET /api/invite returns. */
export interface InviteInfo {
  label: string;
  rooms: RoomRecord[];
  quota: QuotaInfo;
}

export function emptyLedger(label: string): InviteLedger {
  return { label, rooms: [], created: [] };
}

export function pruneWindow(ledger: InviteLedger, now: number): void {
  ledger.created = ledger.created.filter((t) => t > now - INVITE_LIMITS.windowMs);
}

export function quotaInfo(ledger: InviteLedger, now: number): QuotaInfo {
  const inWindow = ledger.created.filter((t) => t > now - INVITE_LIMITS.windowMs).sort((a, b) => a - b);
  const full = inWindow.length >= INVITE_LIMITS.perWindow;
  return {
    createdInWindow: inWindow.length,
    perWindow: INVITE_LIMITS.perWindow,
    rooms: ledger.rooms.length,
    maxRooms: INVITE_LIMITS.maxRooms,
    nextSlotAt: full ? inWindow[inWindow.length - INVITE_LIMITS.perWindow] + INVITE_LIMITS.windowMs : null,
  };
}

/** Null when another room may be created now, else a message for the player. */
export function createBlocker(ledger: InviteLedger, now: number): string | null {
  const q = quotaInfo(ledger, now);
  if (q.rooms >= q.maxRooms) return `This invite already has ${q.maxRooms} rooms. Delete one from "Your rooms" to make space.`;
  if (q.nextSlotAt !== null) {
    const hours = Math.max(1, Math.ceil((q.nextSlotAt - now) / 3_600_000));
    return `This invite created ${q.perWindow} rooms in the last 24 hours. Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
  }
  return null;
}

/** Rooms idle past the expiry window. */
export function expiredRooms(ledger: InviteLedger, now: number): RoomRecord[] {
  return ledger.rooms.filter((r) => r.lastActiveAt < now - INVITE_LIMITS.idleExpiryMs);
}
