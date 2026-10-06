// Every companion's 18 reactions (companionKit's REACTION_IDS), as data for companionMotion.ts. One shared
// table gives every slot a sensible default; each companion then has a body style (how its whole body moves)
// and a few signature overrides drawn from its planned moves (roster.ts `moves`), so a slime's finale doesn't
// look like a dice's. Times are seconds at speed 1; see Motion/Fx in companionMotion.ts.

import { REACTION_IDS } from "../../shared/companionKit";
import { DEFAULT_STYLE, type BodyStyle, type Fx, type GlyphId, type GlyphMotion, type Motion, type PrimId, type Reaction } from "./companionMotion";

const m = (prim: PrimId, at: number, dur: number, o: Omit<Motion, "prim" | "at" | "dur"> = {}): Motion => ({ prim, at, dur, ...o });
const f = (glyph: GlyphId, motion: GlyphMotion, at: number, o: Omit<Fx, "glyph" | "motion" | "at"> = {}): Fx => ({ glyph, motion, at, ...o });

/** What every companion does in each slot unless it has a signature move there. */
export const DEFAULT_REACTIONS: Readonly<Record<string, Reaction>> = {
  hello: { duration: 1.1, motions: [m("hop", 0, 0.6), m("rock", 0.5, 0.6, { a: 0.6 })], fx: [f("sparkle", "pop", 0.15)] },
  // The poke ladder: curious, happy, affectionate, playful, bothered, pestered, the finale.
  poke1: { duration: 0.9, motions: [m("lean", 0, 0.85, { a: 0.5 }), m("nod", 0.05, 0.35, { a: 0.6 })], fx: [f("question", "pop", 0.05, { dur: 0.85 })] },
  poke2: { duration: 0.95, motions: [m("hop", 0, 0.45, { a: 0.8 }), m("boing", 0.4, 0.55)], fx: [f("note", "rise", 0.1)] },
  poke3: { duration: 1.2, motions: [m("puff", 0, 0.4, { a: 0.5 }), m("wiggle", 0.05, 1.1, { n: 2, a: 0.8 })], fx: [f("heart", "rise", 0.1, { n: 2 })] },
  poke4: { duration: 1.1, motions: [m("hop", 0, 0.65, { a: 1.1 }), m("spin", 0.05, 0.6)], fx: [f("sparkle", "burst", 0.5, { n: 3, dur: 0.6 })] },
  poke5: { duration: 1.0, motions: [m("shake", 0, 0.6, { n: 3, a: 0.8 }), m("droop", 0.1, 0.85, { a: 0.6 })], fx: [f("sweat", "drip", 0.1)] },
  poke6: { duration: 1.2, motions: [m("puff", 0, 0.5, { a: 0.6 }), m("vibrate", 0, 0.75, { a: 1.2 }), m("lean", 0.6, 0.55, { a: 0.4, dir: -1 })], fx: [f("anger", "pop", 0.05), f("smoke", "puff", 0.55)] },
  poke7: {
    duration: 1.8,
    motions: [m("boing", 0, 0.5), m("hop", 0.45, 0.55, { a: 1.5 }), m("spin", 0.48, 0.5), m("flatten", 1.0, 0.6, { a: 0.8 })],
    fx: [f("bang", "pop", 0, { dur: 0.6 }), f("star", "orbit", 1.0, { n: 3, dur: 0.8 })],
  },
  // After the finale: it sulks, then the ladder starts over.
  sulk: { duration: 2.2, motions: [m("droop", 0, 2.2), m("lean", 0, 2.2, { a: 0.35, dir: -1 }), m("nod", 1.2, 0.5, { a: 0.3, dir: -1 })], fx: [f("smoke", "puff", 0.3)] },
  pickup: { duration: 0.6, motions: [m("puff", 0, 0.35, { a: 1.2 }), m("vibrate", 0.1, 0.45, { a: 0.8 })], fx: [f("bang", "pop", 0, { dur: 0.6 })] },
  // Held in the air until it's put down: legs dangle (loops; no glyphs).
  carry: { duration: 1.2, loop: true, motions: [m("rock", 0, 1.2, { a: 0.7 }), m("float", 0, 1.2, { a: 0.3 })], fx: [] },
  drop: { duration: 0.8, motions: [m("flatten", 0, 0.3, { a: 0.7 }), m("boing", 0.25, 0.55)], fx: [f("smoke", "puff", 0, { n: 2, y: -0.75, size: 0.8 })] },
  // The emote wheel: cheer, love, oops, silly, sass, taunt.
  emote1: { duration: 1.4, motions: [m("hop", 0, 0.95, { n: 2, a: 1.2 }), m("rock", 0.9, 0.5, { a: 0.5 })], fx: [f("sparkle", "burst", 0.2, { n: 4 }), f("note", "rise", 0.6)] },
  emote2: { duration: 1.6, motions: [m("puff", 0, 0.5, { a: 0.5 }), m("wiggle", 0, 1.5, { n: 3, a: 0.6 })], fx: [f("heart", "burst", 0.1, { n: 3 }), f("heart", "rise", 0.8)] },
  emote3: { duration: 1.4, motions: [m("lean", 0, 1.3, { a: 0.8, dir: -1 }), m("duck", 0.1, 0.9, { a: 0.5 })], fx: [f("sweat", "drip", 0.1, { n: 2 })] },
  emote4: { duration: 1.6, motions: [m("spin", 0, 0.7), m("wiggle", 0.6, 0.95, { n: 4 })], fx: [f("star", "orbit", 0.6, { n: 3, dur: 0.9 })] },
  emote5: { duration: 1.4, motions: [m("lean", 0, 1.3, { a: 0.6 }), m("nod", 0.3, 0.7, { n: 2, a: 0.6 })], fx: [f("sparkle", "pop", 0.4)] },
  emote6: { duration: 1.4, motions: [m("hop", 0, 0.45, { a: 0.6 }), m("wiggle", 0.1, 1.25, { n: 4, a: 1.1 })], fx: [f("note", "rise", 0.2, { n: 2 })] },
};

