// A player's own emote lines: any of the wheel's six can be rewritten (EmoteLinesDialog.tsx), text only; the
// slot's tone, icon, colour, sound and reaction stay. Kept in this tab's memory and nowhere else: no persist
// middleware, no browser storage, nothing in the room, so closing or reloading the tab brings the defaults back.
// Each line travels with its emote (companionEmote.ts), since nobody else's tab knows it.

import { create } from "zustand";
import { EMOTE_COUNT, emoteLine } from "../../shared/companionKit";
import { cleanEmoteText } from "../../shared/emoteText";

/** One entry per wheel slot, in EMOTE_SLOTS order: the player's own (clean) line, or null for the kit's. */
export type CustomLines = readonly (string | null)[];

const NONE: CustomLines = Array(EMOTE_COUNT).fill(null);

export const useEmoteLines = create<{ custom: CustomLines; editing: boolean }>(() => ({ custom: NONE, editing: false }));

/**
 * Replaces this player's lines: one per slot, null (or text that doesn't clean up) for the kit's. A line equal to
 * `companion`'s own stays null, so it isn't sent with every emote for nothing.
 */
export function setCustomLines(lines: readonly (string | null)[], companion?: string) {
  const custom = NONE.map((_, i) => {
    const text = lines[i] == null ? null : cleanEmoteText(lines[i]!);
    return text === emoteLine(companion, i) ? null : text;
  });
  useEmoteLines.setState({ custom });
}

/** Back to the kit's six lines. */
export function resetCustomLines() {
  useEmoteLines.setState({ custom: NONE });
}

/** The player's own line for a slot, or null when it's the kit's. */
export const customLine = (index: number): string | null => useEmoteLines.getState().custom[index] ?? null;

/** What a slot says for this player: their own line, else the kit's line for their companion. */
export const effectiveLine = (custom: CustomLines, companion: string | undefined, index: number): string | undefined =>
  custom[index] ?? emoteLine(companion, index);

export const openEmoteLines = () => useEmoteLines.setState({ editing: true });
export const closeEmoteLines = () => useEmoteLines.getState().editing && useEmoteLines.setState({ editing: false });
