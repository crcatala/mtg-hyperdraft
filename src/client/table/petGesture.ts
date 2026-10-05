// What a press on a companion turns into (D2 in the epic): a quick tap pokes it; on your own companion, holding
// it for HOLD_MS or moving MOVE_PX picks it up, and letting go puts it down. Someone else's companion can't be
// picked up, so any press on it, however long, is a poke on release. Pure, so the timing can be tested; the
// pointer wiring is in companionCarry.ts.

/** How long a press on your own companion is held before it's picked up (ms). */
export const HOLD_MS = 250;
/** How far (CSS px) a press on your own companion moves before it's picked up, however quick. */
export const MOVE_PX = 8;

export type Gesture =
  | { phase: "idle" }
  /** Pressed at (x, y) at time t (ms); `own`: the presser's own companion. */
  | { phase: "pressing"; own: boolean; x: number; y: number; t: number }
  | { phase: "carrying" };

export type GestureEvent =
  /** The pointer moved (or, with the same x/y, just time passed: the hold timer). */
  | { type: "move"; x: number; y: number; t: number }
  | { type: "up"; t: number }
  /** The press was taken away (pointercancel, the window lost focus, Esc). */
  | { type: "cancel" };

/** "lift": pick it up now. "poke": it was a tap. "drop": put it down here. "cancel": put it back where it was. */
export type GestureEffect = "lift" | "poke" | "drop" | "cancel" | null;

export const IDLE: Gesture = { phase: "idle" };

export const pressGesture = (own: boolean, x: number, y: number, t: number): Gesture => ({ phase: "pressing", own, x, y, t });

/** The next state, and what to do about it. */
export function stepGesture(g: Gesture, ev: GestureEvent): { g: Gesture; effect: GestureEffect } {
  if (g.phase === "idle") return { g, effect: null };
  if (ev.type === "cancel") return { g: IDLE, effect: g.phase === "carrying" ? "cancel" : null };
  if (g.phase === "carrying") return ev.type === "up" ? { g: IDLE, effect: "drop" } : { g, effect: null };
  if (ev.type === "up") {
    // A long press on your own companion that somehow never lifted (its timer was late) isn't a tap either.
    return { g: IDLE, effect: !g.own || ev.t - g.t < HOLD_MS ? "poke" : null };
  }
  if (g.own && (ev.t - g.t >= HOLD_MS || Math.hypot(ev.x - g.x, ev.y - g.y) >= MOVE_PX)) return { g: { phase: "carrying" }, effect: "lift" };
  return { g, effect: null };
}
