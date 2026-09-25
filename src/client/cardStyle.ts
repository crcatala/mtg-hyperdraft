// Shared look of text-rendered cards (DOM and 3D canvas textures) and image URL helpers.

import type { CardData, CardFaceData, Color } from "../shared/types";

export interface FrameColors {
  frame: string;
  inner: string;
  text: string;
  accent: string;
}

const MONO: Record<Color, FrameColors> = {
  W: { frame: "#e9e2c9", inner: "#f8f4e6", text: "#1f1a10", accent: "#c9b98a" },
  U: { frame: "#1f6fb2", inner: "#d5e6f3", text: "#0d1a26", accent: "#6aa7d8" },
  B: { frame: "#2c2629", inner: "#cfc7c6", text: "#140f10", accent: "#7a6d70" },
  R: { frame: "#c9422c", inner: "#f4d6c8", text: "#26100b", accent: "#e98a6c" },
  G: { frame: "#2f7a44", inner: "#d4e7d2", text: "#0e1f12", accent: "#7ab98a" },
};
const GOLD: FrameColors = { frame: "#c9a13d", inner: "#f3e5b8", text: "#231a06", accent: "#e8c96a" };
const ARTIFACT: FrameColors = { frame: "#8a96a3", inner: "#e2e6ea", text: "#15191d", accent: "#b7c1cb" };
const LAND: FrameColors = { frame: "#8a6a4a", inner: "#eadfce", text: "#21170c", accent: "#b89773" };

export function frameColors(card: Pick<CardData, "colors" | "typeLine">): FrameColors {
  if (card.colors.length > 1) return GOLD;
  if (card.colors.length === 1) return MONO[card.colors[0]];
  if (/\bLand\b/.test(card.typeLine)) return LAND;
  return ARTIFACT;
}

/**
 * Face data to show. Double-faced cards (transform, MDFC) have per-face images; split/adventure
 * cards share one image, so face 0 falls back to the whole card.
 */
export function faceOf(card: CardData, face = 0): CardFaceData {
  const f = card.faces?.[face];
  if (f && f.images) return f;
  if (f && face > 0) return f;
  return {
    name: card.name,
    manaCost: card.manaCost,
    typeLine: card.typeLine,
    oracleText: card.oracleText,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    colors: card.colors,
    images: card.images,
  };
}

export type ImageSize = "small" | "normal" | "large";

export function imageUrl(card: CardData | undefined, face = 0, size: ImageSize = "normal"): string | undefined {
  if (!card) return undefined;
  const imgs = faceOf(card, face).images;
  return imgs?.[size] ?? imgs?.normal ?? imgs?.large ?? imgs?.small;
}

export function hasBackFace(card: CardData | undefined): boolean {
  return !!card?.faces && card.faces.length > 1 && !!card.faces[1].images;
}
