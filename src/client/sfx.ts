// Sound effects. The real sounds are generated samples in public/sfx/<pack>/ (scripts/build-sfx.mjs,
// made with ElevenLabs); which pack plays is the player's choice (soundPacks.ts). Samples are decoded
// once per pack, trimmed of leading silence and loudness-matched, then played through one compressed
// bus so a flurry of flips can't clip. Until a sample has loaded (or if it never does) each effect
// falls back to another pack's sample or a small WebAudio synth, so the UI is never silent.
// Muted state persists per browser.
//
// The audio graph is: effects → sfxBus → compressor → master → speakers. Background music, when it
// comes, joins at `master` with its own gain, so it never passes through the effects compressor and
// can have its own volume and mute.

import manifest from "./sfxManifest.json";
import { analyze, isAudible, jitter, normalizeGain, pickTake } from "./sfxMath";
import { activePack, FALLBACK_PACK, type PackId } from "./soundPacks";

let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem("hyperdraft:muted") === "1";
  } catch {
    return false;
  }
})();

/** Sample name → how many takes there are (files are <name>.mp3 or <name>-1.mp3 … <name>-N.mp3). */
const FILES: Record<string, number> = Object.fromEntries(manifest.map((s) => [s.name, s.count]));
/** Loops are used whole: trimming their head would move the seam. */
const LOOPS = new Set(manifest.filter((s) => "loop" in s && s.loop).map((s) => s.name));

interface Take {
  buffer: AudioBuffer;
  /** Seconds of room tone to skip so the sound starts on its first audible sample. */
  offset: number;
  /** Brings every take to a similar loudness; each effect then scales it to sit in the mix. */
  norm: number;
}

/** Decoded takes: pack → sound name → takes. */
const bank = new Map<PackId, Map<string, Take[]>>();
const lastTake = new Map<string, number>();
const loading = new Map<PackId, Promise<void>>();

// --- Sound Studio hooks (/dev/sound-studio): play any sound from any pack, and watch what plays ---

/** Picks the pack per sound instead of the player's choice; undefined means "use the player's". */
let packOverride: ((name: string) => PackId | undefined) | null = null;
export function setPackOverride(fn: ((name: string) => PackId | undefined) | null) {
  packOverride = fn;
}

/** A sample started (`pack` is the one it came from, after any fallback), or had nothing to play. */
export type SfxEvent = { name: string; pack: PackId | null };
const sfxListeners = new Set<(e: SfxEvent) => void>();
export function onSfx(listener: (e: SfxEvent) => void): () => void {
  sfxListeners.add(listener);
  return () => sfxListeners.delete(listener);
}
const emit = (e: SfxEvent) => sfxListeners.forEach((l) => l(e));

/** Every sample still sounding, so stopAll() can cut them. */
const live = new Set<AudioBufferSourceNode>();
function track(src: AudioBufferSourceNode) {
  live.add(src);
  src.addEventListener("ended", () => live.delete(src));
}
export function stopAll() {
  tearVoice?.end(false);
  for (const src of live) {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }
  live.clear();
}

function takesOf(name: string): { takes: Take[]; pack: PackId } | undefined {
  const pack = packOverride?.(name) ?? activePack();
  const own = bank.get(pack)?.get(name);
  if (own?.length) return { takes: own, pack };
  // Not (yet) available in the chosen pack: start loading it, and cover with the fallback pack.
  void loadPack(pack);
  const fallback = bank.get(FALLBACK_PACK)?.get(name);
  return fallback?.length ? { takes: fallback, pack: FALLBACK_PACK } : undefined;
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      const sfxBus = ctx.createGain();
      sfxBus.connect(comp).connect(master);
      bus = sfxBus;
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  void loadPack(FALLBACK_PACK);
  void loadPack(activePack());
  return ctx;
}

/** Fetches and decodes every sample of a pack (once). Failures just leave those effects on their fallback. */
export function loadPack(pack: PackId): Promise<void> {
  const cached = loading.get(pack);
  if (cached) return cached;
  const a = ctx;
  if (!a) return Promise.resolve();
  const base = import.meta.env.BASE_URL ?? "/";
  const mine = new Map<string, Take[]>();
  bank.set(pack, mine);
  const done = Promise.all(
    Object.entries(FILES).flatMap(([name, count]) =>
      Array.from({ length: count }, async (_, i) => {
        const file = count > 1 ? `${name}-${i + 1}.mp3` : `${name}.mp3`;
        try {
          const res = await fetch(`${base}sfx/${pack}/${file}`);
          if (!res.ok) return;
          const buffer = await a.decodeAudioData(await res.arrayBuffer());
          const info = analyze(buffer.getChannelData(0));
          if (!isAudible(info)) return; // a failed generation: better to fall back than to hiss
          const take: Take = { buffer, offset: LOOPS.has(name) ? 0 : info.start / buffer.sampleRate, norm: normalizeGain(info) };
          mine.set(name, [...(mine.get(name) ?? []), take]);
        } catch {
          /* missing or undecodable: that effect stays on its fallback */
        }
      }),
    ),
  ).then(() => undefined);
  loading.set(pack, done);
  return done;
}

