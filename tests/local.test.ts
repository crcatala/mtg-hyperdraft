import { describe, expect, it } from "vitest";
import { startLocal, stopLocal } from "../src/client/local";
import { useStore } from "../src/client/store";

const settle = () => new Promise((r) => setTimeout(r, 0));
// Solo mode reads the page URL (?as= aliases); tests run in node.
(globalThis as { location?: unknown }).location ??= { search: "", pathname: "/solo", host: "localhost", protocol: "http:" };

describe("solo mode transport", () => {
  it("publishes a fresh view on every change, like the network does", async () => {
    startLocal();
    const before = useStore.getState().view!;
    useStore.getState().send({ t: "setName", name: "Renamed" });
    await settle();
    const after = useStore.getState().view!;
    // Selectors compare by reference: nested state must not be the same (mutated) objects.
    expect(after.players).not.toBe(before.players);
    expect(after.players.find((p) => p.id === after.you)?.name).toBe("Renamed");
    expect(before.players.find((p) => p.id === before.you)?.name).not.toBe("Renamed");
    stopLocal();
  });
});
