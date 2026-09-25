// Large hover preview of a card, docked to the right edge (or left when the pointer is on the right).

import { useEffect, useState } from "react";
import { useStore } from "../store";
import { CardView } from "./CardView";

export function PreviewPane({ width = 320, side = "auto" as "auto" | "left" | "right", top = 80 }) {
  const preview = useStore((s) => s.preview);
  const card = useStore((s) => (preview.cardId ? s.cards[preview.cardId] : undefined));
  const [pointerRight, setPointerRight] = useState(false);

  useEffect(() => {
    if (side !== "auto") return;
    const onMove = (e: PointerEvent) => setPointerRight(e.clientX > window.innerWidth * 0.6);
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [side]);

  if (!card) return null;
  const onLeft = side === "left" || (side === "auto" && pointerRight);
  return (
    <div className="preview-pane" style={{ top, [onLeft ? "left" : "right"]: 16 }} key={`${preview.cardId}:${preview.face}`}>
      <CardView card={card} face={preview.face} foil={preview.foil} width={width} imageSize="large" />
    </div>
  );
}
