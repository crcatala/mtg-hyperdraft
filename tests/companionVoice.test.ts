import { describe, expect, it, vi } from "vitest";
import manifest from "../src/client/companionVoices.json";
import { hasVoice, takeCount, voiceFile } from "../src/client/companionVoice";
import { createHelloGate } from "../src/client/helloGate";
import { pickTake, variantPitch } from "../src/client/sfxMath";
import { COMPANION_IDS } from "../src/shared/roster";
import { VOICE_SLOT_IDS, voiceSlotLabel, voiceSlotLine } from "../src/shared/companionKit";

const semitones = (rate: number) => 12 * Math.log2(rate);

describe("variantPitch", () => {
  it("leaves the original colours untouched", () => {
    expect(variantPitch(0)).toBe(1);
    expect(variantPitch(-1)).toBe(1);
  });

  it("is deterministic and within about three semitones either way", () => {
    for (let v = 1; v <= 40; v++) {
      expect(variantPitch(v)).toBe(variantPitch(v));
      expect(Math.abs(semitones(variantPitch(v)))).toBeLessThanOrEqual(3.0001);
    }
  });

  it("keeps every variant clear of the original and of the per-play jitter", () => {
    for (let v = 1; v <= 40; v++) expect(Math.abs(variantPitch(v) - 1)).toBeGreaterThan(0.04);
  });

  it("spreads the first few variants apart, on both sides of the original", () => {
    const st = [1, 2, 3, 4, 5, 6].map((v) => semitones(variantPitch(v)));
    expect(st.some((x) => x > 0)).toBe(true);
    expect(st.some((x) => x < 0)).toBe(true);
    const all = [0, ...st].sort((a, b) => a - b);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThan(0.3);
  });
});

describe("take selection", () => {
  it("never repeats the take that just played, and reaches the others", () => {
    for (const count of [2, 3]) {
      const seen = new Set<number>();
      for (let last = 0; last < count; last++) {
        for (const r of [0, 0.34, 0.67, 0.999]) {
          const i = pickTake(count, last, () => r);
          expect(i).not.toBe(last);
          expect(i).toBeLessThan(count);
          seen.add(i);
        }
      }
      expect(seen.size).toBe(count);
    }
  });

  it("plays the only take of a one-take slot every time", () => {
    expect(pickTake(1, 0)).toBe(0);
  });

  it("names files like the sound packs: <slot>.mp3, or <slot>-N.mp3 for several takes", () => {
    expect(voiceFile("poke3", 1, 0)).toBe("poke3.mp3");
    expect(voiceFile("hello", 2, 0)).toBe("hello-1.mp3");
    expect(voiceFile("hello", 2, 1)).toBe("hello-2.mp3");
  });
});

// Keys only: the voice files that exist on disk, as { companion: [file names] }.
const onDisk: Record<string, string[]> = {};
for (const path of Object.keys(import.meta.glob("/public/sfx/companions/*/*.mp3"))) {
  const [, , , , id, file] = path.split("/");
  (onDisk[id] ??= []).push(file);
}
for (const files of Object.values(onDisk)) files.sort();

describe("the shipped voice files", () => {
  const companions = Object.keys(onDisk).sort();

  it("only exist for real companions", () => {
    for (const id of companions) expect(COMPANION_IDS, id).toContain(id);
  });

  it("are complete for every companion that has a directory (absent ones are allowed until their voices are made)", () => {
    for (const id of companions) {
      for (const slot of VOICE_SLOT_IDS) {
        const files = onDisk[id].filter((f) => f === `${slot}.mp3` || new RegExp(`^${slot}-\\d+\\.mp3$`).test(f));
        expect(files.length, `${id}/${slot} has no file`).toBeGreaterThan(0);
        // One take is <slot>.mp3 and several are <slot>-1..N: never a mix, never a gap.
        const expected = files.length === 1 && files[0] === `${slot}.mp3` ? [`${slot}.mp3`] : files.map((_, i) => `${slot}-${i + 1}.mp3`);
        expect(files, `${id}/${slot} naming`).toEqual(expected);
      }
    }
  });

  it("match the list the client loads from (run node scripts/sync-companion-voices.mjs after changing them)", () => {
    const actual: Record<string, Record<string, number>> = {};
    for (const id of companions.sort()) {
      actual[id] = {};
      for (const f of onDisk[id]) {
        const slot = f.replace(/\.mp3$/, "").replace(/-\d+$/, "");
        actual[id][slot] = (actual[id][slot] ?? 0) + 1;
      }
    }
    expect(manifest).toEqual(actual);
  });

  it("are reported by the helpers", () => {
    expect(hasVoice("hex")).toBe(true);
    expect(hasVoice("not-a-companion")).toBe(false);
    expect(hasVoice(undefined)).toBe(false);
    expect(takeCount("hex", "hello")).toBe(2);
    expect(takeCount("hex", "poke3")).toBe(1);
    expect(takeCount("not-a-companion", "hello")).toBe(0);
  });
});

describe("voice slot text", () => {
  it("labels every slot and has a line for all but hello", () => {
    for (const slot of VOICE_SLOT_IDS) {
      expect(voiceSlotLabel(slot)).not.toBe(slot);
      const line = voiceSlotLine("hex", slot);
      if (slot === "hello") expect(line).toBeUndefined();
      else expect(line, slot).toBeTruthy();
    }
    expect(voiceSlotLabel("poke1")).toBe("Poke 1 · curious");
    expect(voiceSlotLabel("emote6")).toBe("Emote · Taunt");
    expect(voiceSlotLine("nobody", "poke1")).toBeUndefined();
  });
});

describe("the lobby hello gate", () => {
  const setup = (opts = {}) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const said: string[] = [];
    const gate = createHelloGate({ say: (id) => said.push(id), ...opts });
    return { gate, said };
  };

  it("speaks only after the pointer rests on a tile, so sweeping across stays quiet", () => {
    const { gate, said } = setup();
    for (const id of ["a", "b", "c", "d"]) {
      gate.rest(id);
      vi.advanceTimersByTime(100);
    }
    gate.rest(null);
    vi.advanceTimersByTime(1000);
    expect(said).toEqual([]);
    gate.rest("e");
    vi.advanceTimersByTime(300);
    expect(said).toEqual(["e"]);
    vi.useRealTimers();
  });

  it("says hello at once on a click, and drops the pending hover hello", () => {
    const { gate, said } = setup();
    gate.rest("a");
    gate.pick("a");
    vi.advanceTimersByTime(1000);
    expect(said).toEqual(["a"]);
    vi.useRealTimers();
  });

  it("does not greet the same companion twice in a row (hover then click), but may again later", () => {
    const { gate, said } = setup();
    gate.rest("a");
    vi.advanceTimersByTime(300);
    gate.pick("a");
    expect(said).toEqual(["a"]);
    vi.advanceTimersByTime(2000);
    gate.pick("a");
    gate.pick("b");
    expect(said).toEqual(["a", "a", "b"]);
    vi.useRealTimers();
  });

  it("cancel() drops a pending hello", () => {
    const { gate, said } = setup();
    gate.rest("a");
    gate.cancel();
    vi.advanceTimersByTime(1000);
    expect(said).toEqual([]);
    vi.useRealTimers();
  });
});
