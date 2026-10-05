// Pure helpers for the sample-based sound effects (src/client/sfx.ts), kept apart so they can be
// unit tested without an AudioContext.

/** Samples quieter than this (about -46 dB) count as silence when trimming and measuring. */
export const SILENCE = 0.005;

export interface Analysis {
  /** Index of the first audible sample (the generated files start with a little room tone). */
  start: number;
  peak: number;
  /** RMS over the audible part only, so short clicks and long textures are compared fairly. */
  rms: number;
}

export function analyze(data: ArrayLike<number>): Analysis {
  let start = -1;
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
    if (start < 0 && a > SILENCE) start = i;
    if (start >= 0 && a > SILENCE * 0.4) {
      sum += a * a;
      n++;
    }
  }
  return { start: Math.max(0, start), peak, rms: n ? Math.sqrt(sum / n) : 0 };
}

/** The most a quiet sample is ever boosted: past this it's mostly the encoder's noise floor. */
export const MAX_GAIN = 10;
/** Below this peak a take is effectively silent (a failed generation) and isn't used at all. */
export const MIN_PEAK = 0.02;

export function isAudible(a: Analysis): boolean {
  return a.peak >= MIN_PEAK;
}

/**
 * The gain that brings a sample to `targetRms` without its peak passing `ceiling`. Clicks have a
 * high peak for their RMS, so they're limited by the ceiling instead of being blasted, and
 * very quiet samples are only lifted so far.
 */
export function normalizeGain(a: Analysis, targetRms = 0.12, ceiling = 0.95): number {
  if (a.peak <= 0 || a.rms <= 0) return 1;
  return Math.min(targetRms / a.rms, ceiling / a.peak, MAX_GAIN);
}

/**
 * Picks a take at random but never the one played last, so repeated sounds (flips, deals) don't
 * sound like the same sample machine-gunning. `last` is the previous index, or -1.
 */
export function pickTake(count: number, last: number, random = Math.random): number {
  if (count <= 1) return 0;
  const i = Math.floor(random() * (count - 1));
  return i >= last ? i + 1 : i;
}

/** A playback rate a few percent either side of `base`, so identical takes still differ a little. */
export function jitter(base: number, amount: number, random = Math.random): number {
  return base * (1 + (random() * 2 - 1) * amount);
}

/**
 * How a companion's voice is pitched for its colour variant, as a playback rate: variant 0 (the original
 * colours) is untouched, every other variant sits 0.8 to 3 semitones above or below it, in golden-ratio
 * steps like variantHue so successive variants land well apart. None sit close enough to the original
 * to be lost in the per-play jitter, so two copies of one companion at a table can be told apart by ear.
 */
export function variantPitch(variant: number): number {
  if (variant <= 0) return 1;
  const f = (variant * 0.618034) % 1;
  const side = f < 0.5 ? -1 : 1;
  const semitones = side * (0.8 + (f < 0.5 ? f * 2 : (f - 0.5) * 2) * 2.2);
  return 2 ** (semitones / 12);
}
