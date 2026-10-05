import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUMES, parseVolumes } from "../src/client/volume";
import { DEFAULT_PREFS } from "../src/client/music";

describe("saved volumes", () => {
  it("uses the defaults when nothing (or junk) is saved", () => {
    expect(parseVolumes(null)).toEqual(DEFAULT_VOLUMES);
    expect(parseVolumes("nope")).toEqual(DEFAULT_VOLUMES);
    expect(parseVolumes('{"master":"loud","sfx":null}')).toEqual(DEFAULT_VOLUMES);
  });

  it("keeps valid values and clamps the rest into 0–1", () => {
    expect(parseVolumes('{"master":0.3,"sfx":0.6}')).toEqual({ master: 0.3, sfx: 0.6 });
    expect(parseVolumes('{"master":7,"sfx":-2}')).toEqual({ master: 1, sfx: 0 });
    expect(parseVolumes('{"master":0.2}')).toEqual({ master: 0.2, sfx: DEFAULT_VOLUMES.sfx });
  });

  it("starts below full volume, with the music sitting under the effects", () => {
    expect(DEFAULT_VOLUMES.master).toBeLessThan(1);
    expect(DEFAULT_PREFS.volume).toBeLessThan(DEFAULT_VOLUMES.sfx);
  });
});
