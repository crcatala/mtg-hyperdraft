import { beforeAll, describe, expect, it, vi } from "vitest";
import type * as CompanionVoice from "../src/client/companionVoice";
import type * as Sfx from "../src/client/sfx";

// A just-enough Web Audio: records which decoded file each started source plays. Files are told apart by the
// single byte the fake fetch hands back, which the fake decoder keeps as `tag`.
const started: { tag: number; rate: number }[] = [];
let contexts = 0;
const node = () => {
  const n: Record<string, unknown> = { gain: { value: 1 }, pan: { value: 0 }, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} };
  n.connect = (to: unknown) => to ?? n;
  return n;
};
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = node();
  sampleRate = 44100;
  constructor() {
    contexts++;
  }
  resume() {
    return Promise.resolve();
  }
  createGain = node;
  createDynamicsCompressor = node;
  createStereoPanner = node;
  createBufferSource() {
    const src: Record<string, unknown> = { playbackRate: { value: 1 }, buffer: null, addEventListener() {}, stop() {} };
    src.connect = (to: unknown) => to;
    src.start = () => started.push({ tag: (src.buffer as { tag: number }).tag, rate: (src.playbackRate as { value: number }).value });
    return src;
  }
  async decodeAudioData(data: ArrayBuffer) {
    const tag = new Uint8Array(data)[0];
    const samples = new Float32Array(2000).fill(0.5);
    return { tag, duration: 1, sampleRate: 44100, getChannelData: () => samples };
  }
}

/** hello-1 arrives long after hello-2, poke1-1 is a silent (failed) generation. */
const DELAY: Record<string, number> = { "hello-1.mp3": 40, "hello-2.mp3": 0 };
const TAG: Record<string, number> = { "hello-1.mp3": 1, "hello-2.mp3": 2, "poke1-1.mp3": 3, "poke1-2.mp3": 4 };

let sfx: typeof Sfx;
let voice: typeof CompanionVoice;

beforeAll(async () => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("window", { addEventListener() {} });
  vi.stubGlobal("fetch", async (url: string) => {
    const file = url.split("/").pop()!;
    await new Promise((r) => setTimeout(r, DELAY[file] ?? 0));
    return { ok: true, arrayBuffer: async () => new Uint8Array([TAG[file] ?? 9]).buffer };
  });
  sfx = await import("../src/client/sfx");
  voice = await import("../src/client/companionVoice");
});

describe("audio that starts muted", () => {
  it("is unlocked by unmuting, so voices that were waiting load and play", async () => {
    sfx.setMuted(true);
    expect(sfx.audioIfUnlocked()).toBeNull();
    // What a muted page looks like: the first interaction came and went with nothing started.
    const loaded = voice.loadVoice("hex");
    expect(contexts).toBe(0);
    sfx.setMuted(false);
    expect(contexts).toBe(1);
    await loaded;
    expect(voice.playVoice("hex", "hello")).not.toBeNull();
  });
});

describe("take identity", () => {
  it("keeps take N as file N however the downloads finish", () => {
    started.length = 0;
    // hello-1 finished last, but is still take 0.
    expect(voice.playVoice("hex", "hello", { take: 0 })).not.toBeNull();
    expect(voice.playVoice("hex", "hello", { take: 1 })).not.toBeNull();
    expect(started.map((s) => s.tag)).toEqual([1, 2]);
  });

  it("plays nothing, rather than another file, for a take that isn't there", () => {
    started.length = 0;
    expect(voice.playVoice("hex", "hello", { take: 2 })).toBeNull();
    expect(voice.playVoice("hex", "nosuchslot", { take: 0 })).toBeNull();
    expect(started).toEqual([]);
  });
});

describe("chooseTake", () => {
  const t = (n: number) => ({ tag: n }) as never;
  it("picks among the loaded files only and never repeats the last", () => {
    const takes = [t(1), null, t(3)];
    for (const r of [0, 0.4, 0.99]) {
      expect(voice.chooseTake(takes, 0, undefined, () => r)).toBe(2);
      expect(voice.chooseTake(takes, 2, undefined, () => r)).toBe(0);
    }
    expect([0, 2]).toContain(voice.chooseTake(takes, -1));
  });
  it("honours a wanted file index only if it loaded", () => {
    expect(voice.chooseTake([null, t(2)], -1, 1)).toBe(1);
    expect(voice.chooseTake([null, t(2)], -1, 0)).toBe(-1);
  });
  it("is -1 when nothing loaded", () => {
    expect(voice.chooseTake([null, null], -1)).toBe(-1);
    expect(voice.chooseTake(undefined, -1)).toBe(-1);
  });
});
