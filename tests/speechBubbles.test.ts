import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "zustand";
import { SpeechBubbles } from "../src/client/table/SpeechBubbles";

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
});
