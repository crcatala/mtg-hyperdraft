// Tabletop geometry shared by server (default placements) and client (rendering, drop targets).
// Table coordinates are 2D (x, y) in world units where a card is 2.5 × 3.5 (i.e. inches).
// Seat 0 sits at +y ("bottom" of the table). Local seat coordinates: +y points toward the player.

import type { ZoneName } from "./types";

export const CARD_W = 2.5;
export const CARD_H = 3.5;
export const MAT_W = 26;
export const MAT_D = 13;

export type PileZone = Exclude<ZoneName, "battlefield" | "hand">;

/**
 * Pile zone centres in local mat coordinates (relative to the mat centre). Library, graveyard and exile sit together
 * left of the battlefield, as players typically keep them (the tournament rules allow either side, so long as the three
 * stay together); the sideboard is kept apart on the other side so it can't be mixed up with them.
 */
export const PILE_LOCAL: Record<PileZone, { x: number; y: number }> = {
  library: { x: -11.1, y: 4.2 },
  graveyard: { x: -11.1, y: 0 },
  exile: { x: -11.1, y: -4.2 },
  sideboard: { x: 11.1, y: 4.2 },
};

/** Battlefield area inside the mat (local coordinates). */
export const BATTLEFIELD_LOCAL = { minX: -9.4, maxX: 9.4, minY: -6.2, maxY: 6.2 };

export function seatRadius(seatCount: number): number {
  if (seatCount <= 1) return 8;
  if (seatCount === 2) return 9;
  if (seatCount === 3) return 15;
  return 20;
}

export function seatAngle(seat: number, seatCount: number): number {
  return (seat / Math.max(1, seatCount)) * Math.PI * 2;
}

export interface Vec2 {
  x: number;
  y: number;
}

function rotate(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Local mat coordinates → table coordinates. */
export function localToTable(p: Vec2, seat: number, seatCount: number): Vec2 {
  return rotate({ x: p.x, y: p.y + seatRadius(seatCount) }, seatAngle(seat, seatCount));
}

/** Where a player's companion stands: by the back-right corner of their mat, clear of the piles (seat-local coordinates). */
export const COMPANION_LOCAL: Vec2 = { x: MAT_W / 2 + 1.3, y: -MAT_D / 2 + 2.4 };
export const companionSpot = (seat: number, seatCount: number): Vec2 => localToTable(COMPANION_LOCAL, seat, seatCount);

/**
 * How far a companion's feet keep from the edges of anyone else's mat: about half its footprint (its shadow is ~2.2 wide
 * and ~0.95 deep), sideways along the mat's ends and front/back along its long edges. Sideways stays under the
 * 1.3 its home spot keeps from its own mat, so home is always valid. The rim keeps the wider of the two.
 */
export const PET_MARGIN = 1;
export const PET_MARGIN_DEPTH = 0.5;

/**
 * Whether the companion of the player at `ownSeat` may be put down at table point `p`: on the table, and off
 * everyone else's mat. Its own player's mat is fair game, cards and piles included (they can always move it
 * off again to get at them). The client checks it before dropping, and the room again before storing the spot.
 */
export function petSpotValid(p: Vec2, seatCount: number, ownSeat: number): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  // Its own mat first: the mat's corners reach past the table's rim at 1-2 seats, and they count as the mat.
  if (ownSeat >= 0 && ownSeat < seatCount) {
    const own = tableToLocal(p, ownSeat, seatCount);
    if (Math.abs(own.x) <= MAT_W / 2 && Math.abs(own.y) <= MAT_D / 2) return true;
  }
  if (Math.hypot(p.x, p.y) > tableRadius(seatCount) - PET_MARGIN) return false;
  for (let seat = 0; seat < Math.max(1, seatCount); seat++) {
    if (seat === ownSeat) continue;
    const local = tableToLocal(p, seat, seatCount);
    if (Math.abs(local.x) < MAT_W / 2 + PET_MARGIN && Math.abs(local.y) < MAT_D / 2 + PET_MARGIN_DEPTH) return false;
  }
  return true;
}

/** Table coordinates → local mat coordinates of a seat. */
export function tableToLocal(p: Vec2, seat: number, seatCount: number): Vec2 {
  const r = rotate(p, -seatAngle(seat, seatCount));
  return { x: r.x, y: r.y - seatRadius(seatCount) };
}

export function pilePosition(zone: PileZone, seat: number, seatCount: number): Vec2 {
  return localToTable(PILE_LOCAL[zone], seat, seatCount);
}

export function matCenter(seat: number, seatCount: number): Vec2 {
  return localToTable({ x: 0, y: 0 }, seat, seatCount);
}

/** Which pile (if any) of which seat a table point is over. */
export function pileAt(p: Vec2, seatCount: number): { seat: number; zone: PileZone } | null {
  for (let seat = 0; seat < seatCount; seat++) {
    const local = tableToLocal(p, seat, seatCount);
    for (const zone of Object.keys(PILE_LOCAL) as PileZone[]) {
      const c = PILE_LOCAL[zone];
      if (Math.abs(local.x - c.x) <= CARD_W * 0.7 && Math.abs(local.y - c.y) <= CARD_H * 0.6) return { seat, zone };
    }
  }
  return null;
}

/** Default spot for the n-th card a player puts onto the battlefield without dragging. */
export function defaultBattlefieldSpot(seat: number, seatCount: number, n: number, isLand: boolean): Vec2 {
  const col = n % 7;
  const row = Math.floor(n / 7) % 2;
  const local = { x: -7.5 + col * 2.6, y: isLand ? 4 - row * 0.6 : -0.5 - row * 0.6 };
  return localToTable(local, seat, seatCount);
}

export function tableRadius(seatCount: number): number {
  return seatRadius(seatCount) + MAT_D / 2 + 3;
}

/** Seats in the order the camera switcher lists them: yours first, then around the table. */
export function seatsFromMe(seats: string[], me: string): string[] {
  const at = seats.indexOf(me);
  return at < 0 ? seats.slice() : [...seats.slice(at), ...seats.slice(0, at)];
}
