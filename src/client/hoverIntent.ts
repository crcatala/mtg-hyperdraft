// Pointer geometry for hover popovers you can move into. A fixed close delay can't tell "on the way to
// the popover" from "left": too short and it vanishes under the mouse, too long and it lingers.
// Instead, when the pointer leaves the trigger we keep the popover open while the pointer stays inside
// a "bridge": the hull of the spot it left from and the popover (the classic safe triangle). Leaving
// the bridge means the pointer went somewhere else. Pausing inside it for long enough ends it too.
// Opening uses the reverse test: the pointer has to rest on the trigger, not just cross it.

export interface Point {
  x: number;
  y: number;
}

/** Structurally a DOMRect, so `getBoundingClientRect()` results can be passed straight in. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BridgeOptions {
  /** Extra room around the popover, so grazing its edge still counts. */
  pad?: number;
  /** Half-size of the square standing in for the point the pointer left from. Cursors and hands
   *  aren't exact, and the pointer usually leaves a few pixels past the trigger's edge. */
  originPad?: number;
}

const DEFAULT_PAD = 6;
const DEFAULT_ORIGIN_PAD = 6;

export function rectContains(r: Rect, p: Point): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

const corners = (r: Rect): Point[] => [
  { x: r.left, y: r.top },
  { x: r.right, y: r.top },
  { x: r.right, y: r.bottom },
  { x: r.left, y: r.bottom },
];

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Convex hull (Andrew's monotone chain), counter-clockwise, without collinear points. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const half = (input: Point[]) => {
    const out: Point[] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** Whether `p` is inside (or on the edge of) a convex polygon given counter-clockwise. */
export function convexContains(hull: Point[], p: Point): boolean {
  if (hull.length === 0) return false;
  if (hull.length === 1) return hull[0].x === p.x && hull[0].y === p.y;
  if (hull.length === 2) return cross(hull[0], hull[1], p) === 0 && p.x >= Math.min(hull[0].x, hull[1].x) && p.x <= Math.max(hull[0].x, hull[1].x) && p.y >= Math.min(hull[0].y, hull[1].y) && p.y <= Math.max(hull[0].y, hull[1].y);
  for (let i = 0; i < hull.length; i++) {
    if (cross(hull[i], hull[(i + 1) % hull.length], p) < 0) return false;
  }
  return true;
}

/** The area to cross without the popover closing: the popover plus the wedge back to `origin`. */
export function bridgeZone(origin: Point, target: Rect, { pad = DEFAULT_PAD, originPad = DEFAULT_ORIGIN_PAD }: BridgeOptions = {}): Point[] {
  const padded: Rect = { left: target.left - pad, top: target.top - pad, right: target.right + pad, bottom: target.bottom + pad };
  const start: Rect = { left: origin.x - originPad, top: origin.y - originPad, right: origin.x + originPad, bottom: origin.y + originPad };
  return convexHull([...corners(padded), ...corners(start)]);
}

/** True while `p` is on the way from `origin` to `target` (or already on it). */
export function inBridge(p: Point, origin: Point, target: Rect, opts?: BridgeOptions): boolean {
  return convexContains(bridgeZone(origin, target, opts), p);
}

/** True once the pointer has moved more than `tolerance` px from `anchor`: it isn't resting there. */
export function movedBeyond(anchor: Point, p: Point, tolerance: number): boolean {
  return Math.hypot(p.x - anchor.x, p.y - anchor.y) > tolerance;
}
