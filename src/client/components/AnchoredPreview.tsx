// Floating card preview next to a hovered element. Rendered in a portal with fixed positioning and
// pointer-events off, so it never shifts layout or steals the hover (which caused flicker before).

import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { CardView } from "./CardView";

export function AnchoredPreview({ card, foil, anchor, width = 250 }: { card: CardData; foil?: boolean; anchor: DOMRect; width?: number }) {
  const height = (width * 88) / 63;
  const gap = 14;
  // Prefer the left of the anchor (lists live on the right edge); fall back to the right.
  let left = anchor.left - width - gap;
  if (left < 8) left = Math.min(anchor.right + gap, window.innerWidth - width - 8);
  const top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 8));
  return createPortal(
    <div className="anchored-preview" style={{ left, top, width }}>
      <CardView card={card} foil={foil} width={width} />
    </div>,
    document.body,
  );
}
