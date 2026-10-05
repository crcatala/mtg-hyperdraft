import { describe, expect, it } from "vitest";
import { presenceChanges } from "../src/client/presence";
import type { Player } from "../src/shared/types";

const player = (id: string, connected: boolean, isBot = false): Player => ({ id, name: id.toUpperCase(), isBot, isHost: false, ready: false, connected, joinedAt: 0, avatar: "sable", companion: "foil" });

describe("presenceChanges", () => {
  it("reports humans who dropped out or came back", () => {
    const prev = [player("me", true), player("bob", true), player("cleo", false)];
    const next = [player("me", true), player("bob", false), player("cleo", true)];
    const { left, back } = presenceChanges(prev, next, "me");
    expect(left.map((p) => p.id)).toEqual(["bob"]);
    expect(back.map((p) => p.id)).toEqual(["cleo"]);
  });

  it("ignores yourself, bots, newcomers and unchanged players", () => {
    const prev = [player("me", true), player("bot", true, true), player("bob", true)];
    const next = [player("me", false), player("bot", false, true), player("bob", true), player("new", true)];
    expect(presenceChanges(prev, next, "me")).toEqual({ left: [], back: [] });
  });
});
