// Where to put a floating panel (card preview, hint) beside the element it describes.

export interface Size {
  width: number;
  height: number;
}

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  width: number;
  height: number;
}

export type Side = "left" | "right";

/**
 * Places a `box` beside `anchor`, on the `prefer`red side when it fits, else the other side, else
 * whichever side has more room. Vertically centred on the anchor. Always clamped to the viewport.
 */
export function placeBeside(anchor: AnchorRect, box: Size, viewport: Size, { prefer = "right" as Side, gap = 14, margin = 8 } = {}): { left: number; top: number; side: Side } {
  const room: Record<Side, number> = {
    right: viewport.width - margin - (anchor.right + gap),
    left: anchor.left - gap - margin,
  };
  const other: Side = prefer === "right" ? "left" : "right";
  const side: Side = room[prefer] >= box.width ? prefer : room[other] >= box.width ? other : room.right >= room.left ? "right" : "left";
  const left = side === "right" ? anchor.right + gap : anchor.left - gap - box.width;
  const top = anchor.top + anchor.height / 2 - box.height / 2;
  return {
    left: clamp(left, margin, viewport.width - margin - box.width),
    top: clamp(top, margin, viewport.height - margin - box.height),
    side,
  };
}

/** Like Math.min(max(v, lo), hi), but `lo` wins when the box is bigger than the viewport. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}
