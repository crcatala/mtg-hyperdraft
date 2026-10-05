// Client side of the cast (shared/roster.ts): where the art lives, colours, and the random "surprise me" pick.

import { AVATARS, COMPANIONS, MYSTERY_COLOR, avatarDef, companionDef, pickFree, variantColor, variantHue } from "../shared/roster";
import type { Player } from "../shared/types";

export { AVATARS, COMPANIONS, MYSTERY_COLOR, avatarDef, companionDef, variantHue };

/** What a player with no avatar shows: a hooded stranger. */
const MYSTERY = "mystery";

/** Head-and-shoulders portrait (768px); the hooded stranger when there's no id. */
export const avatarArt = (id?: string) => `/roster/avatars/${id ?? MYSTERY}.webp`;
/** Square crop of just the face, for seat chips and the HUD. */
export const avatarFace = (id?: string) => `/roster/avatars/${id ?? MYSTERY}-face.webp`;
/** Full-figure companion (512px). */
export const companionArt = (id: string) => `/roster/companions/${id}.webp`;
export const companionSmall = (id: string) => `/roster/companions/${id}-sm.webp`;

type Looks = Pick<Player, "avatar" | "avatarVariant">;

/** A player's accent colour: their avatar's colour (turned for a duplicate), or the stranger's grey. */
export function accentOf(p: Looks): string {
  const def = avatarDef(p.avatar);
  return def ? variantColor(def.color, p.avatarVariant ?? 0) : MYSTERY_COLOR;
}

/** Everyone holding each avatar / companion id right now (several players may share one). */
export function holders(players: Player[], field: "avatar" | "companion"): Map<string, Player[]> {
  const map = new Map<string, Player[]>();
  for (const p of players) {
    const id = p[field];
    if (id) map.set(id, [...(map.get(id) ?? []), p]);
  }
  return map;
}

/** A random avatar and companion, preferring ones nobody else holds. */
export function surprise(players: Player[], me: string): { avatar: string; companion: string } {
  const others = players.filter((p) => p.id !== me);
  return {
    avatar: pickFree(AVATARS.map((a) => a.id), new Set(others.map((p) => p.avatar ?? "")), Math.random),
    companion: pickFree(COMPANIONS.map((c) => c.id), new Set(others.map((p) => p.companion ?? "")), Math.random),
  };
}
