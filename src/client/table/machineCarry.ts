// Picking up your Treatomancer and putting it down somewhere else on the table, like carrying your companion
// (companionCarry.ts). A press on the machine runs through petGesture.ts: a tap opens its menu; on your own
// machine, a hold or a drag lifts it, it follows the pointer, and letting go puts it down. On the table and off
// every mat (machineFits) it lands there: one stored `setMachinePos`, which the room re-checks. Anywhere else it
// goes back where it was with a shake. Each player has their own copy of the machine (nobody else's screen shows
// yours), so nothing streams while it's carried. The machine reads this module every frame (machineTarget).

import { machineFits } from "../../shared/treats";
import type { Vec2 } from "../../shared/tableLayout";
import { useStore } from "../store";
import { treatSound } from "../treatSounds";
import { closeEmoteWheel } from "./companionEmote";
import { tableApi } from "./drag";
import { HOLD_MS, pressGesture, stepGesture, type Gesture, type GestureEffect } from "./petGesture";
import { me, table } from "./tableUi";
import { showBusy } from "./treatState";

/** How long a just-landed spot is trusted before the room's state says so too (after that, the state wins). */
export const MACHINE_LAND_HOLD_MS = 4000;

/** The machine in the air: where it is, and whether it could be put down there. */
let carry: { x: number; y: number; valid: boolean } | null = null;
/** Where it was just put down, until the room's state agrees or MACHINE_LAND_HOLD_MS passes. */
let landed: { at: Vec2; t: number } | null = null;
/** Pointer → machine offset, so it doesn't jump to sit under the pointer when it's grabbed. */
let grab: Vec2 = { x: 0, y: 0 };
/** Where the machine is drawn right now (it writes this every frame): where a lift starts from. */
export const machinePos: Vec2 = { x: 0, y: 0 };
/** What just happened to it, for the machine to play (performance.now() when): picked up, put down, or a "nope". */
export const machineBeat: { kind: "lift" | "land" | "nope" | null; at: number } = { kind: null, at: 0 };

/** What the machine should do this frame: stand (or glide) at x, y, or be carried there. */
export interface MachineTarget {
  x: number;
  y: number;
  carried: boolean;
  /** Over somewhere it can't be put down. */
  invalid: boolean;
}

/** Where the viewer's own machine should be: carried, just landed, or at `stored` (TablePlayer.machineAt) or else `home`. */
export function machineTarget(home: Vec2, stored: Vec2 | undefined, now = performance.now()): MachineTarget {
  if (carry) return { x: carry.x, y: carry.y, carried: true, invalid: !carry.valid };
  if (landed) {
    const caughtUp = !!stored && Math.abs(stored.x - landed.at.x) < 0.02 && Math.abs(stored.y - landed.at.y) < 0.02;
    if (caughtUp || now - landed.t > MACHINE_LAND_HOLD_MS) landed = null;
    else return { ...landed.at, carried: false, invalid: false };
  }
  return { ...(stored ?? home), carried: false, invalid: false };
}

export const machineCarried = (): boolean => carry !== null;

/** The press in progress on the machine: its pointer (the only one it listens to), and how to stop listening. */
let press: { g: Gesture; pointerId?: number; end: () => void } | null = null;

/**
 * A press on the machine (from its pointerdown). `canMove`: it's this player's own copy (they're seated, looking
 * from their seat). Follows that one pointer on the window from here on, so nothing else on the table sees it:
 * a tap is `onTap` (its menu, whoever's machine it is); a hold or drag on your own lifts it.
 */
