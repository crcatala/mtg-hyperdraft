// Picking your companion up and putting it down somewhere else on the table (D2, D9, D13 in the epic). A press
// on a companion runs through petGesture.ts: a tap pokes it; on your own, a hold or a drag lifts it, it follows
// the pointer, and letting go puts it down. On the table and off everyone else's mat (petSpotValid; its own
// player's mat is fine, cards and all) it lands there: one stored `setPetPos`, which the room re-checks and
// announces to the others (`petLand`). Anywhere else it goes back where it was with a "nope". While it's carried its position streams to the others (`petMove`, like a
// card drag) so they see it travel; a carry that goes quiet (a lost connection) ends on their screens by itself.
// The figures read this module every frame (petTarget), like companionPlayback: plain maps, no re-renders.

import { voiceSlotLine } from "../../shared/companionKit";
import { petSpotValid, type Vec2 } from "../../shared/tableLayout";
import { useStore } from "../store";
import { bodyStyle, reactionFor } from "./companionReactions";
import { reactionSeconds } from "./companionMotion";
import { playReaction, reactionOf, stopReaction } from "./companionPlayback";
import { say, voice } from "./companionTalk";
import { pokeCompanion } from "./companionPoke";
import { closeEmoteWheel } from "./companionEmote";
import { tableApi } from "./drag";
import { HOLD_MS, pressGesture, stepGesture, type Gesture, type GestureEffect } from "./petGesture";
import { me, table } from "./tableUi";
import { showBusy } from "./treatState";

/** Live position updates while carrying: at most one per this many ms (like card drags, ~20 a second)... */
export const CARRY_SEND_MS = 50;
/** ...and at least one per this many, even held still, so the others can tell a still carry from a lost one. */
export const CARRY_KEEPALIVE_MS = 300;
/** Someone else's carry with no update for this long has ended (they dropped out): it goes back to its spot. */
export const CARRY_STALE_MS = 1500;
/** How long a just-landed spot is trusted before the room's state says so too (after that, the state wins). */
export const LAND_HOLD_MS = 4000;
/** The reaction for "can't put it there": the bothered head-shake (and sweat drop) from the poke ladder. */
export const NOPE_REACTION = "poke5";

/** A companion in the air: where it is, and when that was last heard (performance.now()). */
interface Carry {
  x: number;
  y: number;
  at: number;
  /** This player's own carry (else someone else's, streamed in). */
  local: boolean;
  /** Whether it could be put down here (own carries only; others' are always drawn as fine). */
  valid: boolean;
}

const carries = new Map<string, Carry>();
/** Where a companion was just put down (null: sent home), until the room's state agrees or LAND_HOLD_MS passes. */
const landed = new Map<string, { at: Vec2 | null; t: number }>();
/** Pick-up → carry loop hand-overs, per player. */
const loops = new Map<string, ReturnType<typeof setTimeout>>();
/** Where each companion is drawn right now (its figure writes it every frame): where its sounds come from. */
export const petPositions = new Map<string, Vec2>();

/** What a figure should do this frame: stand (or glide) at x, y, or be carried there. */
export interface PetTarget {
  x: number;
  y: number;
  carried: "local" | "remote" | null;
  /** Over somewhere it can't be put down (own carries only). */
  invalid: boolean;
}

/**
 * Where a player's companion should be: carried, just landed (until the room's state catches up), or at its
 * stored spot (`stored`, Player.companionAt) or else its `home` by their mat. Ends someone else's carry that
 * went quiet.
 */
export function petTarget(playerId: string, home: Vec2, stored: Vec2 | undefined, now = performance.now()): PetTarget {
  const c = carries.get(playerId);
  if (c && !c.local && now - c.at > CARRY_STALE_MS) endCarry(playerId);
  else if (c) return { x: c.x, y: c.y, carried: c.local ? "local" : "remote", invalid: !c.valid };
  const l = landed.get(playerId);
  if (l) {
    const caughtUp = l.at === null ? !stored : !!stored && Math.abs(stored.x - l.at.x) < 0.02 && Math.abs(stored.y - l.at.y) < 0.02;
    if (caughtUp || now - l.t > LAND_HOLD_MS) landed.delete(playerId);
    else return { ...(l.at ?? home), carried: null, invalid: false };
  }
  return { ...(stored ?? home), carried: null, invalid: false };
}

/** Whether someone's companion is in the air right now. */
export const isCarried = (playerId: string): boolean => carries.has(playerId);

// --- this player's own carry ------------------------------------------------------------------

/** The press in progress on a companion: its pointer (the only one it listens to), and how to stop listening. */
let press: { g: Gesture; target: string; pointerId?: number; end: () => void } | null = null;
/** Pointer → companion offset, so it doesn't jump to sit under the pointer when it's grabbed. */
let grab: Vec2 = { x: 0, y: 0 };
let lastSent = 0;
let keepalive: ReturnType<typeof setInterval> | undefined;

