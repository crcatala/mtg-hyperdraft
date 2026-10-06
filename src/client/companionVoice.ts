// Companion voices: the non-verbal whimpers and chirps each companion makes (hello in the lobby, pokes,
// pick-up and drop, the emote wheel). They are deliberately NOT part of the sound packs: a companion
// sounds the same whichever pack the player chose, they load lazily per companion from
// public/sfx/companions/<id>/<slot>.mp3 (or <slot>-1 ... -N when a slot has several takes), and they
// play through the same effects bus as everything else (sfx.ts), so master/effects volume and mute apply.
//
// Which files exist is listed in companionVoices.json (scripts/sync-companion-voices.mjs) rather than
// probed for, so a companion with no audio yet costs no requests. A slot that has no sound is a silent no-op
// that still emits an event, like play() does for a sample that hasn't loaded.

import manifest from "./companionVoices.json";
import { companionSounds } from "./companionPrefs";
import { audioIfUnlocked, decodeTake, emit, startTake, whenAudioReady, type Take } from "./sfx";
import { jitter, pickTake, variantPitch } from "./sfxMath";

const FILES = manifest as Record<string, Record<string, number>>;

/** The file name of take `i` (0-based) of a slot that has `count` takes. */
export const voiceFile = (slot: string, count: number, i: number): string => (count > 1 ? `${slot}-${i + 1}.mp3` : `${slot}.mp3`);

/** How many takes a companion has of a slot (0 when it has none, or no voice at all yet). */
export const takeCount = (id: string, slot: string): number => FILES[id]?.[slot] ?? 0;

/** Whether the companion has any voice files shipped yet. */
export const hasVoice = (id: string | undefined): boolean => !!id && Object.keys(FILES[id] ?? {}).length > 0;

/** Decoded takes: companion → slot → one entry per file, in file order (null where a file is missing or silent, so take N is always file N). */
const bank = new Map<string, Map<string, (Take | null)[]>>();
const loading = new Map<string, Promise<void>>();
const lastTake = new Map<string, number>();

/**
 * Fetches and decodes every slot of one companion, once. Nothing is requested before audio is unlocked by the
 * first interaction (the load waits for it); a file that is missing, undecodable or silent leaves just that
 * slot's take out.
 */
export function loadVoice(id: string): Promise<void> {
  const cached = loading.get(id);
  if (cached) return cached;
  const files = FILES[id];
  if (!files) return Promise.resolve();
  const base = import.meta.env.BASE_URL ?? "/";
  const mine = new Map<string, (Take | null)[]>(Object.entries(files).map(([slot, count]) => [slot, Array<Take | null>(count).fill(null)]));
  bank.set(id, mine);
  const done = whenAudioReady()
    .then((a) =>
      Promise.all(
        Object.entries(files).flatMap(([slot, count]) =>
          Array.from({ length: count }, async (_, i) => {
            try {
              const res = await fetch(`${base}sfx/companions/${id}/${voiceFile(slot, count, i)}`);
              if (!res.ok) return;
              const take = await decodeTake(a, await res.arrayBuffer());
              if (take) mine.get(slot)![i] = take;
            } catch {
              /* that take stays silent */
            }
          }),
        ),
      ),
    )
    .then(() => undefined);
  loading.set(id, done);
  return done;
}

/**
 * Which take of a slot to play: `want` (a file index, for auditioning) if that file loaded, otherwise (no `want`) a
 * random loaded one that isn't `last`. -1 when there is nothing to play, including a `want` whose file didn't load.
 */
export function chooseTake(takes: readonly (Take | null)[] | undefined, last: number, want?: number, random = Math.random): number {
  if (!takes) return -1;
  if (want !== undefined) return takes[want] ? want : -1;
  const have = takes.flatMap((t, i) => (t ? [i] : []));
  return have.length ? have[pickTake(have.length, have.indexOf(last), random)] : -1;
}

export interface VoiceOptions {
  /** The companion's colour variant: shifts the pitch so two copies of one companion don't sound alike. */
  variant?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
  gain?: number;
  /** A specific take (0-based) instead of a random one that differs from the last; for auditioning. */
  take?: number;
}

/** A voice that is sounding; stop() cuts it off. */
export interface Voice {
  stop(): void;
  /** How long it sounds, at the pitch it was started with. */
  seconds: number;
}

/**
 * Plays a companion's sound for a slot. Returns null when nothing sounded: audio isn't unlocked or is muted,
 * the voice isn't loaded (yet), or the slot has no sound. Never throws and never starts a download.
 */
export function playVoice(id: string, slot: string, { variant = 0, pan = 0, gain = 1, take }: VoiceOptions = {}): Voice | null {
  const a = audioIfUnlocked();
  if (!a) return null;
  const takes = bank.get(id)?.get(slot);
  let src: AudioBufferSourceNode | null = null;
  let seconds = 0;
  const key = `${id}/${slot}`;
  const i = chooseTake(takes, lastTake.get(key) ?? -1, take);
  if (takes?.[i]) {
    lastTake.set(key, i);
    const rate = jitter(variantPitch(variant), 0.03);
    src = startTake(a, takes[i]!, { gain, pan, rate });
    seconds = (takes[i]!.buffer.duration - takes[i]!.offset) / rate;
  }
  emit({ name: slot, pack: null, voice: { companion: id, played: !!src } });
  return src ? { stop: () => stopSource(src), seconds } : null;
}

function stopSource(src: AudioBufferSourceNode) {
  try {
    src.stop();
  } catch {
    /* already stopped */
  }
}

// --- the lobby hello ---------------------------------------------------------------------------

let hello: Voice | null = null;
let helloFor = 0;

/**
 * A companion greeting in the lobby: loads its voice if needed (the first one may come a beat late), then plays
 * its hello. Only one hello ever sounds: a new one cuts the last, and a hello still loading is dropped if another
 * was asked for in the meantime. Nothing (not even a download) while this player has companion sounds off, and a
 * hello still loading when they turn them off stays silent.
 */
export function sayHello(id: string, variant = 0) {
  const mine = ++helloFor;
  hello?.stop();
  hello = null;
  if (!companionSounds()) return;
  void loadVoice(id).then(() => {
    if (mine === helloFor && companionSounds()) hello = playVoice(id, "hello", { variant });
  });
}

/** Drops a pending hello and cuts one that is sounding (selecting "No companion", closing the picker). */
export function silenceHello() {
  helloFor++;
  hello?.stop();
  hello = null;
}
