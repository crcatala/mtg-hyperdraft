// Emotes: a player right-clicks their own companion, picks one of six from the wheel (EmoteWheel.tsx), and the
// companion says it to the whole table: its voice for that slot, its reaction, and the line in a large bubble.
// Shaped like a poke (companionPoke.ts): shown here at once, then relayed by the room to everyone else, never
// stored. Solo play simply has nobody to relay to. A line the player rewrote (emoteLines.ts) goes with the emote.

import { create } from "zustand";
import { emoteLine, emoteSound, isEmoteIndex } from "../../shared/companionKit";
import { cleanEmoteText } from "../../shared/emoteText";
import { companionSpot } from "../../shared/tableLayout";
import { petPositions } from "./companionCarry";
import { useStore } from "../store";
import { playReaction } from "./companionPlayback";
import { say, voice } from "./companionTalk";
import { tableApi } from "./drag";
import { closeEmoteLines, customLine, useEmoteLines } from "./emoteLines";
import { cooldownLeft, emoteBadge, wheelCenter } from "./emoteWheel";
import { me, table } from "./tableUi";

/** The open wheel: where it's centred (CSS px), and where the right-click that opened it was. */
export interface WheelState {
  at: { x: number; y: number };
  from: { x: number; y: number };
}

export const useEmoteWheel = create<{ wheel: WheelState | null; lastEmote: number }>(() => ({ wheel: null, lastEmote: -Infinity }));

/**
 * Opens this player's wheel for a right-click at (x, y). Not while dragging something (a card, or the companion
 * itself) or editing their lines, and only if they have a companion at the table.
 */
export function openEmoteWheel(x: number, y: number) {
  if (document.body.classList.contains("dragging") || useEmoteLines.getState().editing || !myCompanion()) return;
  useStore.getState().closeMenu();
  useEmoteWheel.setState({ wheel: { at: wheelCenter(x, y, window.innerWidth, window.innerHeight), from: { x, y } } });
}

export function closeEmoteWheel() {
  if (useEmoteWheel.getState().wheel) useEmoteWheel.setState({ wheel: null });
}

/** How long until this player may emote again (0 = now). */
export const emoteCooldown = (now = performance.now()): number => cooldownLeft(useEmoteWheel.getState().lastEmote, now);

/**
 * This player's companion does emote `index`, for everyone, saying their own line for it if they wrote one.
 * Returns false when it can't (cooling down, no companion).
 */
export function sendEmote(index: number): boolean {
  const now = performance.now();
  if (!isEmoteIndex(index) || cooldownLeft(useEmoteWheel.getState().lastEmote, now) > 0 || !myCompanion()) return false;
  useEmoteWheel.setState({ lastEmote: now });
  const text = customLine(index) ?? undefined;
  showEmote(me(), index, text);
  useStore.getState().send(text === undefined ? { t: "emote", slot: index } : { t: "emote", slot: index, text });
  return true;
}

/** Someone else's companion did an emote: show it on theirs, in their words if they sent some. */
export function receiveEmote(by: string, index: number, text?: string) {
  // The room has cleaned it already; cleaning again costs nothing and doesn't trust that.
  showEmote(by, index, (text !== undefined && cleanEmoteText(text)) || undefined);
}

/** Leaving the table: close the wheel (and the line editor) and forget the cooldown. The lines themselves stay. */
export function resetEmotes() {
  useEmoteWheel.setState({ wheel: null, lastEmote: -Infinity });
  closeEmoteLines();
}

/**
 * The emote as everyone sees it: the companion's voice for that slot, its reaction, and its line (or the
 * player's own, `text`) in a large bubble.
 */
function showEmote(playerId: string, index: number, text?: string) {
  const t = table();
  const seat = t?.seats.indexOf(playerId) ?? -1;
  const player = useStore.getState().view?.players.find((p) => p.id === playerId);
  const companion = player?.companion;
  if (!t || seat < 0 || !companion || !isEmoteIndex(index)) return;
  const slot = emoteSound(index);
  const at = petPositions.get(playerId) ?? companionSpot(seat, t.seats.length);
  playReaction(playerId, slot);
  voice(companion, slot, { variant: player.companionVariant ?? 0, pan: tableApi.screenPan(at.x, at.y) * 0.8 });
  say(playerId, text ?? emoteLine(companion, index), "large", emoteBadge(index));
}

/** This player's companion, if they're seated at the table with one. */
function myCompanion(): string | undefined {
  const view = useStore.getState().view;
  if (!view?.table?.seats.includes(view.you)) return undefined;
  return view.players.find((p) => p.id === view.you)?.companion;
}
