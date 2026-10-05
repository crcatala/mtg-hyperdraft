import { describe, expect, it } from "vitest";
import { EMOTE_TEXT_MAX, EMOTE_TEXT_RAW_MAX } from "../src/shared/emoteText";
import { clientMessageSchema } from "../src/shared/protocol";

const ok = (m: unknown) => clientMessageSchema.safeParse(m).success;

describe("client message schema: poke", () => {
  it("accepts a target and a poke ladder step 0..6", () => {
    for (let step = 0; step <= 6; step++) expect(ok({ t: "poke", target: "u1", step })).toBe(true);
  });

  it("rejects out-of-range or non-integer steps, missing/empty targets, and a spoofed sender", () => {
    for (const step of [-1, 7, 1.5, "2", null]) expect(ok({ t: "poke", target: "u1", step })).toBe(false);
    expect(ok({ t: "poke", step: 0 })).toBe(false);
    expect(ok({ t: "poke", target: "", step: 0 })).toBe(false);
    expect(ok({ t: "poke", target: "x".repeat(65), step: 0 })).toBe(false);
    // `by` isn't part of the message: zod strips it, and the server stamps the sender itself.
    const parsed = clientMessageSchema.parse({ t: "poke", target: "u1", step: 0, by: "u2" });
    expect(parsed).toEqual({ t: "poke", target: "u1", step: 0 });
  });
});

describe("client message schema: emote", () => {
  it("accepts a wheel slot 0..5", () => {
    for (let slot = 0; slot <= 5; slot++) expect(ok({ t: "emote", slot })).toBe(true);
  });

  it("rejects out-of-range or non-integer slots, and a spoofed sender", () => {
    for (const slot of [-1, 6, 2.5, "1", null, undefined]) expect(ok({ t: "emote", slot })).toBe(false);
    // `by` isn't part of the message: zod strips it, and the server stamps the sender itself.
    expect(clientMessageSchema.parse({ t: "emote", slot: 2, by: "u2" })).toEqual({ t: "emote", slot: 2 });
  });

  it("takes an optional text of the player's own, raw up to EMOTE_TEXT_RAW_MAX (the room's cleaner has the last word)", () => {
    expect(ok({ t: "emote", slot: 0, text: "Get wrecked" })).toBe(true);
    // Raw, so whitespace and markup get through the schema for the room to clean (and React to escape).
    expect(ok({ t: "emote", slot: 0, text: "  <b>hi</b>\n" })).toBe(true);
    expect(ok({ t: "emote", slot: 0, text: "x".repeat(EMOTE_TEXT_RAW_MAX) })).toBe(true);
    expect(EMOTE_TEXT_RAW_MAX).toBeGreaterThanOrEqual(EMOTE_TEXT_MAX * 2);
    expect(ok({ t: "emote", slot: 0, text: "x".repeat(EMOTE_TEXT_RAW_MAX + 1) })).toBe(false);
    for (const text of [42, null, ["hi"], { s: "hi" }, true]) expect(ok({ t: "emote", slot: 0, text })).toBe(false);
  });
});
