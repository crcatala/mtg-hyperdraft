// Floating card preview next to a hovered element. Rendered in a portal with fixed positioning and
// pointer-events off, so it never shifts layout or steals the hover (which caused flicker before).

import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { FacePair, facePairWidth } from "./FacePair";

export function AnchoredPreview({ card, foil, face = 0, anchor, width = 250 }: { card: CardData; foil?: boolean; face?: number; anchor: DOMRect; width?: number }) {
  const height = (width * 88) / 63;
  const total = facePairWidth(card, width);
  const gap = 14;
  // Prefer the left of the anchor (lists live on the right edge); fall back to the right.
  // The main face always sits next to the anchor, a double-faced card's other face beyond it.
  let left = anchor.left - total - gap;
  let otherSide: "left" | "right" = "left";
  if (left < 8) {
    left = Math.min(anchor.right + gap, window.innerWidth - total - 8);
    otherSide = "right";
  }
  const top = Math.max(8, Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 8));
  return createPortal(
    <div className="anchored-preview" style={{ left, top, width: total }}>
      <FacePair card={card} face={face} foil={foil} width={width} otherSide={otherSide} />
    </div>,
    document.body,
  );
}
