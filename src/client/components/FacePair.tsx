// A card preview that also shows the other face of double-faced cards, so hover previews never hide
// the back side. Single-faced cards render as a plain CardView.

import type { CardData } from "../../shared/types";
import { hasBackFace, nextFace, type ImageSize } from "../cardStyle";
import { CardView } from "./CardView";

/** Width of the secondary face relative to the main one. */
export const OTHER_FACE_SCALE = 0.72;
const GAP = 10;

/** Total on-screen width of a FacePair for `card` at `width`. */
export function facePairWidth(card: CardData | undefined, width: number): number {
  return hasBackFace(card) ? width + GAP + Math.round(width * OTHER_FACE_SCALE) : width;
}

export function FacePair({
  card,
  face = 0,
  foil,
  width,
  imageSize,
  otherSide = "right",
}: {
  card: CardData;
  face?: number;
  foil?: boolean;
  width: number;
  imageSize?: ImageSize;
  /** Which side of the main face the other face sits on. */
  otherSide?: "left" | "right";
}) {
  const main = <CardView card={card} face={face} foil={foil} width={width} imageSize={imageSize} />;
  if (!hasBackFace(card)) return main;
  const other = nextFace(card, face);
  return (
    <div className={`face-pair${otherSide === "left" ? " other-left" : ""}`} style={{ gap: GAP }}>
      {main}
      <div className="face-pair-other">
        <span className="face-pair-label">⟲ {other === 0 ? "Front face" : "Back face"}</span>
        <CardView card={card} face={other} foil={foil} width={Math.round(width * OTHER_FACE_SCALE)} />
      </div>
    </div>
  );
}
