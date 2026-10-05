// What a companion can say and do: the slots every companion shares (the poke ladder, pick-up, drop, the
// emote wheel) and, per companion, its voice signature and speech lines. Pure data, shared by the client,
// the room engine (slot validation) and the node scripts: the wording lives in companionKit.json, which
// scripts/build-companion-sfx.mjs reads too, so the sound prompts and the bubbles can't drift apart.
// Voice sounds are non-verbal babble and the bubbles are real English, so they never have to match.

import kit from "./companionKit.json";
import { COMPANION_IDS, companionDef } from "./roster";

/** The poke ladder: each tap walks one step up, the finale is followed by a sulk, then it starts over. */
export const POKE_STEP_IDS = ["curious", "happy", "affectionate", "playful", "bothered", "pestered", "finale"] as const;
export type PokeStepId = (typeof POKE_STEP_IDS)[number];
export const POKE_STEPS = POKE_STEP_IDS.length;

/** The wheel: same six tones, same order and positions for every companion; the text/sound/motion differ. */
export const EMOTE_SLOTS = [
  { id: "cheer", label: "Cheer", icon: "party" },
  { id: "love", label: "Love", icon: "heart" },
  { id: "oops", label: "Oops", icon: "sweat" },
  { id: "silly", label: "Silly", icon: "spiral" },
  { id: "sass", label: "Sass", icon: "smirk" },
  { id: "taunt", label: "Taunt", icon: "tongue" },
] as const;
export type EmoteId = (typeof EMOTE_SLOTS)[number]["id"];
export const EMOTE_COUNT = EMOTE_SLOTS.length;
export const EMOTE_IDS = EMOTE_SLOTS.map((e) => e.id) as readonly EmoteId[];

/** Slot index checks (0-based, as sent over the wire); the zod protocol schema builds on these. */
export const isPokeStep = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < POKE_STEPS;
export const isEmoteIndex = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < EMOTE_COUNT;
export const isEmoteId = (id: unknown): id is EmoteId => EMOTE_IDS.includes(id as EmoteId);
/** An emote's index on the wheel, or -1 for an unknown id. */
export const emoteIndex = (id: string): number => EMOTE_IDS.indexOf(id as EmoteId);

/** Sounds a companion has: file names under public/sfx/companions/<id>/ (hello, poke1..7, pickup, drop, emote1..6). */
export const pokeSound = (step: number): string => `poke${step + 1}`;
export const emoteSound = (index: number): string => `emote${index + 1}`;
export const VOICE_SLOT_IDS: readonly string[] = [
  "hello",
  ...POKE_STEP_IDS.map((_, i) => pokeSound(i)),
  "pickup",
  "drop",
  ...EMOTE_SLOTS.map((_, i) => emoteSound(i)),
];

/** Motions a companion performs (the animation engine's 18 reactions): every voice slot, plus the sulk and the carry loop. */
export const REACTION_IDS: readonly string[] = [
  "hello",
  ...POKE_STEP_IDS.map((_, i) => pokeSound(i)),
  "sulk",
  "pickup",
  "carry",
  "drop",
  ...EMOTE_SLOTS.map((_, i) => emoteSound(i)),
];

export interface VoiceSlotSpec {
  /** What this sound is, shared by every companion: appended to the companion's voice signature. */
  emotion: string;
  seconds: number;
  influence: number;
}
export const VOICE_SLOTS = kit.voice.slots as Record<string, VoiceSlotSpec>;
export const VOICE_SUFFIX: string = kit.voice.suffix;

/** The speech lines of one companion: one per slot, in bubble-ready plain text. */
export interface CompanionLines {
  /** One per poke step, in ladder order. */
  poke: readonly string[];
  pickup: string;
  drop: string;
  /** One per emote slot, in EMOTE_SLOTS order. */
  emote: readonly string[];
}

export interface CompanionKit {
  id: string;
  /** What the companion sounds like (see build-companion-sfx.mjs); NOT shown to players. */
  voice: string;
  lines: CompanionLines;
  /** The planned animations from the roster (the signature moves the animation engine draws on). */
  moves: readonly string[];
}

/** Longest bubble text, in characters: poke/pickup/drop lines (small bubble) and emotes (large bubble). */
export const MAX_LINE_CHARS = 36;
export const MAX_EMOTE_CHARS = 28;

const RAW = kit.companions as Record<string, { voice: string; lines: CompanionLines }>;

/** The kit of a companion id, or undefined for an unknown id (or a player with no companion). */
export function companionKit(id: string | undefined): CompanionKit | undefined {
  const raw = id ? RAW[id] : undefined;
  const def = companionDef(id);
  return raw && def ? { id: def.id, voice: raw.voice, lines: raw.lines, moves: def.moves } : undefined;
}

export const COMPANION_KITS: readonly CompanionKit[] = COMPANION_IDS.map((id) => companionKit(id)!).filter(Boolean);

/** The line a companion says for a poke step, or undefined for a bad step. */
export function pokeLine(id: string | undefined, step: number): string | undefined {
  return isPokeStep(step) ? companionKit(id)?.lines.poke[step] : undefined;
}

/** The line a companion says for an emote slot, or undefined for a bad index. */
export function emoteLine(id: string | undefined, index: number): string | undefined {
  return isEmoteIndex(index) ? companionKit(id)?.lines.emote[index] : undefined;
}

/** What a voice slot is, in a player's words: "Hello", "Poke 1 · curious", "Emote · Cheer". */
export function voiceSlotLabel(slot: string): string {
  const poke = POKE_STEP_IDS.findIndex((_, i) => pokeSound(i) === slot);
  if (poke >= 0) return `Poke ${poke + 1} · ${POKE_STEP_IDS[poke]}`;
  const emote = EMOTE_SLOTS.findIndex((_, i) => emoteSound(i) === slot);
  if (emote >= 0) return `Emote · ${EMOTE_SLOTS[emote].label}`;
  return slot === "hello" ? "Hello (lobby)" : slot === "pickup" ? "Pick up" : slot === "drop" ? "Drop" : slot;
}

/** The bubble text a companion shows with a voice slot, or undefined for slots that have none (hello). */
export function voiceSlotLine(id: string | undefined, slot: string): string | undefined {
  const lines = companionKit(id)?.lines;
  if (!lines) return undefined;
  const poke = POKE_STEP_IDS.findIndex((_, i) => pokeSound(i) === slot);
  if (poke >= 0) return lines.poke[poke];
  const emote = EMOTE_SLOTS.findIndex((_, i) => emoteSound(i) === slot);
  if (emote >= 0) return lines.emote[emote];
  return slot === "pickup" ? lines.pickup : slot === "drop" ? lines.drop : undefined;
}
