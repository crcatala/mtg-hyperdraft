import { beforeEach, describe, expect, it } from "vitest";
import type { ScryfallSet } from "../src/shared/setSource";
import { isBoosterSet, loadSetCatalog, resetSetCatalog, searchSets, setTypeLabel } from "../src/client/setCatalog";
import { lookupInCatalog } from "../src/client/setLookup";

const set = (code: string, name: string, set_type = "expansion", released_at = "2020-01-01", extra: Partial<ScryfallSet> = {}): ScryfallSet => ({
  code,
  name,
  set_type,
  released_at,
  card_count: 100,
  ...extra,
});

const CATALOG = [
  set("dsk", "Duskmourn: House of Horror", "expansion", "2024-09-27"),
  set("dsc", "Duskmourn: House of Horror Commander", "commander", "2024-09-27"),
  set("tdsk", "Duskmourn: House of Horror Tokens", "token", "2024-09-27"),
  set("mh3", "Modern Horizons 3", "draft_innovation", "2024-06-14"),
  set("mh2", "Modern Horizons 2", "draft_innovation", "2021-06-18"),
  set("wth", "Weatherlight", "expansion", "1997-06-09"),
  set("lea", "Limited Edition Alpha", "core", "1993-08-05"),
  set("sld", "Secret Lair Drop", "box", "2019-12-02"),
  set("vma", "Vintage Masters", "masters", "2014-06-16", { digital: true }),
  set("pfra", "Reality Fracture Promos", "promo", "2026-09-01"),
  set("zzz9", "Upcoming Thing", "expansion", "2027-01-01", { card_count: 0 }),
];
const codes = (sets: ScryfallSet[]) => sets.map((s) => s.code);

describe("searchSets", () => {
  it("lists booster sets newest first for an empty query", () => {
    expect(codes(searchSets(CATALOG, "", false))).toEqual(["dsk", "mh3", "mh2", "wth", "lea"]);
  });

  it("ranks exact code, code prefix, name word, then anywhere in the name", () => {
    expect(codes(searchSets(CATALOG, "mh3", false))).toEqual(["mh3"]);
    expect(codes(searchSets(CATALOG, "MH", false))).toEqual(["mh3", "mh2"]);
    expect(codes(searchSets(CATALOG, "horizons", false))).toEqual(["mh3", "mh2"]);
    expect(codes(searchSets(CATALOG, "alpha", false))).toEqual(["lea"]);
    expect(codes(searchSets(CATALOG, "set:wth", false))).toEqual(["wth"]);
    expect(codes(searchSets(CATALOG, "modern 2", false))).toEqual(["mh2"]);
  });

  it("hides other products unless asked, and never offers undraftable sets", () => {
    expect(codes(searchSets(CATALOG, "duskmourn", false))).toEqual(["dsk"]);
    expect(codes(searchSets(CATALOG, "duskmourn", true))).toEqual(["dsk", "dsc"]);
    expect(codes(searchSets(CATALOG, "sld", false))).toEqual(["sld"]); // an exact code always shows
    expect(codes(searchSets(CATALOG, "", true))).not.toContain("pfra");
    expect(codes(searchSets(CATALOG, "", true))).not.toContain("zzz9");
  });

  it("treats digital and non-booster types as other products", () => {
    expect(isBoosterSet(CATALOG[0])).toBe(true);
    expect(isBoosterSet(CATALOG.find((s) => s.code === "vma")!)).toBe(false);
    expect(isBoosterSet(CATALOG.find((s) => s.code === "sld")!)).toBe(false);
    expect(setTypeLabel("draft_innovation")).toBe("Draft innovation");
    expect(setTypeLabel("core")).toBe("Core set");
  });
});

describe("lookupInCatalog", () => {
  it("answers known codes without Scryfall", () => {
    expect(lookupInCatalog("DSK", CATALOG)).toMatchObject({ state: "ok", code: "dsk" });
    expect(lookupInCatalog("tdsk", CATALOG)).toMatchObject({ state: "bad", message: expect.stringMatching(/token set/) });
    expect(lookupInCatalog("", CATALOG)).toEqual({ state: "idle" });
  });

  it("asks the host to choose when the text matches names", () => {
    expect(lookupInCatalog("dusk", CATALOG)).toEqual({ state: "choose", count: 2 });
    expect(lookupInCatalog("horizons", CATALOG)).toEqual({ state: "choose", count: 2 });
  });

  it("falls back to Scryfall for a code the cached list doesn't know, and rejects nonsense", () => {
    expect(lookupInCatalog("new1", CATALOG)).toEqual({ code: "new1" });
    expect(lookupInCatalog("not a set at all", CATALOG)).toEqual({ state: "bad", message: 'No set matches "not a set at all".' });
  });
});

describe("loadSetCatalog", () => {
  beforeEach(resetSetCatalog);

  it("fetches the list once and keeps only what the picker needs", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response(JSON.stringify({ data: [{ ...CATALOG[0], id: "x", uri: "https://…", search_uri: "https://…", digital: false }] }));
    }) as typeof fetch;
    const [a, b] = await Promise.all([loadSetCatalog(fetchFn), loadSetCatalog(fetchFn)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a[0]).toEqual({ code: "dsk", name: "Duskmourn: House of Horror", set_type: "expansion", released_at: "2024-09-27", card_count: 100, icon_svg_uri: undefined });
    await loadSetCatalog(fetchFn);
    expect(calls).toBe(1);
  });

  it("lets a failed load be retried", async () => {
    const down = (async () => new Response("", { status: 503 })) as typeof fetch;
    await expect(loadSetCatalog(down)).rejects.toThrow(/503/);
    const up = (async () => new Response(JSON.stringify({ data: [CATALOG[5]] }))) as typeof fetch;
    expect(codes(await loadSetCatalog(up))).toEqual(["wth"]);
  });
});
