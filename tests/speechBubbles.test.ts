import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "zustand";
import { announcement, nextAnnouncement, SpeechBubbles } from "../src/client/table/SpeechBubbles";
import { setCompanionSpeech } from "../src/client/companionPrefs";

// A player's own emote line can say anything. Rendered here without a DOM (a server render reads the store's
// initial state), so the bubble store starts with the line in it.
const XSS = vi.hoisted(() => "<img src=x onerror=alert(1)>");
vi.mock("../src/client/table/companionTalk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/table/companionTalk")>()),
  useBubbles: create(() => ({ bubbles: { me: { id: 1, text: XSS, size: "large", badge: { icon: "tongue", color: "#ff9a52" }, at: 0 } } })),
}));

describe("speech bubbles render a player's line as text", () => {
  it("markup in a line comes out escaped, as typed: no element is injected", () => {
    const html = renderToStaticMarkup(createElement(SpeechBubbles));
    expect(html).toContain('<span class="speech-text">&lt;img src=x onerror=alert(1)&gt;</span>');
    expect(html).not.toContain("<img");
  });

  it("are hidden while this player has companion speech off, leaving only the (empty) live region for emotes", () => {
    setCompanionSpeech(false);
    try {
      const html = renderToStaticMarkup(createElement(SpeechBubbles));
      expect(html).not.toContain("speech-bubble");
      expect(html).not.toContain("onerror");
      expect(html).toContain('aria-live="polite"');
    } finally {
      setCompanionSpeech(true);
    }
  });
});

describe("emotes read out to screen readers", () => {
  const b = (id: number, size: "small" | "large", text = `line ${id}`) => ({ id, text, size, at: 0 });

  it("reads the newest emote once, and never a poke or pick-up line", () => {
    expect(nextAnnouncement({ p1: b(4, "small"), p2: b(3, "large") }, 0)).toEqual({ playerId: "p2", bubble: b(3, "large") });
    expect(nextAnnouncement({ p1: b(5, "large"), p2: b(3, "large") }, 0)?.playerId).toBe("p1");
    // Already read (or older than what was read): nothing new to say.
    expect(nextAnnouncement({ p1: b(5, "large"), p2: b(3, "large") }, 5)).toBeUndefined();
    expect(nextAnnouncement({ p1: b(9, "small") }, 0)).toBeUndefined();
    expect(nextAnnouncement({}, 0)).toBeUndefined();
  });

  it("says whose companion it is when it knows", () => {
    expect(announcement("Alice", "Hex", "Ten lives. You have one.")).toBe("Alice's Hex: Ten lives. You have one.");
    expect(announcement(undefined, "Hex", "Hi")).toBe("Hex: Hi");
    expect(announcement(undefined, undefined, "Hi")).toBe("A companion: Hi");
  });
});
