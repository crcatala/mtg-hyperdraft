// The Sound Studio (/dev/sound-studio): auditions every sound of every pack, and plays the draft's
// sound sequences with the game's own timings. The sequences call the real `sfx` (same gains, pitch
// jitter, takes and compressor) and the real reveal schedule, so what you hear here is what the
// Draft screen plays. The one thing the studio adds is a *mix*: each sound can come from a different
// pack (sfx.setPackOverride), for trying combinations before a pack is regenerated.

import manifest from "./sfxManifest.json";
import { sfx } from "./sfx";
import { DEFAULT_PACK, isPack, SOUND_PACKS, type PackId } from "./soundPacks";
import { RARITY_RANK, revealSchedule, TEAR_MS } from "./revealSchedule";
import { autoStep, COMMIT_AT, soundSpeed } from "./pack/tearGesture";

export interface StudioSound {
  name: string;
  /** When the game plays it, in a player's words. */
  what: string;
}

/** Every sound in the manifest, grouped the way they come up in a draft. */
export const STUDIO_GROUPS: { title: string; sounds: StudioSound[] }[] = [
  {
    title: "Opening the pack",
    sounds: [
      { name: "pack-land", what: "The pack drops onto the table" },
      { name: "pack-hover", what: "Pointer moves over the pack" },
      { name: "tear-scrub", what: "Dragging the tear (loops, follows drag speed)" },
      { name: "tear", what: "Tearing with a click or Space" },
      { name: "pack-burst", what: "The top comes away" },
      { name: "cards-slide", what: "Cards slide up out of the pack" },
    ],
  },
  {
    title: "Reveal",
    sounds: [
      { name: "deal", what: "Each card dealt face down" },
      { name: "flip", what: "Each card turning face up (pitch rises)" },
      { name: "uncommon", what: "Chime under a card rarer than the rest of the pack" },
      { name: "rare", what: "Final reveal: a standout rare" },
      { name: "mythic", what: "Final reveal: a mythic" },
    ],
  },
  {
    title: "Drafting",
    sounds: [
      { name: "select", what: "Select a card" },
      { name: "deselect", what: "Deselect a card" },
      { name: "pick", what: "Confirm the pick" },
      { name: "burn", what: "A burned card" },
      { name: "pack-pass", what: "Your pack passes to the next seat" },
      { name: "pack-arrive", what: "The next pack slides in" },
      { name: "tick", what: "Pick timer running low" },
    ],
  },
  {
    title: "Looking at cards",
    sounds: [
      { name: "zoom-open", what: "A card zooms up to read" },
      { name: "zoom-close", what: "…and back down" },
      { name: "turn-over", what: "A double-faced card turned over" },
      { name: "row-hover", what: "Hovering rows in your picks list" },
      { name: "tap", what: "Tapping a card on the table" },
    ],
  },
];

export const STUDIO_SOUNDS = STUDIO_GROUPS.flatMap((g) => g.sounds.map((s) => s.name));

// --- the mix -------------------------------------------------------------------------------------

/** Which pack each sound comes from. */
export type Mix = Record<string, PackId>;

export function uniformMix(pack: PackId): Mix {
  return Object.fromEntries(manifest.map((s) => [s.name, pack]));
}

/** A saved mix, with anything missing or no longer a pack set to `base`. */
export function readMix(saved: unknown, base: PackId = DEFAULT_PACK): Mix {
  const mix = uniformMix(base);
  if (saved && typeof saved === "object") {
    for (const name of Object.keys(mix)) {
      const p = (saved as Record<string, unknown>)[name];
      if (typeof p === "string" && isPack(p)) mix[name] = p;
    }
  }
  return mix;
}

/** The pack most sounds come from (ties go to the earlier pack in SOUND_PACKS). */
export function basePack(mix: Mix): PackId {
  let best: PackId = SOUND_PACKS[0].id;
  let most = -1;
  for (const { id } of SOUND_PACKS) {
    const n = Object.values(mix).filter((p) => p === id).length;
    if (n > most) [best, most] = [id, n];
  }
  return best;
}

