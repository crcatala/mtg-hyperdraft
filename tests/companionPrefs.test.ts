import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANION_PREFS_KEY, companionSounds, companionSpeech, DEFAULT_COMPANION_PREFS, initCompanionPrefs, parseCompanionPrefs, setCompanionSounds, setCompanionSpeech,
} from "../src/client/companionPrefs";
import { say, useBubbles, voice } from "../src/client/table/companionTalk";

// What the table would play: a stand-in, so "did a voice start?" is just "was it called?".
const playVoice = vi.hoisted(() => vi.fn(() => ({ stop() {}, seconds: 1 })));
vi.mock("../src/client/companionVoice", async (importOriginal) => ({ ...(await importOriginal<typeof import("../src/client/companionVoice")>()), playVoice }));

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) });
  initCompanionPrefs();
  playVoice.mockClear();
});
afterEach(() => {
  setCompanionSounds(true);
  setCompanionSpeech(true);
  useBubbles.setState({ bubbles: {} });
  vi.unstubAllGlobals();
});

describe("companion prefs", () => {
  it("are on unless saved off; junk falls back to on", () => {
    expect(DEFAULT_COMPANION_PREFS).toEqual({ sounds: true, speech: true });
    expect(parseCompanionPrefs(null)).toEqual(DEFAULT_COMPANION_PREFS);
    expect(parseCompanionPrefs("{oops")).toEqual(DEFAULT_COMPANION_PREFS);
    expect(parseCompanionPrefs('{"sounds":"no","speech":0}')).toEqual(DEFAULT_COMPANION_PREFS);
    expect(parseCompanionPrefs('{"sounds":false}')).toEqual({ sounds: false, speech: true });
    expect(parseCompanionPrefs('{"sounds":true,"speech":false}')).toEqual({ sounds: true, speech: false });
  });

  it("are remembered per browser and read back at startup", () => {
    setCompanionSounds(false);
    expect(JSON.parse(storage.get(COMPANION_PREFS_KEY)!)).toEqual({ sounds: false, speech: true });
    setCompanionSpeech(false);
    setCompanionSounds(true);
    initCompanionPrefs();
    expect(companionSounds()).toBe(true);
    expect(companionSpeech()).toBe(false);
  });

  it("still apply when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    initCompanionPrefs();
    expect(companionSpeech()).toBe(true);
    setCompanionSpeech(false);
    expect(companionSpeech()).toBe(false);
  });
});

describe("sounds off", () => {
  it("silences every table voice, at once", () => {
    expect(voice("hex", "poke1")).not.toBeNull();
    expect(playVoice).toHaveBeenCalledTimes(1);
    setCompanionSounds(false);
    expect(voice("hex", "poke2")).toBeNull();
    expect(voice("hex", "emote1")).toBeNull();
    expect(playVoice).toHaveBeenCalledTimes(1);
  });

  it("leaves the bubbles alone", () => {
    setCompanionSounds(false);
    say("p1", "Mrrp?");
    expect(useBubbles.getState().bubbles.p1?.text).toBe("Mrrp?");
  });
});

describe("speech off", () => {
  it("puts up no new bubbles, small or large, and leaves the voices alone", () => {
    setCompanionSpeech(false);
    say("p1", "Mrrp?");
    say("p2", "Ten lives. You have one.", "large");
    expect(useBubbles.getState().bubbles).toEqual({});
    expect(voice("hex", "poke1")).not.toBeNull();
    setCompanionSpeech(true);
    say("p1", "Mrrp?");
    expect(useBubbles.getState().bubbles.p1?.text).toBe("Mrrp?");
  });
});
