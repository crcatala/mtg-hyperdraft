// The emote wheel's geometry and timing (the wheel itself is EmoteWheel.tsx): six wedges around an empty
// centre, in EMOTE_SLOTS order, clockwise from the top, the same for every companion so a player's hand learns
// where "taunt" is. Pure, so it can be tested.

import { EMOTE_COUNT, EMOTE_SLOTS, type EmoteId } from "../../shared/companionKit";

/** Outer and inner radius of the ring, in CSS pixels. The centre stays free (the pick-up ticket's Home button). */
export const WHEEL_R = 136;
export const WHEEL_HOLE = 48;
/** Gap between wedges, in degrees. */
const GAP_DEG = 2.5;
const SPAN = 360 / EMOTE_COUNT;

/** Each player can emote this often (the room has a slightly shorter guard of its own, EMOTE_COOLDOWN_MS). */
export const EMOTE_COOLDOWN_MS = 1500;

/** A right-click-drag that ends this far from where it started picks the wedge it ends on. */
export const DRAG_PICK_PX = 12;

/** Each emote's colour: its wedge on the wheel and its large bubble. */
export const EMOTE_TINTS: Record<EmoteId, string> = {
  cheer: "#ffcf4a",
  love: "#ff8fb4",
  oops: "#7fcfff",
  silly: "#a6e46a",
  sass: "#c39cff",
  taunt: "#ff9a52",
};
export const emoteTint = (index: number): string => EMOTE_TINTS[EMOTE_SLOTS[index]?.id] ?? "#ffffff";
/** What marks an emote's large bubble: its icon, in a disc, on its colour. */
export const emoteBadge = (index: number) => ({ icon: EMOTE_SLOTS[index].icon, color: emoteTint(index) });

/** The direction a wedge points, in degrees clockwise from straight up. */
export const wedgeAngle = (index: number): number => index * SPAN;

/** Screen offset (y down) of a point `r` px from the centre in direction `deg` (clockwise from up). */
function polar(deg: number, r: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/** Where a wedge's icon and label sit, relative to the centre. */
export const wedgeCenter = (index: number) => polar(wedgeAngle(index), (WHEEL_R + WHEEL_HOLE) / 2);

/** A wedge's outline as SVG path data, in a box 2·WHEEL_R square with the centre at (WHEEL_R, WHEEL_R). */
export function wedgePath(index: number): string {
  const f = (n: number) => +n.toFixed(2);
  const from = wedgeAngle(index) - SPAN / 2 + GAP_DEG / 2;
  const to = wedgeAngle(index) + SPAN / 2 - GAP_DEG / 2;
  const pt = (deg: number, r: number) => {
    const p = polar(deg, r);
    return `${f(WHEEL_R + p.x)} ${f(WHEEL_R + p.y)}`;
  };
  return [
    `M${pt(from, WHEEL_HOLE)}`,
    `L${pt(from, WHEEL_R)}`,
    `A${WHEEL_R} ${WHEEL_R} 0 0 1 ${pt(to, WHEEL_R)}`,
    `L${pt(to, WHEEL_HOLE)}`,
    `A${WHEEL_HOLE} ${WHEEL_HOLE} 0 0 0 ${pt(from, WHEEL_HOLE)}`,
    "Z",
  ].join("");
}

/** The wedge under a point `dx`, `dy` px from the centre (y down), or null in the hole or past the rim. */
export function wedgeAt(dx: number, dy: number): number | null {
  const r = Math.hypot(dx, dy);
  if (r < WHEEL_HOLE || r > WHEEL_R) return null;
  const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360 + SPAN / 2) % 360;
  return Math.floor(deg / SPAN) % EMOTE_COUNT;
}

/** The wheel's centre for a click at (x, y): there, unless that would push the ring off screen. */
export function wheelCenter(x: number, y: number, viewW: number, viewH: number, margin = 8): { x: number; y: number } {
  const edge = WHEEL_R + margin;
  const clamp = (v: number, max: number) => (max < edge * 2 ? max / 2 : Math.min(Math.max(v, edge), max - edge));
  return { x: clamp(x, viewW), y: clamp(y, viewH) };
}

/** Room the "Edit lines" pill and the hovered line need next to the ring, in px. */
export const UNDER_WHEEL_PX = 104;

/**
 * Whether the pill and the line go over the ring instead of under it (for a ring centred at `centerY` in a
 * window `viewH` tall): only when there's too little room below and more above, so in a short window they
 * stay on whichever side shows the most of them.
 */
export function wheelExtrasAbove(centerY: number, viewH: number): boolean {
  const below = viewH - (centerY + WHEEL_R);
  const above = centerY - WHEEL_R;
  return below < UNDER_WHEEL_PX && above > below;
}

/** The wedge an arrow key moves to: clockwise (+1) or anticlockwise (-1), starting at the top from nothing. */
export function stepWedge(current: number | null, dir: 1 | -1): number {
  if (current === null) return dir === 1 ? 0 : EMOTE_COUNT - 1;
  return (current + dir + EMOTE_COUNT) % EMOTE_COUNT;
}

/** How long until this player may emote again (0 = now), given when their last emote went out. */
export const cooldownLeft = (lastAt: number, now: number): number => Math.max(0, lastAt + EMOTE_COOLDOWN_MS - now);