/** The mix as text to paste into a request: the base pack and each sound swapped from another. */
export function mixSummary(mix: Mix): string {
  const label = (id: PackId) => SOUND_PACKS.find((p) => p.id === id)?.label ?? id;
  const base = basePack(mix);
  const swaps = STUDIO_SOUNDS.filter((n) => mix[n] !== base);
  const lines = [`Base pack: ${label(base)} (${base})`];
  if (!swaps.length) return [...lines, "No swaps: every sound comes from this pack."].join("\n");
  const width = Math.max(...swaps.map((n) => n.length));
  return [...lines, "Swaps:", ...swaps.map((n) => `  ${n.padEnd(width)}  → ${label(mix[n])} (${mix[n]})`)].join("\n");
}

// --- sequences -----------------------------------------------------------------------------------

/** Runs cues on a timeline; the screen backs it with timers, tests with a list. */
export interface Scheduler {
  /** Runs `fn` `ms` after the sequence started; `cue` names it (the sound, or a step). */
  at(ms: number, cue: string, fn: () => void): void;
}

/** What's in the pack being opened, as RARITY_RANKs in reveal order (rarest last), like Draft.tsx. */
export const PACK_CONTENTS = {
  mythic: { label: "Mythic", ranks: [...Array(10).fill(RARITY_RANK.common), ...Array(3).fill(RARITY_RANK.uncommon), RARITY_RANK.mythic] },
  rare: { label: "Rare", ranks: [...Array(10).fill(RARITY_RANK.common), ...Array(3).fill(RARITY_RANK.uncommon), RARITY_RANK.rare] },
  both: { label: "Rare + mythic", ranks: [...Array(9).fill(RARITY_RANK.common), ...Array(3).fill(RARITY_RANK.uncommon), RARITY_RANK.rare, RARITY_RANK.mythic] },
  cube: { label: "Cube (all rares)", ranks: Array(15).fill(RARITY_RANK.rare) },
} satisfies Record<string, { label: string; ranks: number[] }>;
export type PackContents = keyof typeof PACK_CONTENTS;
export type TearStyle = "drag" | "click";

/** How long a click/Space tear takes before the strip comes away (the 3D pack's autoStep at 60 fps). */
export function autoTearMs(): number {
  const dt = 1 / 60;
  let p = 0;
  let frames = 0;
  while (p < COMMIT_AT) {
    p = autoStep(p, dt);
    frames++;
  }
  return Math.round(frames * dt * 1000);
}

/** About how long the 3D pack takes to fall in and land (its spring in PackScene). */
const LAND_MS = 320;
/** A hand dragging across the pack: how long the rip lasts. */
const DRAG_MS = 850;

/** The looping rip under a drag that speeds up, wavers and pulls through, like a real hand. */
function dragTear(s: Scheduler, from: number, ms: number) {
  let voice: ReturnType<typeof sfx.tearStart> | null = null;
  s.at(from, "tear-scrub", () => (voice = sfx.tearStart()));
  for (let t = 0; t <= ms; t += 30) {
    const x = t / ms;
    // Pack widths per second, as the scene measures it.
    const rate = x < 0.18 ? (x / 0.18) * 1.5 : 1.5 + 0.3 * Math.sin(x * 14) + 0.6 * Math.max(0, x - 0.7);
    s.at(from + t, "", () => voice?.update(soundSpeed(rate)));
  }
  s.at(from + ms, "", () => voice?.end(true));
}