/** How each companion's body moves (see BodyStyle). */
export const BODY_STYLES: Readonly<Record<string, BodyStyle>> = {
  foil: { bounce: 1.15, speed: 1.15, amp: 1, squash: 1, pivot: 0.4, head: 0.8 }, // quick little rat
  cinder: { bounce: 1.2, speed: 1.1, amp: 1.15, squash: 1, pivot: 0.42, head: 0.85 }, // overeager
  folio: { bounce: 0.9, speed: 1, amp: 0.9, squash: 0.6, pivot: 0.4, head: 0.78 }, // a book: stiff covers
  gloop: { bounce: 0.7, speed: 0.8, amp: 1, squash: 1.8, pivot: 0.32, head: 0.66 }, // sleepy jelly
  sprout: { bounce: 0.9, speed: 1, amp: 0.8, squash: 1, pivot: 0.4, head: 0.86 }, // shy
  wick: { bounce: 0.8, speed: 0.95, amp: 1, squash: 1.25, pivot: 0.45, head: 0.9 }, // a wobbly flame
  crit: { bounce: 0.6, speed: 0.9, amp: 0.8, squash: 0.35, pivot: 0.42, head: 0.82 }, // stone dice: heavy, rigid
  nimbus: { bounce: 0.8, speed: 0.75, amp: 1.1, squash: 1.1, pivot: 0.42, head: 0.8 }, // dreamy drifter
  hex: { bounce: 1, speed: 1, amp: 0.85, squash: 0.9, pivot: 0.42, head: 0.84 }, // aloof cat
  ribbit: { bounce: 1.45, speed: 1.05, amp: 1.1, squash: 1.1, pivot: 0.42, head: 0.88 }, // frog: big jumper
};

