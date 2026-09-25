import { describe, expect, it } from "vitest";
import { importCube } from "../src/shared/importCube";
import type { ScryfallCard } from "../src/shared/cardSources";

function scry(name: string): ScryfallCard {
  return { id: `id-${name}`, name, layout: "normal", rarity: "common", set: "tst", collector_number: "1", type_line: "Card", colors: [] };
}

const fakeFetch = async (url: string, init?: RequestInit) => {
  if (url.endsWith("/cards/collection")) {
    const ids = JSON.parse(String(init!.body)).identifiers as { name: string }[];
    return new Response(JSON.stringify({ data: ids.filter((i) => i.name !== "Nope").map((i) => scry(i.name)) }));
  }
  return new Response("{}", { status: 404 });
};

describe("importCube", () => {
  it("resolves a pasted list plus basic lands", async () => {
    const progress: string[] = [];
    const res = await importCube("2 Lightning Bolt\nCounterspell\nNope", fakeFetch, (m) => progress.push(m));
    expect(res.name).toBe("Custom list (3 cards)");
    expect(res.pool).toEqual(["id-Lightning Bolt", "id-Lightning Bolt", "id-Counterspell"]);
    expect(res.basics).toMatchObject({ W: "id-Plains", G: "id-Forest", C: "id-Wastes" });
    expect(res.notFound).toEqual(["Nope"]);
    expect(progress.length).toBeGreaterThan(0);
  });

  it("fails with a readable message when nothing resolves", async () => {
    await expect(importCube("Nope", fakeFetch, () => {})).rejects.toThrow(/None of those cards/);
  });
});