/**
 * Browsers only start audio after a click or key press, and the samples take a moment to fetch and
 * decode, so the first interaction anywhere in the app sets all that going. By the time a pack
 * lands on the draft table the sounds are ready.
 */
export function installSfxWarmUp() {
  const go = () => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    audio();
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  if (m) tearVoice?.end(false);
  try {
    localStorage.setItem("hyperdraft:muted", m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

interface PlayOptions {
  gain?: number;
  rate?: number;
  /** Seconds from now. */
  when?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
}

/**
 * Plays a sample. Returns false only when it isn't available yet (so the caller can use its synth);
 * muted counts as played.
 */
function play(name: string, { gain = 1, rate = 1, when = 0, pan = 0 }: PlayOptions = {}): boolean {
  const a = audio();
  if (!a) return true;
  const found = takesOf(name);
  if (!found || !bus) {
    emit({ name, pack: null });
    return false;
  }
  const { takes, pack } = found;
  const key = `${pack}/${name}`;
  const i = pickTake(takes.length, lastTake.get(key) ?? -1);
  lastTake.set(key, i);
  const take = takes[i];
  const src = a.createBufferSource();
  src.buffer = take.buffer;
  src.playbackRate.value = rate;
  const g = a.createGain();
  g.gain.value = gain * take.norm;
  let out: AudioNode = src.connect(g);
  if (pan) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out = out.connect(p);
  }
  out.connect(bus);
  src.start(a.currentTime + when, take.offset);
  track(src);
  emit({ name, pack });
  return true;
}

// --- synth fallbacks ---------------------------------------------------------------------------

function noise(a: AudioContext, duration: number, from: number, to: number, gain: number, when = 0) {
  const len = Math.floor(a.sampleRate * duration);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.5;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.9;
  const t = a.currentTime + when;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(bus ?? a.destination);
  src.start(t);
}

function tone(a: AudioContext, freq: number, when: number, duration: number, gain: number, type: OscillatorType = "sine") {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = a.createGain();
  const t = a.currentTime + when;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(bus ?? a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

const synth = {
  rip(a: AudioContext) {
    noise(a, 0.45, 5200, 900, 0.5);
    noise(a, 0.2, 2500, 6000, 0.25, 0.08);
  },
  deal(a: AudioContext) {
    noise(a, 0.06, 3000, 1500, 0.18);
  },
  flip(a: AudioContext, step: number) {
    const lift = Math.min(step, 14) * 110;
    noise(a, 0.07, 1800 + lift, 4200 + lift, 0.14);
  },
  rare(a: AudioContext) {
    [659, 880, 1319].forEach((f, i) => tone(a, f, i * 0.07, 0.6, 0.12, "triangle"));
  },
  mythic(a: AudioContext) {
    [523, 659, 784, 1047, 1568].forEach((f, i) => tone(a, f, i * 0.06, 0.9, 0.11, "triangle"));
    tone(a, 130, 0, 0.8, 0.2, "sine");
  },
  select(a: AudioContext) {
    tone(a, 1200, 0, 0.08, 0.06, "sine");
  },
  pick(a: AudioContext) {
    noise(a, 0.25, 800, 4000, 0.3);
    tone(a, 988, 0.05, 0.25, 0.07, "triangle");
  },
  tick(a: AudioContext) {
    tone(a, 1800, 0, 0.04, 0.05, "square");
  },
  tap(a: AudioContext) {
    noise(a, 0.07, 1200, 600, 0.2);
  },
};

/** Plays the sample, or this synth sound when the sample isn't ready. */
function sample(name: string, options: PlayOptions, fallback?: (a: AudioContext) => void) {
  if (play(name, options)) return;
  const a = audio();
  if (a && fallback) fallback(a);
}

// --- tearing a pack ----------------------------------------------------------------------------

/** The looping rip that follows the player's drag across a pack. */
export interface TearVoice {
  /** `speed` is how fast the tear front is moving, roughly 0 (still) … 1 (fast); pitch and volume follow it. */
  update(speed: number): void;
  /** Fades the rip out. */
  end(completed: boolean): void;
}

let tearVoice: TearVoice | null = null;
let lastRowHover = 0;

function startTear(): TearVoice {
  tearVoice?.end(false);
  const a = audio();
  const found = takesOf("tear-scrub");
  const take = found?.takes[0];
  if (!a || !take || !bus) {
    if (a) emit({ name: "tear-scrub", pack: null });
    return (tearVoice = { update() {}, end() {} });
  }
  emit({ name: "tear-scrub", pack: found.pack });
  const src = a.createBufferSource();
  src.buffer = take.buffer;
  src.loop = true;
  // Stay off the very ends of the file so the seam never clicks.
  src.loopStart = 0.04;
  src.loopEnd = Math.max(0.2, take.buffer.duration - 0.04);
  src.playbackRate.value = 0.9;
  const g = a.createGain();
  g.gain.value = 0;
  src.connect(g).connect(bus);
  src.start(a.currentTime, Math.random() * Math.max(0, take.buffer.duration - 0.3));
  track(src);
  let done = false;
  const voice: TearVoice = {
    update(speed) {
      if (done) return;
      const s = Math.max(0, Math.min(1.2, speed));
      const t = a.currentTime;
      g.gain.setTargetAtTime(Math.min(1, s * 1.4) * 0.85 * take.norm, t, 0.035);
      src.playbackRate.setTargetAtTime(0.85 + s * 0.4, t, 0.05);
    },
    end() {
      if (done) return;
      done = true;
      const t = a.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.03);
      src.stop(t + 0.25);
      if (tearVoice === voice) tearVoice = null;
    },
  };
  return (tearVoice = voice);
}

export const sfx = {
  /** The pack dropping into place. */
  packLand() {
    sample("pack-land", { gain: 0.9 });
  },
  /** The pointer passing over the pack: a small foil crinkle. */
  packHover() {
    sample("pack-hover", { gain: 0.5, rate: jitter(1, 0.06) });
  },
  /** Starts the rip that follows a drag; drive it with `update(speed)` and finish it with `end()`. */
  tearStart: startTear,
  /** A click or Space tears the pack by itself: one full rip. */
  tearAuto() {
    sample("tear", { gain: 1, rate: jitter(1, 0.04) }, synth.rip);
  },
  /** The tear completes: the top comes away and the light bursts out. */
  packBurst() {
    sample("pack-burst", { gain: 0.85 });
  },
  /** The stack of cards sliding up out of the opened pack. */
  cardsSlide() {
    sample("cards-slide", { gain: 0.7 });
  },
  /** The simple CSS pack's tear (no 3D): the rip, then the burst as it opens. */
  rip() {
    sample("tear", { gain: 1, rate: jitter(1, 0.04) }, synth.rip);
    play("pack-burst", { gain: 0.6, when: 0.25 });
  },
  deal() {
    sample("deal", { gain: 0.5, rate: jitter(1, 0.08), pan: (Math.random() - 0.5) * 0.5 }, synth.deal);
  },
  /** A card turning face up; `step` nudges the pitch up so a wave of flips rises. */
  flip(step = 0) {
    sample("flip", { gain: 0.6, rate: jitter(1 + Math.min(step, 14) * 0.016, 0.03), pan: (Math.random() - 0.5) * 0.4 }, (a) => synth.flip(a, step));
  },
  /** A chime under a flip for a card that's rarer than the rest of its pack. */
  notable() {
    play("uncommon", { gain: 0.5, rate: jitter(1, 0.05) });
  },
  rare() {
    sample("rare", { gain: 0.9 }, synth.rare);
  },
  mythic() {
    sample("mythic", { gain: 1 }, synth.mythic);
  },
  select() {
    sample("select", { gain: 0.6, rate: jitter(1, 0.04) }, synth.select);
  },
  deselect() {
    sample("deselect", { gain: 0.55 }, synth.select);
  },
  pick() {
    sample("pick", { gain: 0.85 }, synth.pick);
  },
  /** A burned card going up in flames. */
  burn() {
    sample("burn", { gain: 0.7 }, synth.pick);
  },
  /** A pack slid in from the neighbour. */
  packArrive() {
    sample("pack-arrive", { gain: 0.7 });
  },
  /** Your pack sent on to the next seat. */
  packPass() {
    sample("pack-pass", { gain: 0.6 });
  },
  tick() {
    sample("tick", { gain: 0.9 }, synth.tick);
  },
  /** A card zooming up into the carousel. */
  zoomOpen() {
    sample("zoom-open", { gain: 0.6 });
  },
  /** ...and going back down. */
  zoomClose() {
    sample("zoom-close", { gain: 0.5 });
  },
  /** The pointer moving over a row of the picks list: barely there, and never a machine gun. */
  rowHover() {
    const now = performance.now();
    if (now - lastRowHover < 70) return;
    lastRowHover = now;
    sample("row-hover", { gain: 0.3, rate: jitter(1, 0.06) });
  },
  /** A double-faced card turned over to its other face. */
  turnOver() {
    sample("turn-over", { gain: 0.7, rate: jitter(1, 0.04) }, (a) => synth.flip(a, 6));
  },
  /** A short taste of the current pack: two flips, a chime and a rare sting. */
  preview() {
    sfx.flip(0);
    play("flip", { gain: 0.6, rate: 1.06, when: 0.13 });
    play("uncommon", { gain: 0.5, when: 0.26 });
    play("rare", { gain: 0.9, when: 0.5 });
  },
  tap() {
    sample("tap", { gain: 0.7, rate: jitter(1, 0.05) }, synth.tap);
  },
  /** Table ping: a soft two-note bell. Each seat gets its own pitch so you can tell who pinged. */
  ping(seat = 0) {
    const a = audio();
    if (!a) return;
    const root = 880 * [1, 9 / 8, 5 / 4, 3 / 2][seat % 4];
    [root, root * 1.5].forEach((f, i) => {
      tone(a, f, i * 0.11, 1.1, 0.09, "sine");
      // A quiet inharmonic partial gives it a bell-like shimmer.
      tone(a, f * 2.76, i * 0.11, 0.35, 0.018, "sine");
    });
  },
};