/** Each companion's signature reactions, replacing (field by field) the default for that slot. */
export const SIGNATURES: Readonly<Record<string, Readonly<Record<string, Partial<Reaction>>>>> = {
  foil: {
    poke7: {
      move: "Faint on a bad pick",
      duration: 2.2,
      motions: [m("vibrate", 0, 0.4, { a: 1.4 }), m("faint", 0.35, 1.8, { a: 1.1, dir: -1 })],
      fx: [f("bang", "pop", 0, { dur: 0.5 }), f("star", "orbit", 0.7, { n: 3, dur: 1.1, x: 0.5, y: -0.4 })],
    },
    emote1: { move: "Cape flourish", motions: [m("turn", 0, 0.6, { n: 2 }), m("hop", 0.5, 0.5, { a: 1.1 }), m("lean", 0.9, 0.5, { a: 0.5 })], fx: [f("sparkle", "burst", 0.45, { n: 5 })] },
    emote2: { move: "Hug the card", motions: [m("flatten", 0, 1.3, { a: 0.25 }), m("wiggle", 0.1, 1.2, { n: 2, a: 0.5 })], fx: [f("heart", "rise", 0.2, { n: 3 })] },
    emote4: { move: "Nibble the pack", duration: 1.5, motions: [m("nod", 0, 1.4, { n: 7, a: 0.7 }), m("vibrate", 0, 1.4, { a: 0.6 })], fx: [f("note", "pop", 0.3), f("sparkle", "rise", 0.9)] },
    drop: { move: "Tuck and roll", duration: 0.9, motions: [m("spin", 0, 0.55, { dir: -1 }), m("slide", 0, 0.6, { a: 0.6 }), m("boing", 0.5, 0.4)], fx: [f("smoke", "puff", 0.5, { y: -0.75, size: 0.8 })] },
  },
  cinder: {
    poke6: { move: "Pout with smoke", motions: [m("puff", 0, 0.5, { a: 0.8 }), m("vibrate", 0, 0.8, { a: 1.3 })], fx: [f("anger", "pop", 0), f("smoke", "puff", 0.25, { n: 3, x: 0.1 })] },
    poke7: {
      move: "Sneeze (fire puff)",
      duration: 1.5,
      motions: [m("puff", 0, 0.45, { a: 1 }), m("boing", 0.4, 0.5, { a: 1.4 }), m("slide", 0.42, 0.6, { a: 0.7, dir: -1 }), m("shake", 0.9, 0.5, { a: 0.6 })],
      fx: [f("flame", "burst", 0.45, { n: 5, dur: 0.7 }), f("smoke", "puff", 0.6, { n: 2 })],
    },
    sulk: { move: "Curl up and sleep on the card", motions: [m("flatten", 0, 2.2, { a: 0.55 }), m("nod", 0.4, 1.6, { n: 2, a: 0.3 })], fx: [f("zzz", "rise", 0.5, { n: 2, dur: 1.2 })] },
    emote1: { move: "Flap hover", motions: [m("float", 0, 1.35, { n: 3, a: 1.4 }), m("vibrate", 0, 1.35, { n: 20, a: 0.9 })], fx: [f("flame", "rise", 0.3, { n: 3 })] },
    emote5: { move: "Pout with smoke", motions: [m("lean", 0, 1.3, { a: 0.7, dir: -1 }), m("puff", 0.2, 0.5, { a: 0.5 })], fx: [f("smoke", "puff", 0.3, { n: 2 })] },
    drop: { move: "Flap hover (flutters down)", motions: [m("float", 0, 0.6, { n: 2, a: 0.8 }), m("vibrate", 0, 0.6, { n: 16, a: 0.7 }), m("flatten", 0.55, 0.25, { a: 0.5 })], fx: [f("smoke", "puff", 0.55, { y: -0.75, size: 0.8 })] },
  },
  folio: {
    poke1: { move: "Flip open and gasp", motions: [m("turn", 0, 0.45), m("puff", 0.4, 0.4, { a: 0.8 })], fx: [f("bang", "pop", 0.4, { dur: 0.5 })] },
    poke7: {
      move: "Snap shut (hide)",
      duration: 1.7,
      motions: [m("puff", 0, 0.3, { a: 1.2 }), m("turn", 0.25, 0.3), m("duck", 0.5, 1.15, { a: 1.1 }), m("vibrate", 0.6, 0.9, { a: 0.5 })],
      fx: [f("anger", "pop", 0), f("bang", "pop", 0.5, { x: 0.25, dur: 0.6 })],
    },
    emote1: { move: "Page-flutter dance", motions: [m("turn", 0, 1.1, { n: 3 }), m("hop", 0.1, 1.0, { n: 2, a: 0.8 })], fx: [f("sparkle", "burst", 0.3, { n: 4 })] },
    emote6: { move: "Ribbon tongue", motions: [m("lean", 0, 1.3, { a: 0.5, dir: -1 }), m("vibrate", 0.2, 1.0, { a: 1 })], fx: [f("note", "rise", 0.3, { n: 2 })] },
    drop: { move: "Lands flat with a thump", motions: [m("flatten", 0, 0.45, { a: 1 }), m("turn", 0.4, 0.4)], fx: [f("smoke", "puff", 0, { n: 3, y: -0.75, size: 0.8 })] },
  },
  gloop: {
    poke3: { move: "Wobble", motions: [m("wiggle", 0, 1.15, { n: 2, a: 1.1 }), m("boing", 0, 1.1, { n: 2.5, a: 0.9 })], fx: [f("heart", "rise", 0.2)] },
    poke7: {
      move: "Squish flat",
      duration: 2.0,
      motions: [m("boing", 0, 0.5, { a: 1.2 }), m("flatten", 0.4, 1.4, { a: 1 }), m("wiggle", 0.8, 0.9, { n: 3, a: 0.4 })],
      fx: [f("bubble", "rise", 0.5, { n: 3 }), f("anger", "pop", 0.1)],
    },
    emote2: { move: "Glow pulse", motions: [m("puff", 0, 0.5, { a: 0.8 }), m("puff", 0.5, 0.5, { a: 0.8 }), m("puff", 1.0, 0.5, { a: 0.8 })], fx: [f("sparkle", "burst", 0.1, { n: 4 }), f("heart", "rise", 0.7)] },
    emote4: { move: "Absorb a token", motions: [m("flatten", 0, 0.6, { a: 0.6 }), m("puff", 0.5, 0.45, { a: 1.1 }), m("boing", 0.9, 0.6)], fx: [f("bubble", "pop", 0.5), f("question", "pop", 1.0)] },
    drop: { move: "Splat", motions: [m("flatten", 0, 0.45, { a: 1.2 }), m("boing", 0.35, 0.45, { n: 2.5 })], fx: [f("bubble", "burst", 0, { n: 3, y: -0.5 })] },
  },
  sprout: {
    hello: { move: "Wave leaf", motions: [m("rock", 0, 1.05, { n: 2, a: 0.8 }), m("hop", 0.05, 0.4, { a: 0.5 })], fx: [f("leaf", "rise", 0.2)] },
    poke7: {
      move: "Tiny scream",
      duration: 1.5,
      motions: [m("puff", 0, 0.3, { a: 1.1 }), m("vibrate", 0, 1.1, { n: 22, a: 1.6 }), m("hop", 0.1, 0.4, { a: 1.2 })],
      fx: [f("bang", "pop", 0, { n: 2, dur: 0.9 }), f("leaf", "burst", 0.2, { n: 4 })],
    },
    pickup: { move: "Uprooted!", motions: [m("puff", 0, 0.3, { a: 1.4 }), m("vibrate", 0, 0.6, { n: 12, a: 1.4 })], fx: [f("bang", "pop", 0, { dur: 0.6 })] },
    emote1: { move: "Bloom the flower", motions: [m("puff", 0, 0.7, { a: 1 }), m("hop", 0.6, 0.5, { a: 0.6 })], fx: [f("leaf", "burst", 0.25, { n: 5 }), f("sparkle", "pop", 0.4)] },
    emote3: { move: "Hide in the pot", motions: [m("duck", 0, 1.3, { a: 1.3 }), m("vibrate", 0.2, 0.9, { a: 0.5 })], fx: [f("sweat", "drip", 0.15)] },
    sulk: { move: "Hide in the pot", motions: [m("duck", 0, 2.2, { a: 1 }), m("nod", 1.0, 0.6, { a: 0.3 })], fx: [f("tear", "drip", 0.3)] },
    drop: { move: "Replanted (plops into the pot)", motions: [m("duck", 0, 0.45, { a: 0.9 }), m("boing", 0.4, 0.4)], fx: [f("leaf", "pop", 0.1)] },
  },
  wick: {
    poke5: { move: "Flicker (nervous)", motions: [m("flicker", 0, 0.9, { n: 6 }), m("vibrate", 0, 0.9, { a: 0.8 })], fx: [f("sweat", "drip", 0.1)] },
    poke7: {
      move: "Flame flare (furious)",
      duration: 1.6,
      motions: [m("puff", 0, 0.6, { a: 1.6 }), m("vibrate", 0, 1.0, { a: 1.2 }), m("droop", 0.9, 0.7, { a: 0.8 })],
      fx: [f("flame", "burst", 0.1, { n: 5 }), f("anger", "pop", 0.2), f("smoke", "puff", 1.0)],
    },
    sulk: { move: "Blow out (sleep)", motions: [m("flicker", 0, 2.2, { n: 3, a: 1.4 }), m("droop", 0, 2.2, { a: 0.8 })], fx: [f("smoke", "puff", 0.2), f("zzz", "rise", 0.8, { n: 2, dur: 1.2 })] },
    emote1: { move: "Flame flare (excited)", motions: [m("puff", 0, 0.6, { a: 1.3 }), m("hop", 0.5, 0.6, { a: 0.8 })], fx: [f("flame", "rise", 0.1, { n: 3 }), f("sparkle", "burst", 0.4, { n: 3 })] },
    emote3: { move: "Drip melt", motions: [m("droop", 0, 1.35, { a: 1.6 }), m("duck", 0.3, 1.0, { a: 0.4 })], fx: [f("tear", "drip", 0.2, { n: 2, tint: "#ffe6a0" })] },
    drop: { move: "Flicker (the flame gutters on landing)", motions: [m("flatten", 0, 0.3, { a: 0.6 }), m("flicker", 0, 0.8, { n: 4 }), m("boing", 0.25, 0.55)], fx: [f("smoke", "puff", 0.05, { size: 0.7 })] },
  },
  crit: {
    poke4: { move: "Roll tumble", motions: [m("spin", 0, 0.7), m("slide", 0, 0.7, { a: 1.1 }), m("hop", 0, 0.7, { a: 1 })], fx: [f("star", "pop", 0.65, { dur: 0.6 })] },
    poke7: {
      move: "Stomp",
      duration: 1.6,
      motions: [m("hop", 0, 0.5, { a: 1.6 }), m("flatten", 0.48, 0.3, { a: 1.6 }), m("shake", 0.5, 0.5, { n: 5, a: 1.4 }), m("hop", 0.8, 0.45, { a: 1.2 }), m("flatten", 1.24, 0.3, { a: 1.6 })],
      fx: [f("smoke", "puff", 0.5, { n: 3, y: -0.75 }), f("anger", "pop", 0.1), f("smoke", "puff", 1.25, { n: 2, y: -0.75 })],
    },
    drop: { move: "Roll tumble", duration: 0.9, motions: [m("spin", 0, 0.6, { n: 1, dir: -1 }), m("slide", 0, 0.65, { a: 0.8 }), m("shake", 0.6, 0.3, { a: 0.6 })], fx: [f("star", "pop", 0.55, { dur: 0.5 })] },
    emote1: { move: "Nat-20 cheer", motions: [m("hop", 0, 0.7, { a: 2.2 }), m("spin", 0.05, 0.6), m("puff", 0.75, 0.5, { a: 0.6 })], fx: [f("star", "burst", 0.35, { n: 5 }), f("sparkle", "pop", 0.75)] },
    emote3: { move: "Nat-1 sad slump", motions: [m("faint", 0, 1.35, { a: 0.6, dir: -1 }), m("droop", 0, 1.35, { a: 1.2 })], fx: [f("tear", "drip", 0.3)] },
    emote6: { move: "Stomp", motions: [m("hop", 0, 0.4, { a: 1.4 }), m("flatten", 0.38, 0.25, { a: 1.4 }), m("hop", 0.6, 0.4, { a: 1.4 }), m("flatten", 0.98, 0.25, { a: 1.4 })], fx: [f("smoke", "puff", 0.4, { y: -0.75 }), f("smoke", "puff", 1.0, { y: -0.75 })] },
  },
  nimbus: {
    hello: { move: "Drift in a circle", duration: 1.4, motions: [m("circle", 0, 1.4, { a: 1 }), m("float", 0, 1.4, { a: 0.5 })], fx: [f("sparkle", "rise", 0.3)] },
    poke7: {
      move: "Rain a little (indignant)",
      duration: 1.9,
      motions: [m("puff", 0, 0.5, { a: 1.2 }), m("float", 0.3, 1.5, { a: 0.8 }), m("shake", 0.4, 0.8, { a: 0.7 })],
      fx: [f("tear", "fall", 0.4, { n: 5, dur: 0.8, tint: "#8fd0ff" }), f("anger", "pop", 0.05)],
    },
    sulk: { move: "Yawn", motions: [m("boing", 0, 0.8, { n: 0.5, a: 1 }), m("droop", 0.6, 1.6), m("float", 0, 2.2, { a: 0.3 })], fx: [f("zzz", "rise", 0.7, { n: 2, dur: 1.2 })] },
    emote1: { move: "Sing (sparkles)", motions: [m("float", 0, 1.35, { n: 2, a: 1 }), m("rock", 0, 1.35, { n: 2, a: 0.5 })], fx: [f("note", "rise", 0.1, { n: 3 }), f("sparkle", "burst", 0.6, { n: 3 })] },
    emote3: { move: "Rain a little", motions: [m("droop", 0, 1.35, { a: 1 }), m("float", 0, 1.35, { a: 0.4 })], fx: [f("tear", "fall", 0.2, { n: 4, tint: "#8fd0ff" })] },
    drop: { move: "Drifts down", duration: 1.0, motions: [m("float", 0, 0.7, { a: 0.6 }), m("boing", 0.5, 0.5, { a: 0.6 })], fx: [f("sparkle", "pop", 0.6)] },
  },
  hex: {
    poke7: {
      move: "Knock a token off (then hiss)",
      duration: 1.7,
      motions: [m("lean", 0, 0.6, { a: 0.8, dir: -1 }), m("slide", 0.15, 0.4, { a: 0.5, dir: -1 }), m("puff", 0.6, 0.6, { a: 1.3 }), m("vibrate", 0.6, 0.8, { a: 0.8 })],
      fx: [f("bang", "pop", 0.35, { x: -0.35, dur: 0.5 }), f("anger", "pop", 0.6)],
    },
    sulk: { move: "Loaf (sit on the card)", motions: [m("flatten", 0, 2.2, { a: 0.4 }), m("nod", 1.2, 0.6, { a: 0.4 })], fx: [f("zzz", "rise", 0.6, { dur: 1.2 })] },
    emote2: { move: "Slow blink", duration: 1.8, motions: [m("nod", 0, 1.6, { a: 0.8 }), m("puff", 0.2, 0.8, { a: 0.3 })], fx: [f("heart", "pop", 0.6, { dur: 1.1 })] },
    emote4: { move: "Tail-star twirl", motions: [m("spin", 0, 0.9, { n: 2 }), m("hop", 0.85, 0.4, { a: 0.6 })], fx: [f("star", "orbit", 0.2, { n: 4, dur: 1.1 })] },
    emote6: { move: "Knock a token off", motions: [m("lean", 0, 0.7, { a: 0.7, dir: -1 }), m("slide", 0.2, 0.4, { a: 0.6, dir: -1 }), m("nod", 0.8, 0.5, { a: 0.6 })], fx: [f("bang", "pop", 0.45, { x: -0.4, dur: 0.6 })] },
    drop: { move: "Lands on its feet (slow blink, unbothered)", motions: [m("flatten", 0, 0.2, { a: 0.3 }), m("nod", 0.25, 0.55, { a: 0.5 })], fx: [f("sparkle", "pop", 0.25, { x: 0.3, size: 0.8 })] },
  },
  ribbit: {
    hello: { move: "Throat-bubble croak", motions: [m("puff", 0, 0.4, { a: 1 }), m("puff", 0.45, 0.4, { a: 1 })], fx: [f("bubble", "pop", 0.05), f("note", "rise", 0.5)] },
    poke7: {
      move: "Challenge, then hide behind the shield",
      duration: 1.9,
      motions: [m("hop", 0, 0.6, { a: 1.5 }), m("lean", 0, 0.8, { a: 0.8 }), m("duck", 0.9, 1.0, { a: 1.1 }), m("vibrate", 1.0, 0.8, { a: 0.6 })],
      fx: [f("bang", "pop", 0.1, { dur: 0.6 }), f("sweat", "drip", 1.0, { n: 2 })],
    },
    emote1: { move: "Sword salute", motions: [m("nod", 0, 0.5, { a: 1 }), m("hop", 0.45, 0.6, { a: 1 }), m("rock", 0.95, 0.4, { a: 0.4 })], fx: [f("sparkle", "pop", 0.1, { x: 0.25 }), f("star", "burst", 0.6, { n: 3 })] },
    emote3: { move: "Shield up", motions: [m("duck", 0, 1.3, { a: 0.9 }), m("lean", 0, 1.3, { a: 0.5, dir: -1 })], fx: [f("sweat", "drip", 0.2)] },
    emote6: { move: "Tongue-snatch a token", motions: [m("lean", 0, 0.45, { a: 0.8, dir: -1 }), m("slide", 0, 0.45, { a: 0.4 }), m("puff", 0.45, 0.4, { a: 0.6 }), m("hop", 0.85, 0.45, { a: 0.8 })], fx: [f("bang", "pop", 0.4), f("note", "rise", 0.8)] },
    drop: { move: "Big frog landing", motions: [m("flatten", 0, 0.35, { a: 1.2 }), m("hop", 0.3, 0.45, { a: 0.6 })], fx: [f("smoke", "puff", 0, { n: 2, y: -0.75, size: 0.8 })] },
  },
};

