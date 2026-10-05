import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../src/client/store";
import { shortcutsBlocked } from "../src/client/shortcuts";
import { openEmoteWheel, receiveEmote, resetEmotes, sendEmote, useEmoteWheel } from "../src/client/table/companionEmote";
import { closeEmoteLines, customLine, effectiveLine, openEmoteLines, resetCustomLines, setCustomLines, useEmoteLines } from "../src/client/table/emoteLines";
import { clearReactions, reactionOf } from "../src/client/table/companionPlayback";
import { clearBubbles, useBubbles } from "../src/client/table/companionTalk";
import { EMOTE_COOLDOWN_MS, emoteBadge } from "../src/client/table/emoteWheel";
import { emoteLine } from "../src/shared/companionKit";
import type { ClientMessage, RoomView } from "../src/shared/protocol";

const XSS = "<img src=x onerror=alert(1)>";

/** Spies standing in for every kind of browser storage: none of them may be touched. */
function storageSpies() {
  const store = () => ({ getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
  const spies = { localStorage: store(), sessionStorage: store(), indexedDB: { open: vi.fn(), deleteDatabase: vi.fn() } };
  for (const [name, value] of Object.entries(spies)) vi.stubGlobal(name, value);
  const calls = () => [...Object.values(spies.localStorage), ...Object.values(spies.sessionStorage), ...Object.values(spies.indexedDB)].filter((f) => typeof f === "function").reduce((n, f) => n + (f as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  return { calls };
}

describe("custom emote lines: this tab's memory only", () => {
  afterEach(() => {
    resetCustomLines();
    closeEmoteLines();
    vi.unstubAllGlobals();
  });

  it("starts with the kit's lines; set replaces them (cleaned), reset brings the kit's back", () => {
    expect(useEmoteLines.getState().custom).toEqual([null, null, null, null, null, null]);
    expect(effectiveLine(useEmoteLines.getState().custom, "ribbit", 5)).toBe(emoteLine("ribbit", 5));

    setCustomLines(["  Get \n wrecked ", null, null, null, null, "Ribbit‮ you"], "ribbit");
    expect(useEmoteLines.getState().custom).toEqual(["Get wrecked", null, null, null, null, "Ribbit you"]);
    expect(customLine(0)).toBe("Get wrecked");
    expect(customLine(1)).toBeNull();
    const custom = useEmoteLines.getState().custom;
    expect(effectiveLine(custom, "ribbit", 0)).toBe("Get wrecked");
    expect(effectiveLine(custom, "ribbit", 1)).toBe(emoteLine("ribbit", 1));

    resetCustomLines();
    expect(useEmoteLines.getState().custom).toEqual([null, null, null, null, null, null]);
    expect(effectiveLine(useEmoteLines.getState().custom, "ribbit", 0)).toBe(emoteLine("ribbit", 0));
  });

  it("keeps a line equal to the companion's own (or one that doesn't clean up) as the kit's, so it isn't sent", () => {
    setCustomLines([emoteLine("ribbit", 0)!, " \n ", "x".repeat(61), XSS], "ribbit");
    expect(useEmoteLines.getState().custom).toEqual([null, null, null, XSS, null, null]);
  });

  it("never touches localStorage, sessionStorage or IndexedDB (and has no persist middleware)", () => {
    const { calls } = storageSpies();
    setCustomLines(["a", "b", "c", "d", "e", "f"], "ribbit");
    openEmoteLines();
    closeEmoteLines();
    resetCustomLines();
    expect(calls()).toBe(0);
    expect((useEmoteLines as unknown as { persist?: unknown }).persist).toBeUndefined();
  });

  it("the editor blocks the table's shortcuts while open", () => {
    expect(shortcutsBlocked()).toBe(false);
    openEmoteLines();
    expect(shortcutsBlocked()).toBe(true);
    closeEmoteLines();
    expect(shortcutsBlocked()).toBe(false);
  });
});

describe("custom emote lines at the table", () => {
  const sent: ClientMessage[] = [];
  const bubble = (pid: string) => useBubbles.getState().bubbles[pid];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.advanceTimersByTime(60_000);
    vi.stubGlobal("window", { innerWidth: 1280, innerHeight: 800 });
    vi.stubGlobal("document", { body: { classList: { contains: () => false } } });
    sent.length = 0;
    useStore.setState({ sendImpl: (m) => sent.push(m) });
    const players = [
      { id: "me", name: "Alice", companion: "ribbit", companionVariant: 0 },
      { id: "u2", name: "Bob", companion: "hex", companionVariant: 1 },
    ];
    useStore.setState({ view: { you: "me", phase: "playing", players, table: { seats: ["me", "u2"] } } as unknown as RoomView });
  });
  afterEach(() => {
    resetEmotes();
    resetCustomLines();
    clearReactions();
    clearBubbles();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useStore.setState({ view: null, sendImpl: () => {} });
  });

  it("a customized slot shows and sends my line; the others still send just the slot", () => {
    setCustomLines([null, null, null, null, null, "Croak and weep"], "ribbit");
    expect(sendEmote(5)).toBe(true);
    expect(sent).toEqual([{ t: "emote", slot: 5, text: "Croak and weep" }]);
    // Same slot as ever: its reaction, colour and icon; only the words are mine.
    expect(reactionOf("me")?.slot).toBe("emote6");
    expect(bubble("me")).toMatchObject({ text: "Croak and weep", size: "large", badge: emoteBadge(5) });

    vi.advanceTimersByTime(EMOTE_COOLDOWN_MS);
    expect(sendEmote(0)).toBe(true);
    expect(sent[1]).toEqual({ t: "emote", slot: 0 });
    expect(bubble("me")?.text).toBe(emoteLine("ribbit", 0));
  });

  it("someone else's line shows on their companion; without one, their kit's line; junk falls back to the kit's", () => {
    receiveEmote("u2", 2, "Oops, my bad");
    expect(bubble("u2")).toMatchObject({ text: "Oops, my bad", badge: emoteBadge(2) });
    expect(reactionOf("u2")?.slot).toBe("emote3");
    clearBubbles();
    receiveEmote("u2", 2);
    expect(bubble("u2")?.text).toBe(emoteLine("hex", 2));
    clearBubbles();
    receiveEmote("u2", 2, " ​\n ");
    expect(bubble("u2")?.text).toBe(emoteLine("hex", 2));
    // Their lines are theirs: mine are untouched.
    expect(useEmoteLines.getState().custom).toEqual([null, null, null, null, null, null]);
  });

  it("the wheel doesn't open while the editor is; leaving the table closes the editor but keeps the lines", () => {
    openEmoteLines();
    openEmoteWheel(400, 400);
    expect(useEmoteWheel.getState().wheel).toBeNull();
    setCustomLines(["Mine"], "ribbit");
    resetEmotes();
    expect(useEmoteLines.getState().editing).toBe(false);
    expect(customLine(0)).toBe("Mine");
    openEmoteWheel(400, 400);
    expect(useEmoteWheel.getState().wheel).not.toBeNull();
  });
});
