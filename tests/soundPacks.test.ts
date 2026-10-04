import { describe, expect, it } from "vitest";
import manifest from "../src/client/sfxManifest.json";
import { DEFAULT_PACK, FALLBACK_PACK, isPack, resolvePack, SOUND_PACKS } from "../src/client/soundPacks";
import { analyze, isAudible, MAX_GAIN, normalizeGain } from "../src/client/sfxMath";

// The files on disk, found by Vite's glob (lazy: nothing is loaded, only listed).
const mp3s = Object.keys(import.meta.glob("../public/sfx/*/*.mp3"));
const promptFiles = import.meta.glob<Record<string, string>>("../scripts/sfx/prompts/*.json", { eager: true, import: "default" });
const filesIn = (pack: string) => mp3s.filter((p) => p.startsWith(`../public/sfx/${pack}/`)).map((p) => p.split("/").pop()!);
const promptsFor = (pack: string) => promptFiles[`../scripts/sfx/prompts/${pack}.json`];

describe("choosing a sound pack", () => {
  it("takes the URL's pack first, then the saved one, then the default", () => {
    expect(resolvePack("arcane", "tabletop")).toBe("arcane");
    expect(resolvePack(null, "arcane")).toBe("arcane");
    expect(resolvePack("nonsense", "arcane")).toBe("arcane");
    expect(resolvePack(null, null)).toBe(DEFAULT_PACK);
    expect(resolvePack("garbage", "also garbage")).toBe(DEFAULT_PACK);
  });

  it("drops a saved choice of a pack that's gone (or the old match-theme) back to the default", () => {
    for (const old of ["foil", "signal", "theme"]) expect(resolvePack(null, old)).toBe(DEFAULT_PACK);
  });

  it("recognizes the packs only, and defaults to Tabletop", () => {
    for (const p of SOUND_PACKS) expect(isPack(p.id)).toBe(true);
    expect(isPack("theme")).toBe(false);
    expect(isPack("")).toBe(false);
    expect(DEFAULT_PACK).toBe("tabletop");
    expect(isPack(FALLBACK_PACK)).toBe(true);
  });
});

describe("sound pack files", () => {
  it("has a folder and a prompts file for each pack, and nothing else", () => {
    const ids = SOUND_PACKS.map((p) => p.id).sort();
    expect([...new Set(mp3s.map((p) => p.split("/")[3]))].sort()).toEqual(ids);
    expect(Object.keys(promptFiles).map((f) => f.split("/").pop()!.replace(/\.json$/, "")).sort()).toEqual(ids);
    expect(isPack(FALLBACK_PACK)).toBe(true);
  });

  it("makes every sound in the manifest, in every pack: a prompt and all its takes", () => {
    for (const { id } of SOUND_PACKS) {
      const prompts = promptsFor(id);
      expect(Object.keys(prompts).sort(), `${id} prompts`).toEqual(manifest.map((s) => s.name).sort());
      for (const s of manifest) {
        expect(prompts[s.name].length, `${id}/${s.name} prompt`).toBeGreaterThan(20);
        for (let i = 1; i <= s.count; i++) {
          const file = `${s.count > 1 ? `${s.name}-${i}` : s.name}.mp3`;
          expect(filesIn(id), `${id}/${file}`).toContain(file);
        }
      }
    }
  });

  it("only has files the manifest knows about (no stale takes left behind)", () => {
    const expected = new Set(manifest.flatMap((s) => Array.from({ length: s.count }, (_, i) => `${s.count > 1 ? `${s.name}-${i + 1}` : s.name}.mp3`)));
    for (const { id } of SOUND_PACKS) for (const f of filesIn(id)) expect(expected.has(f), `${id}/${f}`).toBe(true);
  });

  it("has the sounds the client plays in the carousel, picks list and card turn-over", () => {
    const names = manifest.map((s) => s.name);
    for (const n of ["zoom-open", "zoom-close", "row-hover", "turn-over"]) expect(names).toContain(n);
  });
});

describe("guarding against dud samples", () => {
  it("treats a near-silent take as a failed generation", () => {
    expect(isAudible(analyze(new Float32Array(100)))).toBe(false);
    expect(isAudible(analyze(new Float32Array(100).fill(0.005)))).toBe(false);
    expect(isAudible(analyze(new Float32Array(100).fill(0.3)))).toBe(true);
  });

  it("never boosts a quiet sample past the cap", () => {
    expect(normalizeGain({ start: 0, peak: 0.03, rms: 0.004 })).toBe(MAX_GAIN);
    expect(normalizeGain({ start: 0, peak: 0.2, rms: 0.06 })).toBeCloseTo(2);
  });
});