/**
 * Reactions for the Treatomancer's race (treatShow.ts), shared by every companion (their body style still makes
 * each one move its own way). Kept out of REACTION_IDS: they have no voice slot or line of their own.
 */
export const TREAT_REACTIONS: Readonly<Record<string, Reaction>> = {
  // Something flew out of the machine: a startled perk-up.
  alert: { duration: 0.8, motions: [m("puff", 0, 0.35, { a: 1 }), m("hop", 0.05, 0.4, { a: 0.7 })], fx: [f("bang", "pop", 0, { dur: 0.7 })] },
  // Running for it: quick little bounds, leaning in (loops while it runs).
  dash: { duration: 0.32, loop: true, motions: [m("hop", 0, 0.32, { a: 0.55 }), m("boing", 0, 0.32, { n: 1, a: 0.5 })], fx: [] },
  // Face-plant, lie there dazed, get back up.
  trip: {
    duration: 1.2,
    motions: [m("faint", 0, 1.15, { a: 1.05, dir: -1 }), m("vibrate", 0.4, 0.4, { a: 0.6 })],
    fx: [f("bang", "pop", 0, { dur: 0.5 }), f("star", "orbit", 0.25, { n: 3, dur: 0.9, x: 0.4, y: -0.45 }), f("smoke", "puff", 0.05, { n: 2, y: -0.75, size: 0.8 })],
  },
  // Got it, and it's food: chomp chomp, a happy wiggle.
  feast: {
    duration: 2.4,
    motions: [m("nod", 0, 0.9, { n: 4, a: 1 }), m("puff", 0.85, 0.4, { a: 0.9 }), m("hop", 1.15, 0.6, { n: 2, a: 1 }), m("wiggle", 1.6, 0.8, { n: 3 })],
    fx: [f("sparkle", "burst", 0.1, { n: 4, dur: 0.6 }), f("heart", "rise", 1.0, { n: 3 }), f("note", "rise", 1.6)],
  },
  // Got it, and it's a keepsake: hugs it and spins round with it.
  hug: {
    duration: 2.4,
    motions: [m("flatten", 0, 0.9, { a: 0.3 }), m("wiggle", 0.1, 0.8, { n: 2, a: 0.6 }), m("spin", 0.95, 0.6), m("hop", 1.5, 0.6, { n: 2, a: 0.9 })],
    fx: [f("heart", "burst", 0.1, { n: 4 }), f("sparkle", "orbit", 0.9, { n: 3, dur: 0.9 }), f("heart", "rise", 1.6, { n: 2 })],
  },
  // Too slow: a sulky slump.
  pout: { duration: 1.6, motions: [m("droop", 0, 1.6, { a: 1 }), m("shake", 0.2, 0.6, { n: 3, a: 0.6 })], fx: [f("sweat", "drip", 0.1), f("smoke", "puff", 0.6, { size: 0.7 })] },
};
export const TREAT_REACTION_IDS: readonly string[] = Object.keys(TREAT_REACTIONS);

/** A companion's body style (an even default for unknown ids). */
export const bodyStyle = (id: string | undefined): BodyStyle => (id && BODY_STYLES[id]) || DEFAULT_STYLE;

/** The slots where a companion has its own signature reaction. */
export const signatureSlots = (id: string | undefined): string[] => Object.keys((id && SIGNATURES[id]) || {});

/** What a companion does in a slot: its signature if it has one, else the shared default; undefined for an unknown slot. */
export function reactionFor(id: string | undefined, slot: string): Reaction | undefined {
  if (TREAT_REACTIONS[slot]) return TREAT_REACTIONS[slot];
  const base = DEFAULT_REACTIONS[slot];
  if (!base || !REACTION_IDS.includes(slot)) return undefined;
  const sig = id ? SIGNATURES[id]?.[slot] : undefined;
  return sig ? { ...base, ...sig } : base;
}