/**
 * A press on `target`'s companion (from its figure's pointerdown). Follows that one pointer from here on, on the
 * window, so nothing else on the table (panning, card drags, pings) sees it: what it turns into is petGesture's
 * call. Only one press at a time: a second finger on a companion meanwhile is ignored. A new press from the same
 * pointer means its release went missing (let go outside the window): the old press is cancelled first, so a
 * carry can't be left stranded in the air.
 */
export function pressPet(target: string, e: { clientX: number; clientY: number; pointerId?: number; target?: EventTarget | null }) {
  if (press && press.pointerId !== e.pointerId) return;
  if (press) cancelPress();
  // Mid-treat-race the companions are nobody's to poke or carry.
  if (showBusy()) return;
  const own = target === me();
  let last = { x: e.clientX, y: e.clientY };
  const el = e.target && "setPointerCapture" in e.target ? (e.target as Element) : null;
  /** Events from other pointers (another finger) aren't this press's business. */
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
    apply(r.effect, target, last);
    if (r.g.phase === "idle") press?.end();
  };
  const move = (ev: PointerEvent) => {
    if (!mine(ev)) return;
    last = { x: ev.clientX, y: ev.clientY };
    step({ type: "move", x: ev.clientX, y: ev.clientY, t: performance.now() });
    if (press?.g.phase === "carrying") carryPetTo(ev.clientX, ev.clientY);
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
    g: pressGesture(own, e.clientX, e.clientY, performance.now()),
    target,
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

/** Ends the press in progress as if it was taken away: a carry goes back where it was. */
function cancelPress() {
  if (!press) return;
  const r = stepGesture(press.g, { type: "cancel" });
  press.end();
  if (r.effect === "cancel") cancelPet();
}

function apply(effect: GestureEffect, target: string, at: { x: number; y: number }) {
  if (effect === "poke") pokeCompanion(target);
  else if (effect === "lift") liftPet(at.x, at.y);
  else if (effect === "drop") dropPet(at.x, at.y);
  else if (effect === "cancel") cancelPet();
}

/** This player picks their companion up, grabbed at screen point (clientX, clientY). Returns false if they can't. */
export function liftPet(clientX: number, clientY: number): boolean {
  const pid = me();
  const t = table();
  const player = useStore.getState().view?.players.find((p) => p.id === pid);
  if (!t || !t.seats.includes(pid) || !player?.companion || carries.has(pid)) return false;
  const from = petPositions.get(pid);
  const pt = tableApi.screenToTable(clientX, clientY);
  if (!from) return false;
  grab = pt ? { x: from.x - pt.x, y: from.y - pt.y } : { x: 0, y: 0 };
  carries.set(pid, { x: from.x, y: from.y, at: performance.now(), local: true, valid: true });
  landed.delete(pid);
  // Nothing else on the table starts while it's in the air (the emote wheel, a card drag, the table's menu).
  document.body.classList.add("dragging");
  closeEmoteWheel();
  useStore.getState().closeMenu();
  showLift(pid);
  sendMove(from, true);
  clearInterval(keepalive);
  keepalive = setInterval(() => {
    const c = carries.get(pid);
    if (c?.local && performance.now() - lastSent >= CARRY_KEEPALIVE_MS) sendMove(c, true);
  }, CARRY_KEEPALIVE_MS);
  return true;
}

/** The carried companion follows the pointer (keeping where it was grabbed), showing whether it could land there. */
export function carryPetTo(clientX: number, clientY: number) {
  const c = carries.get(me());
  const t = table();
  const pt = tableApi.screenToTable(clientX, clientY);
  if (!c?.local || !t || !pt) return;
  c.x = pt.x + grab.x;
  c.y = pt.y + grab.y;
  c.at = performance.now();
  c.valid = petSpotValid(c, t.seats.length, t.seats.indexOf(me()));
  sendMove(c);
}

/** Letting go at (clientX, clientY): it lands there if it may, else it goes back with a "nope". */
export function dropPet(clientX: number, clientY: number) {
  carryPetTo(clientX, clientY);
  const pid = me();
  const c = carries.get(pid);
  if (!c?.local) return;
  const t = table();
  if (!t || !petSpotValid(c, t.seats.length, t.seats.indexOf(pid))) {
    cancelPet();
    return;
  }
  const at = { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 };
  endLocalCarry();
  landed.set(pid, { at, t: performance.now() });
  showLanding(pid);
  useStore.getState().send({ t: "setPetPos", at });
}

/** The carry ends without landing (a bad spot, Esc, the window lost focus): back where it was. */
export function cancelPet() {
  const pid = me();
  if (!carries.get(pid)?.local) return;
  endLocalCarry();
  showNope(pid);
  useStore.getState().send({ t: "petCancel" });
}

/** Home (the emote wheel's centre): this player's companion goes back to its spot by their mat. */
export function sendPetHome(): boolean {
  const pid = me();
  const player = useStore.getState().view?.players.find((p) => p.id === pid);
  if (!player?.companion || !player.companionAt || carries.has(pid) || showBusy()) return false;
  landed.set(pid, { at: null, t: performance.now() });
  playReaction(pid, "hello");
  useStore.getState().send({ t: "setPetPos", at: null });
  return true;
}

function sendMove(p: Vec2, force = false) {
  const now = performance.now();
  if (!force && now - lastSent < CARRY_SEND_MS) return;
  lastSent = now;
  useStore.getState().send({ t: "petMove", x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
}

function endLocalCarry() {
  carries.delete(me());
  clearInterval(keepalive);
  keepalive = undefined;
  document.body.classList.remove("dragging");
}

// --- everyone else's --------------------------------------------------------------------------

/** `by` is carrying their companion; the first update of a carry is the pick-up. */
export function receivePetMove(by: string, x: number, y: number) {
  if (by === me()) return;
  const c = carries.get(by);
  if (c) {
    c.x = x;
    c.y = y;
    c.at = performance.now();
    return;
  }
  carries.set(by, { x, y, at: performance.now(), local: false, valid: true });
  landed.delete(by);
  showLift(by);
}

/** `by` let go where it can't stand: it goes back where it was. */
export function receivePetCancel(by: string) {
  if (!carries.get(by) || carries.get(by)!.local) return;
  endCarry(by);
  showNope(by);
}

/** `by` put their companion down at `at` (null: sent it home). The state saying so follows. */
export function receivePetLand(by: string, at: Vec2 | null) {
  if (by === me()) return;
  const wasCarried = carries.has(by);
  carries.delete(by);
  landed.set(by, { at, t: performance.now() });
  if (at && wasCarried) showLanding(by);
  else if (at) playReaction(by, "drop");
  else playReaction(by, "hello");
}

/** A carry that ended without a landing: it stops dangling (and glides back to its spot). */
function endCarry(playerId: string) {
  carries.delete(playerId);
  clearTimeout(loops.get(playerId));
  loops.delete(playerId);
  if (reactionOf(playerId)?.slot === "carry") stopReaction(playerId);
}

// --- what everyone sees -----------------------------------------------------------------------

/** Lifted: the pick-up voice, line and reaction, then the dangling carry loop for as long as it's up. */
function showLift(playerId: string) {
  const companion = companionOf(playerId);
  if (!companion) return;
  playReaction(playerId, "pickup");
  talk(playerId, companion, "pickup");
  const seq = reactionOf(playerId)?.seq;
  clearTimeout(loops.get(playerId));
  loops.set(
    playerId,
    setTimeout(
      () => {
        loops.delete(playerId);
        // Still up, and nothing else (a poke) has started on it since.
        if (carries.has(playerId) && reactionOf(playerId)?.seq === seq) playReaction(playerId, "carry");
      },
      reactionSeconds(reactionFor(companion, "pickup")!, bodyStyle(companion)) * 1000,
    ),
  );
}

/** Put down: the landing, with its voice and line. */
function showLanding(playerId: string) {
  const companion = companionOf(playerId);
  clearTimeout(loops.get(playerId));
  loops.delete(playerId);
  if (!companion) return;
  playReaction(playerId, "drop");
  talk(playerId, companion, "drop");
}

/** Couldn't be put down there: a head-shake (no voice or line) as it goes back. */
function showNope(playerId: string) {
  clearTimeout(loops.get(playerId));
  loops.delete(playerId);
  playReaction(playerId, NOPE_REACTION);
}

function talk(playerId: string, companion: string, slot: "pickup" | "drop") {
  const player = useStore.getState().view?.players.find((p) => p.id === playerId);
  const at = petPositions.get(playerId);
  voice(companion, slot, { variant: player?.companionVariant ?? 0, pan: at ? tableApi.screenPan(at.x, at.y) * 0.8 : 0 });
  say(playerId, voiceSlotLine(companion, slot), "small");
}

function companionOf(playerId: string): string | undefined {
  const t = table();
  if (!t?.seats.includes(playerId)) return undefined;
  return useStore.getState().view?.players.find((p) => p.id === playerId)?.companion;
}

/** Leaving the table: drop any carry (ours included) and every just-landed spot. The next room reuses player ids. */
export function resetCarries() {
  press?.end();
  carries.clear();
  // Whatever was carried, and whoever "me" is by now (the view may already be gone): the grabbing cursor goes.
  globalThis.document?.body?.classList.remove("dragging");
  landed.clear();
  for (const t of loops.values()) clearTimeout(t);
  loops.clear();
  petPositions.clear();
  clearInterval(keepalive);
  keepalive = undefined;
  press = null;
}
