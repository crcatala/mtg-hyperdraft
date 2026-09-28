// Tabletop geometry shared by server (default placements) and client (rendering, drop targets).
// Table coordinates are 2D (x, y) in world units where a card is 2.5 × 3.5 (i.e. inches).
// Seat 0 sits at +y ("bottom" of the table). Local seat coordinates: +y points toward the player.

import type { ZoneName } from "./types";

export const CARD_W = 2.5;
export const CARD_H = 3.5;
export const MAT_W = 26;
export const MAT_D = 13;

export type PileZone = Exclude<ZoneName, "battlefield" | "hand">;

/** Pile zone centres in local mat coordinates (relative to the mat centre). */
export const PILE_LOCAL: Record<PileZone, { x: number; y: number }> = {
  library: { x: 11.1, y: 4.2 },
  graveyard: { x: 11.1, y: 0 },
  exile: { x: 11.1, y: -4.2 },
  sideboard: { x: -11.1, y: 4.2 },
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
