import { describe, expect, it } from "vitest";
import { ROOM_CODE_LENGTH, signRoomCode, verifyRoomCode } from "../src/shared/roomCode";
import { mulberry32 } from "../src/shared/rng";

describe("signed room codes", () => {
  it("verifies codes it signed", async () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const code = await signRoomCode("secret", rng);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(await verifyRoomCode("secret", code)).toBe(true);
    }
  });

  it("rejects codes signed with another secret", async () => {
    const rng = mulberry32(3);
    let accepted = 0;
    for (let i = 0; i < 50; i++) if (await verifyRoomCode("other", await signRoomCode("secret", rng))) accepted++;
    // 2 check characters: roughly 1 in 961 forged codes passes by chance.
    expect(accepted).toBeLessThanOrEqual(1);
  });

  it("rejects tampered, malformed and lowercase codes", async () => {
    const code = await signRoomCode("secret", mulberry32(1));
    const last = code.at(-1)!;
    const tampered = code.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(await verifyRoomCode("secret", tampered)).toBe(false);
    expect(await verifyRoomCode("secret", code.toLowerCase())).toBe(false);
    expect(await verifyRoomCode("secret", code.slice(1))).toBe(false);
    expect(await verifyRoomCode("secret", "ABCDEF0")).toBe(false); // 0 is not in the alphabet
  });
});
