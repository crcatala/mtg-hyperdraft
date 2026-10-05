import { describe, expect, it } from "vitest";
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
