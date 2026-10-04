import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../src/client/sfxManifest.json";
import { TEAR_MS } from "../src/client/revealSchedule";
import {
  autoTearMs,
  basePack,
  browseCards,
  chain,
  createStudioPlayer,
  makePick,
  mixSummary,
  openPack,
  playOne,
  readMix,
  STUDIO_SOUNDS,
  uniformMix,
  type Scheduler,
} from "../src/client/soundStudio";

/** Records the named cues instead of playing them (unnamed ones are the drag's speed updates). */
function recorder() {
  const cues: { ms: number; cue: string }[] = [];
  const s: Scheduler = { at: (ms, cue) => void (cue && cues.push({ ms, cue })) };
  const sorted = () => cues.slice().sort((a, b) => a.ms - b.ms);
  return { s, cues, sorted, names: () => sorted().map((c) => c.cue) };
}

describe("the studio's sound list", () => {
  it("lists every sound in the manifest exactly once", () => {
    expect(STUDIO_SOUNDS.slice().sort()).toEqual(manifest.map((s) => s.name).sort());
    expect(new Set(STUDIO_SOUNDS).size).toBe(STUDIO_SOUNDS.length);
  });

  it("can play each sound on its own", () => {
    for (const name of STUDIO_SOUNDS) {
      const r = recorder();
      playOne(r.s, name);
      expect(r.names(), name).toContain(name);
    }
  });
});

describe("the mix", () => {
  it("fills in missing sounds and drops packs that no longer exist", () => {
    const mix = readMix({ mythic: "arcane", rare: "foil", nonsense: "grove" }, "library");
    expect(mix.mythic).toBe("arcane");
    expect(mix.rare).toBe("library");
    expect(Object.keys(mix).sort()).toEqual(STUDIO_SOUNDS.slice().sort());
    expect(readMix(null, "grove")).toEqual(uniformMix("grove"));
  });

  it("summarises as the base pack plus swaps", () => {
    expect(mixSummary(uniformMix("grove"))).toBe("Base pack: Grove (grove)\nNo swaps: every sound comes from this pack.");
    const mix = { ...uniformMix("tabletop"), mythic: "arcane" as const, tick: "library" as const };
    expect(basePack(mix)).toBe("tabletop");
    const text = mixSummary(mix);
    expect(text).toMatch(/^Base pack: Tabletop \(tabletop\)\nSwaps:\n/);
    expect(text).toMatch(/mythic\s+→ Arcane \(arcane\)/);
    expect(text).toMatch(/tick\s+→ Library \(library\)/);
  });
});

describe("opening a pack", () => {
  it("auto-tears in about half a second, like the 3D pack", () => {
    expect(autoTearMs()).toBeGreaterThan(450);
    expect(autoTearMs()).toBeLessThan(600);
  });

  it("goes land → tear → burst → slide → deals → flips → the fanfare last", () => {
    const r = recorder();
    const length = openPack(r.s, "mythic", "drag");
    const names = r.names();
    const first = (n: string) => names.indexOf(n);
    expect(first("pack-land")).toBeLessThan(first("tear-scrub"));
    expect(first("tear-scrub")).toBeLessThan(first("pack-burst"));
    expect(first("pack-burst")).toBeLessThan(first("cards-slide"));
    expect(first("cards-slide")).toBeLessThan(first("deal"));
    expect(names.filter((n) => n === "deal")).toHaveLength(14);
    expect(names.filter((n) => n === "flip")).toHaveLength(14);
    expect(names.at(-1)).toBe("mythic");
    expect(names).not.toContain("tear");
    // Cards are dealt TEAR_MS after the burst, and the sequence outlasts its last cue.
    const at = (n: string) => r.sorted().find((c) => c.cue === n)!.ms;
    expect(at("deal") - at("pack-burst")).toBe(TEAR_MS);
    expect(length).toBeGreaterThan(r.sorted().at(-1)!.ms);
  });

  it("uses the one-shot rip for a click, and the rare fanfare for a rare", () => {
    const r = recorder();
    openPack(r.s, "rare", "click");
    expect(r.names()).toContain("tear");
    expect(r.names()).not.toContain("tear-scrub");
    expect(r.names().at(-1)).toBe("rare");
    expect(r.names()).not.toContain("mythic");
  });

  it("keeps a pack of all rares quiet: no chimes, no fanfare", () => {
    const r = recorder();
    openPack(r.s, "cube", "click");
    for (const n of ["uncommon", "rare", "mythic"]) expect(r.names()).not.toContain(n);
  });
});

describe("chaining sequences", () => {
  it("starts each part after the previous one ends", () => {
    const r = recorder();
    const total = chain(r.s, makePick, browseCards);
    const zoom = r.sorted().find((c) => c.cue === "zoom-open")!;
    expect(zoom.ms).toBe(makePick(recorder().s));
    expect(total).toBe(makePick(recorder().s) + browseCards(recorder().s));
  });
});

describe("the studio player", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A pack load that finishes only when the test says so. */
  function slowLoad() {
    const pending: (() => void)[] = [];
    const load = vi.fn(() => new Promise<void>((done) => pending.push(done)));
    return { load, finish: () => pending.splice(0).forEach((done) => done()) };
  }

  it("plays a sequence's cues once its packs have loaded, and Stop cuts the rest", async () => {
    const { load, finish } = slowLoad();
    const stopAudio = vi.fn();
    const player = createStudioPlayer({ load, stopAudio });
    const played: string[] = [];
    const started = player.start((s) => ["a", "b"].forEach((c, i) => s.at(i * 100, c, () => played.push(c))), ["grove", "grove", "tabletop"]);
    expect(load).toHaveBeenCalledWith(["grove", "tabletop"]);
    finish();
    expect(await started).toBe(true);
    vi.advanceTimersByTime(50);
    expect(played).toEqual(["a"]);
    player.stop();
    vi.advanceTimersByTime(500);
    expect(played).toEqual(["a"]);
    expect(stopAudio).toHaveBeenCalled();
  });

  it("plays nothing if stopped while the packs are still loading", async () => {
    const { load, finish } = slowLoad();
    const player = createStudioPlayer({ load, stopAudio: () => {} });
    const build = vi.fn();
    const onStart = vi.fn();
    const started = player.start(build, ["library"], onStart);
    player.stop();
    finish();
    expect(await started).toBe(false);
    vi.runAllTimers();
    expect(build).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("drops a start that's still loading when a newer one begins", async () => {
    const { load, finish } = slowLoad();
    const player = createStudioPlayer({ load, stopAudio: () => {} });
    const first = vi.fn();
    const second = vi.fn();
    const a = player.start(first, ["arcane"]);
    const b = player.start(second, ["grove"]);
    finish();
    expect(await a).toBe(false);
    expect(await b).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
