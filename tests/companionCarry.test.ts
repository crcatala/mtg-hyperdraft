import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/client/store";
import {
  CARRY_KEEPALIVE_MS,
  CARRY_SEND_MS,
  CARRY_STALE_MS,
  cancelPet,
  carryPetTo,
  dropPet,
  isCarried,
  LAND_HOLD_MS,
  liftPet,
  NOPE_REACTION,
  petPositions,
  petTarget,
  receivePetCancel,
  receivePetLand,
  receivePetMove,
  resetCarries,
  sendPetHome,
} from "../src/client/table/companionCarry";
import { clearReactions, reactionOf } from "../src/client/table/companionPlayback";
import { clearBubbles, useBubbles } from "../src/client/table/companionTalk";
import { tableApi } from "../src/client/table/drag";
import { voiceSlotLine } from "../src/shared/companionKit";
import { companionSpot, matCenter } from "../src/shared/tableLayout";
import type { ClientMessage, RoomView } from "../src/shared/protocol";

/** A two-seat table: "me" (Alice, Sir Ribbit) and "u2" (Bob, Hex). Only what the carry flow reads. */
function seatTable(myAt?: { x: number; y: number }) {
  const players = [
    { id: "me", name: "Alice", companion: "ribbit", companionVariant: 0, ...(myAt && { companionAt: myAt }) },
    { id: "u2", name: "Bob", companion: "hex", companionVariant: 1 },
  ];
  useStore.setState({ view: { you: "me", phase: "playing", players, table: { seats: ["me", "u2"] } } as unknown as RoomView });
}

const sent: ClientMessage[] = [];
const classes = new Set<string>();
const HOME = companionSpot(0, 2);
const U2_HOME = companionSpot(1, 2);
/** The screen maps 1:1 onto the table here: client (x, y) is table (x, y). */
const OPEN = { x: 0, y: 0 };

