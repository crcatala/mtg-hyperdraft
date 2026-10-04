import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, formatTime, parsePrefs, stepIndex, TRACKS } from "../src/client/music";

const files = Object.keys(import.meta.glob("../public/music/*.m4a")).map((p) => p.split("/").pop()!);

describe("music playlist", () => {
  it("has a file on disk for every track, and no unlisted files", () => {
    expect(TRACKS.map((t) => t.file).sort()).toEqual(files.sort());
  });

  it("gives every track a unique id and title", () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(new Set(TRACKS.map((t) => t.title)).size).toBe(TRACKS.length);
  });

  it("steps through the playlist and wraps at both ends", () => {
    expect(stepIndex(0, 7, 1)).toBe(1);
    expect(stepIndex(6, 7, 1)).toBe(0);
    expect(stepIndex(0, 7, -1)).toBe(6);
    expect(stepIndex(3, 7, -1)).toBe(2);
  });
});

describe("saved music prefs", () => {
  it("uses the defaults when nothing (or junk) is saved", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("not json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("42")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{"on":"yes","volume":"loud","muted":"no","open":1}')).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid fields and clamps the volume", () => {
    expect(parsePrefs('{"on":false,"volume":0.7,"muted":true,"open":true}')).toEqual({ on: false, volume: 0.7, muted: true, open: true });
    expect(parsePrefs('{"volume":3}').volume).toBe(1);
    expect(parsePrefs('{"volume":-1}').volume).toBe(0);
    expect(parsePrefs('{"on":false}')).toEqual({ ...DEFAULT_PREFS, on: false });
  });
});

describe("formatTime", () => {
  it("reads minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(83.4)).toBe("1:23");
    expect(formatTime(600)).toBe("10:00");
  });
  it("treats unknown times as zero", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(-5)).toBe("0:00");
  });
});
