import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/client/store";
import { pokeCompanion, receivePoke, resetCompanions } from "../src/client/table/companionPoke";
import { reactionOf } from "../src/client/table/companionPlayback";
import { useBubbles } from "../src/client/table/companionTalk";
import { bodyStyle, reactionFor } from "../src/client/table/companionReactions";
import { reactionSeconds } from "../src/client/table/companionMotion";
import { POKE_THROTTLE_MS, SULK_MS } from "../src/client/table/pokeLadder";
import { pokeLine } from "../src/shared/companionKit";
import type { ClientMessage, RoomView } from "../src/shared/protocol";

/** A two-seat table: "me" (Alice, Sir Ribbit) and "u2" (Bob, Hex). Only what the poke flow reads. */
function seatTable() {
  const players = [
    { id: "me", name: "Alice", companion: "ribbit", companionVariant: 0 },
    { id: "u2", name: "Bob", companion: "hex", companionVariant: 0 },
  ];
  useStore.setState({ view: { you: "me", phase: "playing", players, table: { seats: ["me", "u2"] } } as unknown as RoomView });
}

const sent: ClientMessage[] = [];
const slot = () => reactionOf("u2")?.slot;
const line = () => useBubbles.getState().bubbles.u2?.text;
const finaleMs = () => reactionSeconds(reactionFor("hex", "poke7")!, bodyStyle("hex")) * 1000;

/** This player taps Bob's Hex `n` times, POKE_THROTTLE_MS apart. */
function tapHex(n: number) {
  for (let i = 0; i < n; i++) {
    pokeCompanion("u2");
    vi.advanceTimersByTime(POKE_THROTTLE_MS);
  }
}

describe("poking at the table (ladder + relay + reactions + bubbles together)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.advanceTimersByTime(60_000); // well away from 0, like a real page
    sent.length = 0;
    useStore.setState({ sendImpl: (m) => sent.push(m) });
    seatTable();
  });
  afterEach(() => {
    resetCompanions();
    vi.useRealTimers();
    useStore.setState({ view: null, sendImpl: () => {} });
  });

  it("shows a tap at once and sends it; a received poke shows the same step", () => {
    expect(pokeCompanion("u2")).toBe(true);
    expect(sent).toEqual([{ t: "poke", target: "u2", step: 0 }]);
    expect(slot()).toBe("poke1");
    expect(line()).toBe(pokeLine("hex", 0));
    vi.advanceTimersByTime(POKE_THROTTLE_MS);
    receivePoke("u2", 1);
    expect(slot()).toBe("poke2");
    expect(line()).toBe(pokeLine("hex", 1));
  });

  it("a poke that arrives late, during the sulk, neither breaks the sulk nor unlocks taps (regression)", () => {
    tapHex(7); // the finale
    expect(slot()).toBe("poke7");
    expect(sent.map((m) => (m as { step: number }).step)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Bob tapped before he saw our finale; his poke lands now.
    receivePoke("u2", 3);
    expect(slot()).toBe("poke7");
    expect(line()).toBe(pokeLine("hex", 6));
    expect(pokeCompanion("u2")).toBe(false);
    // The finale still runs into the sulk on time...
    vi.advanceTimersByTime(finaleMs());
    expect(slot()).toBe("sulk");
    // ...and the ladder starts over once the sulk is through.
    vi.advanceTimersByTime(SULK_MS);
    expect(pokeCompanion("u2")).toBe(true);
    expect(slot()).toBe("poke1");
  });

  it("a late, lower step is shown but doesn't send the ladder back down", () => {
    tapHex(4); // steps 0..3
    receivePoke("u2", 1);
    expect(slot()).toBe("poke2");
    pokeCompanion("u2");
    expect(sent.at(-1)).toEqual({ t: "poke", target: "u2", step: 4 });
  });

  it("leaving the table forgets ladders, pending sulks, reactions and bubbles (the next room reuses player ids) (regression)", () => {
    tapHex(7); // the finale: a sulk is pending, a bubble is up
    expect(line()).toBeTruthy();
    resetCompanions();
    expect(reactionOf("u2")).toBeNull();
    expect(useBubbles.getState().bubbles).toEqual({});
    // A new room, seated the same way: its "u2" isn't sulking, and nothing plays on it by itself.
    seatTable();
    vi.advanceTimersByTime(finaleMs() + 100);
    expect(reactionOf("u2")).toBeNull();
    expect(pokeCompanion("u2")).toBe(true);
    expect(slot()).toBe("poke1");
    vi.advanceTimersByTime(SULK_MS);
    expect(slot()).toBe("poke1");
  });

  it("ignores pokes for players who aren't seated or have no companion", () => {
    receivePoke("nobody", 0);
    expect(reactionOf("nobody")).toBeNull();
    useStore.setState((s) => ({ view: { ...s.view!, players: s.view!.players.map((p) => (p.id === "u2" ? { ...p, companion: undefined } : p)) } }));
    pokeCompanion("u2");
    expect(reactionOf("u2")).toBeNull();
  });
});