describe("carrying your companion (lift, follow, land or nope, relay)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    vi.advanceTimersByTime(60_000);
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("document", { body: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c) } } });
    classes.clear();
    sent.length = 0;
    useStore.setState({ sendImpl: (m) => sent.push(m) });
    tableApi.screenToTable = (x, y) => ({ x, y });
    seatTable();
    // The figures say where they're drawn; here, at home.
    petPositions.set("me", HOME);
    petPositions.set("u2", U2_HOME);
  });
  afterEach(() => {
    resetCarries();
    clearReactions();
    clearBubbles();
    tableApi.screenToTable = () => null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useStore.setState({ view: null, sendImpl: () => {} });
  });

  it("lifts with the pick-up reaction, voice line and a first position for the others, then loops the carry", () => {
    expect(liftPet(HOME.x + 0.3, HOME.y - 0.2)).toBe(true);
    expect(isCarried("me")).toBe(true);
    expect(reactionOf("me")?.slot).toBe("pickup");
    expect(useBubbles.getState().bubbles.me?.text).toBe(voiceSlotLine("ribbit", "pickup"));
    expect(sent).toEqual([{ t: "petMove", x: Math.round(HOME.x * 100) / 100, y: Math.round(HOME.y * 100) / 100 }]);
    // Nothing else on the table starts meanwhile (the wheel, card drags).
    expect(classes.has("dragging")).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(reactionOf("me")?.slot).toBe("carry");
    // Can't lift it twice.
    expect(liftPet(0, 0)).toBe(false);
  });

  it("follows the pointer from where it was grabbed, streaming at most every CARRY_SEND_MS and at least every CARRY_KEEPALIVE_MS", () => {
    liftPet(HOME.x + 1, HOME.y);
    sent.length = 0;
    carryPetTo(1, 0.5);
    // Grabbed 1 to the right of its feet: they stay 1 to the left of the pointer.
    expect(petTarget("me", HOME, undefined)).toEqual({ x: 0, y: 0.5, carried: "local", invalid: false });
    expect(sent).toEqual([]); // too soon after the lift's own update
    vi.advanceTimersByTime(CARRY_SEND_MS);
    carryPetTo(2, 0.5);
    carryPetTo(3, 0.5);
    expect(sent).toEqual([{ t: "petMove", x: 1, y: 0.5 }]);
    // Held still: a keep-alive, so the others don't think it was abandoned.
    vi.advanceTimersByTime(CARRY_KEEPALIVE_MS * 2);
    expect(sent.at(-1)).toEqual({ t: "petMove", x: 2, y: 0.5 });
  });

  it("shows when it can't land where it is (on a mat, off the table)", () => {
    liftPet(HOME.x, HOME.y);
    const mat = matCenter(1, 2);
    carryPetTo(mat.x, mat.y);
    expect(petTarget("me", HOME, undefined).invalid).toBe(true);
    carryPetTo(0, 0);
    expect(petTarget("me", HOME, undefined).invalid).toBe(false);
    carryPetTo(100, 0);
    expect(petTarget("me", HOME, undefined).invalid).toBe(true);
  });

  it("lands on a valid spot: the landing, one stored setPetPos, and it stays there until the state agrees", () => {
    liftPet(HOME.x, HOME.y);
    sent.length = 0;
    vi.advanceTimersByTime(CARRY_SEND_MS);
    dropPet(OPEN.x + 0.123, OPEN.y);
    expect(isCarried("me")).toBe(false);
    expect(classes.has("dragging")).toBe(false);
    expect(reactionOf("me")?.slot).toBe("drop");
    expect(useBubbles.getState().bubbles.me?.text).toBe(voiceSlotLine("ribbit", "drop"));
    expect(sent.filter((m) => m.t === "setPetPos")).toEqual([{ t: "setPetPos", at: { x: 0.12, y: 0 } }]);
    // Before the room's state comes back it stands where it landed, not at home.
    expect(petTarget("me", HOME, undefined)).toMatchObject({ x: 0.12, y: 0, carried: null });
    // The state agrees: from now on the state is what counts.
    expect(petTarget("me", HOME, { x: 0.12, y: 0 })).toMatchObject({ x: 0.12, y: 0 });
    expect(petTarget("me", HOME, undefined)).toMatchObject({ x: HOME.x, y: HOME.y });
    // No more updates once it's down.
    sent.length = 0;
    vi.advanceTimersByTime(CARRY_KEEPALIVE_MS * 3);
    expect(sent).toEqual([]);
  });

  it("goes back with a nope on a bad spot (or Esc): no stored change, the others told to put it back", () => {
    for (const end of [() => dropPet(matCenter(0, 2).x, matCenter(0, 2).y), () => cancelPet()]) {
      liftPet(HOME.x, HOME.y);
      carryPetTo(30, 30);
      sent.length = 0;
      end();
      expect(sent).toEqual([{ t: "petCancel" }]);
      expect(isCarried("me")).toBe(false);
      expect(classes.has("dragging")).toBe(false);
      expect(reactionOf("me")?.slot).toBe(NOPE_REACTION);
      expect(petTarget("me", HOME, undefined)).toMatchObject({ x: HOME.x, y: HOME.y, carried: null });
    }
  });

  it("a landing the room never confirms gives way to the state after LAND_HOLD_MS", () => {
    liftPet(HOME.x, HOME.y);
    dropPet(0, 0);
    vi.advanceTimersByTime(LAND_HOLD_MS - 1);
    expect(petTarget("me", HOME, undefined)).toMatchObject({ x: 0, y: 0 });
    vi.advanceTimersByTime(2);
    expect(petTarget("me", HOME, undefined)).toMatchObject({ x: HOME.x, y: HOME.y });
  });

  it("someone else's carry: lift on its first update, smoothed moves, landing; and nothing is sent", () => {
    receivePetMove("u2", 1, 2);
    expect(isCarried("u2")).toBe(true);
    expect(reactionOf("u2")?.slot).toBe("pickup");
    expect(useBubbles.getState().bubbles.u2?.text).toBe(voiceSlotLine("hex", "pickup"));
    receivePetMove("u2", 3, 4);
    expect(petTarget("u2", U2_HOME, undefined)).toEqual({ x: 3, y: 4, carried: "remote", invalid: false });
    expect(reactionOf("u2")?.slot).toBe("pickup"); // not restarted by every update
    receivePetLand("u2", { x: 3, y: 4 });
    expect(isCarried("u2")).toBe(false);
    expect(reactionOf("u2")?.slot).toBe("drop");
    expect(petTarget("u2", U2_HOME, undefined)).toMatchObject({ x: 3, y: 4, carried: null });
    expect(sent).toEqual([]);
  });

  it("someone else's cancelled carry goes back with a nope", () => {
    receivePetMove("u2", 1, 2);
    receivePetCancel("u2");
    expect(isCarried("u2")).toBe(false);
    expect(reactionOf("u2")?.slot).toBe(NOPE_REACTION);
    expect(petTarget("u2", U2_HOME, { x: -5, y: 1 })).toMatchObject({ x: -5, y: 1, carried: null });
  });

  it("a carry that goes quiet (its player dropped out) ends by itself after CARRY_STALE_MS, with no ghost left", () => {
    receivePetMove("u2", 1, 2);
    vi.advanceTimersByTime(1000);
    expect(reactionOf("u2")?.slot).toBe("carry");
    vi.advanceTimersByTime(CARRY_STALE_MS - 1000);
    expect(petTarget("u2", U2_HOME, undefined).carried).toBe("remote");
    vi.advanceTimersByTime(1);
    expect(petTarget("u2", U2_HOME, undefined)).toEqual({ ...U2_HOME, carried: null, invalid: false });
    expect(isCarried("u2")).toBe(false);
    expect(reactionOf("u2")?.slot).toBe("");
  });

  it("ignores relayed carries of my own companion (the room never sends them, but a second tab could)", () => {
    receivePetMove("me", 5, 5);
    receivePetLand("me", { x: 5, y: 5 });
    expect(isCarried("me")).toBe(false);
    expect(petTarget("me", HOME, undefined)).toMatchObject({ x: HOME.x, y: HOME.y });
  });

  it("Home sends it back (null) only when it's away", () => {
    expect(sendPetHome()).toBe(false);
    expect(sent).toEqual([]);
    seatTable({ x: 0, y: 0 });
    expect(sendPetHome()).toBe(true);
    expect(sent).toEqual([{ t: "setPetPos", at: null }]);
    // It heads home at once, before the state says so.
    expect(petTarget("me", HOME, { x: 0, y: 0 })).toMatchObject({ x: HOME.x, y: HOME.y });
  });

  it("can't be lifted without a seat and a companion", () => {
    useStore.setState({ view: { you: "me", phase: "playing", players: [{ id: "me", name: "Alice" }], table: { seats: ["me"] } } as unknown as RoomView });
    expect(liftPet(0, 0)).toBe(false);
    expect(sent).toEqual([]);
    expect(classes.has("dragging")).toBe(false);
  });
});
