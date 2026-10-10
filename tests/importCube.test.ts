import { describe, expect, it } from "vitest";
import { importCube } from "../src/shared/importCube";
import type { ScryfallCard } from "../src/shared/cardSources";
import { PRESET_CUBES, presetFor, presetSource } from "../src/shared/presets";
import type { ImportResult } from "../src/shared/room";
import { makeCard } from "./fixtures";

// Stands in for the real snapshot, which is generated at build time and never committed (npm run presets:build).
// The test checks the plumbing (path, parsing, pool and basics), not card data.
function snapshotStandIn(poolSize: number): ImportResult {
  const pool = Array.from({ length: poolSize }, (_, i) => makeCard(i));
  const basicNames = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest", C: "Wastes" } as const;
  const basics = Object.entries(basicNames).map(([, name], i) => makeCard(poolSize + i, { name, typeLine: `Basic Land — ${name}` }));
  const basicIds = Object.fromEntries(Object.keys(basicNames).map((key, i) => [key, basics[i].id]));
  return { name: "Hypercube", source: "stand-in", cards: [...pool, ...basics], pool: pool.map((c) => c.id), notFound: [], warnings: [], basics: basicIds };
}

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

  it("loads bundled presets from static assets without touching Scryfall", async () => {
    const preset = PRESET_CUBES[0];
    const calls: string[] = [];
    const standIn = snapshotStandIn(preset.cards);
    const asset = async (path: string) => {
      calls.push(path);
      return new Response(JSON.stringify(standIn));
    };
    const res = await importCube(presetSource(preset.id), async () => { throw new Error("no network"); }, () => {}, asset);
    expect(calls).toEqual([`/presets/${preset.id}.json`]);
    expect(res.pool).toHaveLength(preset.cards);
    expect(Object.keys(res.basics).sort()).toEqual(["B", "C", "G", "R", "U", "W"]);
    const ids = new Set(res.cards.map((c) => c.id));
    expect(res.pool.every((id) => ids.has(id))).toBe(true);
  });

  it("only treats known preset ids as presets", () => {
    expect(presetFor("preset:hypercube")?.name).toBe("Hypercube");
    expect(presetFor("preset:../../secrets")).toBeNull();
    expect(presetFor("Lightning Bolt")).toBeNull();
  });

  it("reports a missing preset file", async () => {
    const missing = async () => new Response("nope", { status: 404 });
    await expect(importCube("preset:hypercube", missing, () => {}, missing)).rejects.toThrow(/Couldn't load the bundled Hypercube/);
  });
});