/** Pack lands, gets hovered, is torn, bursts, and the cards are dealt and flipped. Returns its length. */
export function openPack(s: Scheduler, contents: PackContents, tear: TearStyle): number {
  s.at(LAND_MS, "pack-land", sfx.packLand);
  s.at(900, "pack-hover", sfx.packHover);
  s.at(1300, "pack-hover", sfx.packHover);
  const tearAt = 1800;
  let commit: number;
  if (tear === "drag") {
    dragTear(s, tearAt, DRAG_MS);
    commit = tearAt + DRAG_MS;
  } else {
    s.at(tearAt, "tear", sfx.tearAuto);
    commit = tearAt + autoTearMs();
  }
  // PackScene's commit(), then Draft's tearing → dealing after TEAR_MS.
  s.at(commit, "pack-burst", sfx.packBurst);
  s.at(commit + 130, "cards-slide", sfx.cardsSlide);
  const deal0 = commit + TEAR_MS;
  const ranks = PACK_CONTENTS[contents].ranks;
  const plan = revealSchedule(ranks);
  for (const d of plan.deals) s.at(deal0 + d, "deal", sfx.deal);
  for (const step of plan.reveals) {
    s.at(deal0 + step.at, "flip", () => sfx.flip(step.k));
    if (step.notable) s.at(deal0 + step.at, "uncommon", sfx.notable);
    if (step.highlight) s.at(deal0 + step.at, step.rank >= 3 ? "mythic" : "rare", step.rank >= 3 ? sfx.mythic : sfx.rare);
  }
  // Leave the last fanfare room to ring out.
  return deal0 + plan.done + (Math.max(...ranks) >= 3 ? 2600 : 1400);
}

/** Choosing cards, confirming the pick (with a burn), the next pack arriving, and the timer. */
export function makePick(s: Scheduler): number {
  s.at(0, "select", sfx.select);
  s.at(550, "select", sfx.select);
  s.at(1100, "deselect", sfx.deselect);
  s.at(1600, "select", sfx.select);
  // Draft.confirm(): pick and pass together, the burn just after.
  s.at(2300, "pick", sfx.pick);
  s.at(2300, "pack-pass", sfx.packPass);
  s.at(2440, "burn", sfx.burn);
  s.at(3500, "pack-arrive", sfx.packArrive);
  for (const t of [4300, 5300, 6300]) s.at(t, "tick", sfx.tick);
  return 7000;
}

/** Zooming in on a card, turning a double-faced one over, the picks list, tapping on the table. */
export function browseCards(s: Scheduler): number {
  s.at(0, "zoom-open", sfx.zoomOpen);
  s.at(800, "turn-over", sfx.turnOver);
  s.at(1700, "turn-over", sfx.turnOver);
  s.at(2500, "zoom-close", sfx.zoomClose);
  for (let i = 0; i < 6; i++) s.at(3200 + i * 110, "row-hover", sfx.rowHover);
  s.at(4200, "tap", sfx.tap);
  s.at(4900, "tap", sfx.tap);
  return 5600;
}

/** The debug console's taste of a pack. */
export function packPreview(s: Scheduler): number {
  s.at(0, "preview", sfx.preview);
  return 2500;
}

/** Runs sequences back to back on one scheduler. */
export function chain(s: Scheduler, ...parts: ((s: Scheduler) => number)[]): number {
  let offset = 0;
  for (const part of parts) {
    offset += part({ at: (ms, cue, fn) => s.at(offset + ms, cue, fn) });
  }
  return offset;
}

/** One sound on its own, the way the game plays it. */
export function playOne(s: Scheduler, name: string) {
  const one: Record<string, () => void> = {
    "pack-land": sfx.packLand,
    "pack-hover": sfx.packHover,
    tear: sfx.tearAuto,
    "pack-burst": sfx.packBurst,
    "cards-slide": sfx.cardsSlide,
    deal: sfx.deal,
    flip: () => sfx.flip(0),
    uncommon: sfx.notable,
    rare: sfx.rare,
    mythic: sfx.mythic,
    select: sfx.select,
    deselect: sfx.deselect,
    pick: sfx.pick,
    burn: sfx.burn,
    "pack-pass": sfx.packPass,
    "pack-arrive": sfx.packArrive,
    tick: sfx.tick,
    "zoom-open": sfx.zoomOpen,
    "zoom-close": sfx.zoomClose,
    "turn-over": sfx.turnOver,
    "row-hover": sfx.rowHover,
    tap: sfx.tap,
  };
  if (name === "tear-scrub") dragTear(s, 0, 1200);
  else if (one[name]) s.at(0, name, one[name]);
}
