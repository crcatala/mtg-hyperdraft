import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/client/store";
import { closeEmoteWheel, emoteCooldown, openEmoteWheel, receiveEmote, resetEmotes, sendEmote, useEmoteWheel } from "../src/client/table/companionEmote";
import { reactionOf, clearReactions } from "../src/client/table/companionPlayback";
import { clearBubbles, LARGE_BUBBLE_MS, useBubbles } from "../src/client/table/companionTalk";
import { EMOTE_COOLDOWN_MS, emoteBadge } from "../src/client/table/emoteWheel";
import { emoteLine } from "../src/shared/companionKit";
import type { ClientMessage, RoomView } from "../src/shared/protocol";

/** A two-seat table: "me" (Alice, Sir Ribbit) and "u2" (Bob, Hex). Only what the emote flow reads. */
function seatTable(myCompanion: string | null = "ribbit") {
  const players = [
    { id: "me", name: "Alice", companion: myCompanion ?? undefined, companionVariant: 0 },
    { id: "u2", name: "Bob", companion: "hex", companionVariant: 1 },
  ];
  useStore.setState({ view: { you: "me", phase: "playing", players, table: { seats: ["me", "u2"] } } as unknown as RoomView });
}

const sent: ClientMessage[] = [];
const bubble = (pid: string) => useBubbles.getState().bubbles[pid];

describe("emotes at the table (cooldown + relay + reactions + bubbles together)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.advanceTimersByTime(60_000);
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("document", { body: { classList: { contains: () => false } } });
    sent.length = 0;
    useStore.setState({ sendImpl: (m) => sent.push(m) });
    seatTable();
  });
  afterEach(() => {
    resetEmotes();
    clearReactions();
    clearBubbles();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useStore.setState({ view: null, sendImpl: () => {} });
  });

  it("shows my emote at once on my companion, as a large bubble with its badge, and sends just the slot", () => {
    expect(sendEmote(5)).toBe(true);
    expect(sent).toEqual([{ t: "emote", slot: 5 }]);
    expect(reactionOf("me")?.slot).toBe("emote6");
    expect(bubble("me")).toMatchObject({ text: emoteLine("ribbit", 5), size: "large", badge: emoteBadge(5) });
    // A large bubble stays up LARGE_BUBBLE_MS.
    vi.advanceTimersByTime(LARGE_BUBBLE_MS - 1);
    expect(bubble("me")).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(bubble("me")).toBeUndefined();
  });

  it("someone else's emote plays on their companion", () => {
    receiveEmote("u2", 0);
    expect(reactionOf("u2")?.slot).toBe("emote1");
    expect(bubble("u2")).toMatchObject({ text: emoteLine("hex", 0), size: "large" });
    expect(reactionOf("me")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("cools down between emotes: nothing shown or sent until it's over", () => {
    expect(sendEmote(0)).toBe(true);
    vi.advanceTimersByTime(EMOTE_COOLDOWN_MS - 1);
    expect(emoteCooldown()).toBe(1);
    expect(sendEmote(1)).toBe(false);
    expect(sent).toHaveLength(1);
    expect(reactionOf("me")?.slot).toBe("emote1");
    vi.advanceTimersByTime(1);
    expect(emoteCooldown()).toBe(0);
    expect(sendEmote(1)).toBe(true);
    expect(sent).toEqual([
      { t: "emote", slot: 0 },
      { t: "emote", slot: 1 },
    ]);
    // Someone else's emotes don't start my cooldown.
    vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
    receiveEmote("u2", 2);
    expect(emoteCooldown()).toBe(0);
  });

  it("no companion (or not seated): no wheel, no emote; bad slots and unknown senders are ignored", () => {
    seatTable(null);
    openEmoteWheel(100, 100);
    expect(useEmoteWheel.getState().wheel).toBeNull();
    expect(sendEmote(0)).toBe(false);
    seatTable();
    expect(sendEmote(6)).toBe(false);
    expect(sendEmote(-1)).toBe(false);
    expect(sent).toEqual([]);
    receiveEmote("nobody", 0);
    receiveEmote("u2", 9);
    expect(reactionOf("nobody")).toBeNull();
    expect(reactionOf("u2")).toBeNull();
  });

  it("opens the wheel at the click (kept on screen), not while dragging; leaving the table closes it and forgets the cooldown", () => {
    openEmoteWheel(5, 400);
    expect(useEmoteWheel.getState().wheel).toEqual({ at: { x: 144, y: 400 }, from: { x: 5, y: 400 } });
    closeEmoteWheel();
    expect(useEmoteWheel.getState().wheel).toBeNull();
    vi.stubGlobal("document", { body: { classList: { contains: (c: string) => c === "dragging" } } });
    openEmoteWheel(300, 300);
    expect(useEmoteWheel.getState().wheel).toBeNull();
    vi.stubGlobal("document", { body: { classList: { contains: () => false } } });
    openEmoteWheel(300, 300);
    sendEmote(0);
    resetEmotes();
    expect(useEmoteWheel.getState().wheel).toBeNull();
    expect(emoteCooldown()).toBe(0);
  });
});
