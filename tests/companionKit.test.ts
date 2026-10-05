import { describe, expect, it } from "vitest";
import {
  COMPANION_KITS, companionKit, emoteIndex, emoteLine, EMOTE_COUNT, EMOTE_IDS, EMOTE_SLOTS, emoteSound, isEmoteId, isEmoteIndex,
  isPokeStep, MAX_EMOTE_CHARS, MAX_LINE_CHARS, POKE_STEPS, POKE_STEP_IDS, pokeLine, pokeSound, REACTION_IDS, VOICE_SLOT_IDS, VOICE_SLOTS,
} from "../src/shared/companionKit";
import kitJson from "../src/shared/companionKit.json";
import { COMPANIONS, COMPANION_IDS } from "../src/shared/roster";

// Keys only: the voice files that exist on disk.
const mp3s = new Set(Object.keys(import.meta.glob("/public/sfx/companions/*/*.mp3")));

describe("companion slots", () => {
  it("has 7 poke steps and 6 emote slots in the agreed order", () => {
    expect(POKE_STEPS).toBe(7);
    expect(POKE_STEP_IDS).toEqual(["curious", "happy", "affectionate", "playful", "bothered", "pestered", "finale"]);
    expect(EMOTE_COUNT).toBe(6);
    expect(EMOTE_IDS).toEqual(["cheer", "love", "oops", "silly", "sass", "taunt"]);
  });

  it("gives every emote a label and a unique icon", () => {
    for (const e of EMOTE_SLOTS) expect(e.label.length).toBeGreaterThan(0);
    expect(new Set(EMOTE_SLOTS.map((e) => e.icon)).size).toBe(EMOTE_COUNT);
  });

  it("validates poke steps as whole numbers 0..6", () => {
    for (const n of [0, 3, 6]) expect(isPokeStep(n), String(n)).toBe(true);
    for (const n of [-1, 7, 1.5, NaN, Infinity, "2", null, undefined]) expect(isPokeStep(n), String(n)).toBe(false);
  });

  it("validates emote indexes as whole numbers 0..5 and ids from the wheel", () => {
    for (const n of [0, 2, 5]) expect(isEmoteIndex(n), String(n)).toBe(true);
    for (const n of [-1, 6, 0.5, NaN, "1", null]) expect(isEmoteIndex(n), String(n)).toBe(false);
    expect(isEmoteId("taunt")).toBe(true);
    expect(isEmoteId("emote1")).toBe(false);
    expect(emoteIndex("silly")).toBe(3);
    expect(emoteIndex("nope")).toBe(-1);
  });

  it("names the sound and reaction slots", () => {
    expect(pokeSound(0)).toBe("poke1");
    expect(pokeSound(6)).toBe("poke7");
    expect(emoteSound(5)).toBe("emote6");
    expect(VOICE_SLOT_IDS).toHaveLength(16);
    expect(REACTION_IDS).toHaveLength(18);
    expect(new Set(REACTION_IDS).size).toBe(18);
    expect(REACTION_IDS).toEqual(expect.arrayContaining([...VOICE_SLOT_IDS, "sulk", "carry"]));
  });

  it("describes every voice slot, and nothing else", () => {
    expect(Object.keys(VOICE_SLOTS).sort()).toEqual([...VOICE_SLOT_IDS].sort());
    for (const s of Object.values(VOICE_SLOTS)) {
      expect(s.emotion.length).toBeGreaterThan(0);
      expect(s.seconds).toBeGreaterThan(0);
      expect(s.influence).toBeGreaterThan(0);
    }
  });
});

describe("companion kits", () => {
  it("has exactly one kit per companion, in roster order", () => {
    expect(Object.keys(kitJson.companions)).toEqual(COMPANION_IDS);
    expect(COMPANION_KITS.map((k) => k.id)).toEqual(COMPANION_IDS);
    expect(companionKit("nope")).toBeUndefined();
    expect(companionKit(undefined)).toBeUndefined();
  });

  it("links each kit to the companion's planned moves", () => {
    for (const c of COMPANIONS) expect(companionKit(c.id)!.moves).toEqual(c.moves);
  });

  for (const k of COMPANION_KITS) {
    describe(k.id, () => {
      const all = [...k.lines.poke, k.lines.pickup, k.lines.drop, ...k.lines.emote];

      it("has a voice signature in the plush-toy template (never shrill)", () => {
        expect(k.voice.length).toBeGreaterThan(40);
        expect(k.voice).toMatch(/plush-toy cartoon/);
        expect(k.voice).toMatch(/never shrill/);
      });

      it("has every line, filled in", () => {
        expect(k.lines.poke).toHaveLength(POKE_STEPS);
        expect(k.lines.emote).toHaveLength(EMOTE_COUNT);
        expect(all).toHaveLength(15);
        for (const l of all) expect(l.trim().length, l).toBeGreaterThan(0);
      });

      it("keeps bubble text short", () => {
        for (const l of [...k.lines.poke, k.lines.pickup, k.lines.drop]) expect(l.length, l).toBeLessThanOrEqual(MAX_LINE_CHARS);
        for (const l of k.lines.emote) expect(l.length, l).toBeLessThanOrEqual(MAX_EMOTE_CHARS);
      });

      it("never repeats a line", () => {
        expect(new Set(all.map((l) => l.toLowerCase())).size).toBe(all.length);
      });

      it("uses plain text (rare *action*s only)", () => {
        for (const l of all) {
          expect(l, l).toBe(l.trim());
          expect(l, l).not.toMatch(/[<>\n\t]/);
          expect((l.match(/\*/g) ?? []).length % 2, l).toBe(0);
        }
        expect(all.filter((l) => l.includes("*")).length).toBeLessThanOrEqual(4);
      });
    });
  }

  it("has no line shared between two companions", () => {
    const seen = new Map<string, string>();
    for (const k of COMPANION_KITS)
      for (const l of [...k.lines.poke, k.lines.pickup, k.lines.drop, ...k.lines.emote]) {
        expect(seen.get(l.toLowerCase()), `"${l}" (${k.id}) also used by ${seen.get(l.toLowerCase())}`).toBeUndefined();
        seen.set(l.toLowerCase(), k.id);
      }
  });

  it("keeps the silly slot varied (not everyone asks the same kind of question)", () => {
    const silly = COMPANION_KITS.map((k) => k.lines.emote[EMOTE_IDS.indexOf("silly")]);
    expect(silly.filter((l) => l.endsWith("?")).length).toBeLessThanOrEqual(4);
  });

  it("looks lines up by slot, and rejects bad ones", () => {
    const hex = companionKit("hex")!;
    expect(pokeLine("hex", 0)).toBe(hex.lines.poke[0]);
    expect(pokeLine("hex", 6)).toBe(hex.lines.poke[6]);
    expect(pokeLine("hex", 7)).toBeUndefined();
    expect(pokeLine("nope", 0)).toBeUndefined();
    expect(emoteLine("hex", 5)).toBe(hex.lines.emote[5]);
    expect(emoteLine("hex", 6)).toBeUndefined();
    expect(emoteLine(undefined, 0)).toBeUndefined();
  });

  it("matches the voices already shipped for Hex", () => {
    const have = [...mp3s].filter((p) => p.startsWith("/public/sfx/companions/hex/")).map((p) => p.split("/").pop()!.replace(/(-\d)?\.mp3$/, ""));
    expect(new Set(have)).toEqual(new Set(VOICE_SLOT_IDS));
  });
});
