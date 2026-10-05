// When the lobby's character select plays a companion's hello. Clicking a tile says hello at once; resting the
// pointer (or keyboard focus) on one says it after a short beat, so sweeping across the grid stays quiet instead
// of machine-gunning, and the same companion isn't greeted twice in a row (hover, then click). Pure timing: the
// caller supplies what "say hello" does, and the timers so tests can drive the clock.

export interface HelloGateDeps {
  say: (id: string) => void;
  /** How long a hover must rest on a tile before it speaks. */
  restMs?: number;
  /** The same companion isn't greeted again within this long. */
  repeatMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface HelloGate {
  /** The pointer or focus is on `id` (or left the tiles, null). */
  rest(id: string | null): void;
  /** `id` was clicked. */
  pick(id: string): void;
  /** Cancels anything pending. */
  cancel(): void;
}

export function createHelloGate({ say, restMs = 260, repeatMs = 1500, now = Date.now, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t as number) }: HelloGateDeps): HelloGate {
  let timer: unknown = null;
  let last: { id: string; at: number } | null = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const fire = (id: string) => {
    const t = now();
    if (last && last.id === id && t - last.at < repeatMs) return;
    last = { id, at: t };
    say(id);
  };
  return {
    rest(id) {
      cancel();
      if (id === null) return;
      timer = setTimer(() => {
        timer = null;
        fire(id);
      }, restMs);
    },
    pick(id) {
      cancel();
      fire(id);
    },
    cancel,
  };
}
