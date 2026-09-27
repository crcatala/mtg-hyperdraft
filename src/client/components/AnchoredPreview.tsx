// Floating card preview next to a hovered element. Rendered in a portal with fixed positioning and
// pointer-events off, so it never shifts layout or steals the hover (which caused flicker before).
// It measures itself before paint and sits on the preferred side of the anchor when that fits,
// flipping near the screen edge. An optional footer (e.g. a how-to hint) travels with it.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { placeBeside, type Side } from "../placement";
import { FacePair } from "./FacePair";

export function AnchoredPreview({
  card,
  foil,
  face = 0,
  anchor,
  width = 250,
  prefer = "left",
  footer,
}: {
  card: CardData;
  foil?: boolean;
  face?: number;
  anchor: DOMRect;
  width?: number;
  /** Side of the anchor to use when there's room (lists on the right edge prefer the left). */
  prefer?: Side;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: Side } | null>(null);
  const hasFooter = !!footer;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const next = placeBeside(anchor, { width: w, height: h }, { width: window.innerWidth, height: window.innerHeight }, { prefer });
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.side === next.side ? p : next));
  }, [anchor, card.id, face, width, prefer, hasFooter]);

  // The main face sits next to the anchor, a double-faced card's other face beyond it.
  const otherSide = pos?.side === "right" ? "right" : "left";
  return createPortal(
    <div
      ref={ref}
      className={`anchored-preview${pos ? ` side-${pos.side}` : ""}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: "hidden" }}
    >
      <FacePair card={card} face={face} foil={foil} width={width} otherSide={otherSide} />
      {footer && <div className="preview-footer">{footer}</div>}
    </div>,
    document.body,
  );
}
