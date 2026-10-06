// The Treatomancer's sounds (public/treats/sfx/<name>.mp3, made by scripts/build-treat-sfx.mjs). Like companion
// voices they're not part of a sound pack: the machine sounds the same whichever pack is chosen. They load once,
// after audio is unlocked, and play through the effects bus (sfx.ts), so mute and volume apply.

import { audioIfUnlocked, decodeTake, startTake, whenAudioReady, type Take } from "./sfx";

export const TREAT_SOUNDS = ["open", "close", "pick", "buy", "rumble", "drumroll", "launch", "land", "scamper", "trip", "chomp", "win", "denied"] as const;
export type TreatSound = (typeof TREAT_SOUNDS)[number];

/** How loud each one sits in the mix (after loudness matching). */
const GAIN: Record<TreatSound, number> = {
  open: 0.55,
  close: 0.45,
  pick: 0.4,
  buy: 0.6,
  rumble: 0.6,
  drumroll: 0.4,
  launch: 0.65,
  land: 0.55,
  scamper: 0.45,
  trip: 0.6,
  chomp: 0.7,
  win: 0.55,
  denied: 0.45,
};

const bank = new Map<TreatSound, Take>();
let loading: Promise<void> | null = null;

/** Fetches and decodes them all, once (waits for the first interaction to unlock audio). */
export function loadTreatSounds(): Promise<void> {
  if (loading) return loading;
  const base = import.meta.env.BASE_URL ?? "/";
  loading = whenAudioReady().then((a) =>
    Promise.all(
      TREAT_SOUNDS.map(async (name) => {
        try {
          const res = await fetch(`${base}treats/sfx/${name}.mp3`);
          if (!res.ok) return;
          const take = await decodeTake(a, await res.arrayBuffer());
          if (take) bank.set(name, take);
        } catch {
          /* that one stays silent */
        }
      }),
    ).then(() => undefined),
  );
  return loading;
}

/** Plays one (silent until loaded, muted, or before audio is unlocked). `pan` -1..1 places it left/right. */
export function treatSound(name: TreatSound, { gain = 1, rate = 1, pan = 0 }: { gain?: number; rate?: number; pan?: number } = {}) {
  const a = audioIfUnlocked();
  const take = bank.get(name);
  if (!a || !take) return;
  startTake(a, take, { gain: GAIN[name] * gain, rate, pan });
}