export function pressMachine(canMove: boolean, e: { clientX: number; clientY: number; pointerId?: number; target?: EventTarget | null }, onTap: () => void) {
  if (press && press.pointerId !== e.pointerId) return;
  if (press) cancelMachinePress();
  let last = { x: e.clientX, y: e.clientY };
  const el = e.target && "setPointerCapture" in e.target ? (e.target as Element) : null;
  const mine = (ev: PointerEvent) => e.pointerId === undefined || ev.pointerId === e.pointerId;
  try {
    if (e.pointerId !== undefined) el?.setPointerCapture(e.pointerId);
  } catch {
    /* not capturable (synthetic event) */
  }
  const step = (ev: Parameters<typeof stepGesture>[1]) => {
    if (!press) return;
    const r = stepGesture(press.g, ev);
    press.g = r.g;
    apply(r.effect, last, onTap);
    if (r.g.phase === "idle") press?.end();
  };
  const move = (ev: PointerEvent) => {
    if (!mine(ev)) return;
    last = { x: ev.clientX, y: ev.clientY };
    step({ type: "move", x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (press?.g.phase === "carrying") carryMachineTo(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    if (!mine(ev)) return;
    last = { x: ev.clientX, y: ev.clientY };
    step({ type: "up", t: performance.now() });
  };
  const cancel = (ev?: Event) => {
    if (ev?.type === "pointercancel" && !mine(ev as PointerEvent)) return;
    step({ type: "cancel" });
  };
  const blur = () => cancel();
  const key = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || press?.g.phase !== "carrying") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancel();
  };
  // The hold: lifts it after HOLD_MS even if the pointer never moves.
  const hold = setTimeout(() => step({ type: "move", x: last.x, y: last.y, t: performance.now() }), HOLD_MS);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
  window.addEventListener("keydown", key, true);
  press = {
    // Mid-show it's nobody's to move: any press is a tap (which says it's busy).
    g: pressGesture(canMove && !showBusy(), e.clientX, e.clientY, performance.now()),
    pointerId: e.pointerId,
    end: () => {
      clearTimeout(hold);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blur);
      window.removeEventListener("keydown", key, true);
      try {
        if (e.pointerId !== undefined && el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* already gone */
      }
      press = null;
    },
  };
}

/** Ends the press in progress as if it was taken away (a treat show starting): a carry goes back where it was. */
export function cancelMachinePress() {
  if (!press) return;
  const r = stepGesture(press.g, { type: "cancel" });
  press.end();
  if (r.effect === "cancel") cancelMachine();
}

function apply(effect: GestureEffect, at: { x: number; y: number }, onTap: () => void) {
  if (effect === "poke") onTap();
  else if (effect === "lift") liftMachine(at.x, at.y);
  else if (effect === "drop") dropMachine(at.x, at.y);
  else if (effect === "cancel") cancelMachine();
}

/** This player picks up their machine, grabbed at screen point (clientX, clientY). Returns false if they can't. */
export function liftMachine(clientX: number, clientY: number): boolean {
  const t = table();
  if (!t || !t.seats.includes(me()) || carry || showBusy()) return false;
  const pt = tableApi.screenToTable(clientX, clientY);
  grab = pt ? { x: machinePos.x - pt.x, y: machinePos.y - pt.y } : { x: 0, y: 0 };
  carry = { x: machinePos.x, y: machinePos.y, valid: true };
  landed = null;
  // Nothing else on the table starts while it's in the air (the emote wheel, a card drag, the table's menu).
  document.body.classList.add("dragging");
  closeEmoteWheel();
  useStore.getState().closeMenu();
  beat("lift");
  treatSound("pick");
  return true;
}

/** The carried machine follows the pointer (keeping where it was grabbed), showing whether it could land there. */
export function carryMachineTo(clientX: number, clientY: number) {
  const t = table();
  const pt = tableApi.screenToTable(clientX, clientY);
  if (!carry || !t || !pt) return;
  carry.x = pt.x + grab.x;
  carry.y = pt.y + grab.y;
  carry.valid = machineFits(carry, t.seats.length);
}

/** Letting go at (clientX, clientY): it lands there if it may, else it goes back with a shake. */
export function dropMachine(clientX: number, clientY: number) {
  carryMachineTo(clientX, clientY);
  const t = table();
  if (!carry) return;
  if (!t || !machineFits(carry, t.seats.length)) {
    cancelMachine();
    return;
  }
  const at = { x: Math.round(carry.x * 100) / 100, y: Math.round(carry.y * 100) / 100 };
  endCarry();
  landed = { at, t: performance.now() };
  beat("land");
  treatSound("land", { gain: 0.7, pan: tableApi.screenPan(at.x, at.y) * 0.8 });
  useStore.getState().send({ t: "setMachinePos", at });
}

/** The carry ends without landing (a bad spot, Esc, the window lost focus, a show starting): back where it was. */
export function cancelMachine() {
  if (!carry) return;
  endCarry();
  beat("nope");
  treatSound("denied");
}

function endCarry() {
  carry = null;
  document.body.classList.remove("dragging");
}

function beat(kind: "lift" | "land" | "nope") {
  machineBeat.kind = kind;
  machineBeat.at = performance.now();
}

/** Leaving the table: drop any carry and the just-landed spot (the next room reuses player ids). */
export function resetMachineCarry() {
  press?.end();
  press = null;
  carry = null;
  landed = null;
  machineBeat.kind = null;
  globalThis.document?.body?.classList.remove("dragging");
}
