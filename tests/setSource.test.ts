import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "../src/shared/cardSources";
import { checkSet, fetchSetCards, mainSetPrintings, setProblem, type ScryfallSet } from "../src/shared/setSource";
import { importCube } from "../src/shared/importCube";
import { readSetInput } from "../src/client/setLookup";

let n = 0;
function print(name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  n++;
  return {
    id: `id-${n}`,
    oracle_id: `oracle-${name}`,
    name,
    layout: "normal",
    rarity: "common",
    set: "tst",
    collector_number: String(n),
    type_line: "Creature — Test",
    colors: [],
    booster: true,
    ...extra,
  };
}

const SET: ScryfallSet = { code: "tst", name: "Testing Grounds", set_type: "expansion", released_at: "2024-08-02", card_count: 9 };

describe("mainSetPrintings", () => {
  it("keeps one plain booster printing per card", () => {
    const cards = [
      print("Bolt"),
      print("Bolt", { frame_effects: ["showcase"] }),
      print("Bolt", { border_color: "borderless" }),
      print("Bolt", { frame_effects: ["extendedart"] }),
      print("Bear"),
      print("Bear"), // a second art of an old common
      print("Promo Guy", { promo: true, booster: false }),
      print("Deck Only", { booster: false }),
      print("Variant", { variation: true }),
      print("Plains", { type_line: "Basic Land — Plains" }),
      print("Snow-Covered Forest", { type_line: "Basic Snow Land — Forest" }),
      print("Goblin", { layout: "token", type_line: "Token Creature — Goblin" }),
    ];
    expect(mainSetPrintings(cards).map((c) => c.name)).toEqual(["Bolt", "Bear", "Snow-Covered Forest"]);
    expect(mainSetPrintings(cards)[0].id).toBe(cards[0].id);
  });

  it("uses every printing when a set has no boosters (precons, starter sets)", () => {
    const cards = [print("Commander", { booster: false }), print("Sol Ring", { booster: false }), print("Sol Ring", { booster: false, promo: true })];
    expect(mainSetPrintings(cards).map((c) => c.name)).toEqual(["Commander", "Sol Ring"]);
  });

  it("tells double-faced cards apart by their face oracle ids", () => {
    const face = (name: string) => ({ name, oracle_id: `oracle-${name}` });
    const cards = [print("A // B", { oracle_id: undefined, card_faces: [face("A"), face("B")] }), print("C // D", { oracle_id: undefined, card_faces: [face("C"), face("D")] })];
    expect(mainSetPrintings(cards)).toHaveLength(2);
  });
});

describe("setProblem", () => {
  it("accepts draftable sets", () => {
    expect(setProblem(SET)).toBeNull();
    expect(setProblem({ ...SET, set_type: "core" })).toBeNull();
    expect(setProblem({ ...SET, set_type: "commander" })).toBeNull();
  });

  it("explains why other sets can't be drafted", () => {
    expect(setProblem({ ...SET, code: "twth", name: "Weatherlight Tokens", set_type: "token" })).toMatch(/Weatherlight Tokens \(TWTH\) is a token set/);
    expect(setProblem({ ...SET, set_type: "memorabilia" })).toMatch(/memorabilia/);
    expect(setProblem({ ...SET, set_type: "promo" })).toMatch(/main set's code/);
    expect(setProblem({ ...SET, card_count: 0 })).toMatch(/no cards on Scryfall yet/);
  });
});

function scryfall(cards: ScryfallCard[], set: ScryfallSet | null = SET, pageSize = 2) {
  const log: string[] = [];
  const fetchFn = async (url: string) => {
    log.push(url);
    if (url.includes("/sets/")) return set ? new Response(JSON.stringify(set)) : new Response("{}", { status: 404 });
    if (url.includes("/cards/search")) {
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      const data = cards.slice((page - 1) * pageSize, page * pageSize);
      if (data.length === 0) return new Response("{}", { status: 404 });
      const more = page * pageSize < cards.length;
      return new Response(JSON.stringify({ data, has_more: more, next_page: more ? `${url.replace(/&page=\d+/, "")}&page=${page + 1}` : undefined }));
    }
    if (url.endsWith("/cards/collection")) return new Response(JSON.stringify({ data: [] }));
    return new Response("nope", { status: 500 });
  };
  return { log, fetchFn };
}

describe("checkSet", () => {
  it("returns the set for a good code", async () => {
    const { fetchFn, log } = scryfall([]);
    expect(await checkSet("tst", fetchFn)).toEqual({ ok: true, set: SET });
    expect(log).toEqual(["https://api.scryfall.com/sets/tst"]);
  });

  it("reports unknown codes, undraftable sets and network trouble", async () => {
    expect(await checkSet("zzz", scryfall([], null).fetchFn)).toEqual({ ok: false, message: 'No Magic set has the code "ZZZ".' });
    expect(await checkSet("tst", scryfall([], { ...SET, set_type: "token" }).fetchFn)).toMatchObject({ ok: false, message: expect.stringMatching(/token set/) });
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await checkSet("tst", offline)).toMatchObject({ ok: false, retry: true });
    expect(await checkSet("tst", async () => new Response("", { status: 503 }))).toMatchObject({ ok: false, retry: true });
  });
});

describe("fetchSetCards", () => {
  it("pages through the set and keeps the main printings", async () => {
    const cards = [print("One"), print("Two"), print("Two", { frame_effects: ["showcase"] }), print("Three"), print("Plains", { type_line: "Basic Land — Plains" })];
    const { fetchFn, log } = scryfall(cards);
    const progress: string[] = [];
    const res = await fetchSetCards("tst", fetchFn, (m) => progress.push(m), 0);
    expect(res.cards.map((c) => c.name)).toEqual(["One", "Two", "Three"]);
    expect(res.warnings).toEqual([expect.stringMatching(/3 main-set cards; skipped 2 other printing/)]);
    expect(log.filter((u) => u.includes("/cards/search"))).toHaveLength(3);
    expect(log[1]).toContain("q=set%3Atst&unique=prints");
    expect(progress[0]).toBe("Looking up set TST on Scryfall…");
  });

  it("fails readably for unknown and empty sets", async () => {
    await expect(fetchSetCards("zzz", scryfall([], null).fetchFn, undefined, 0)).rejects.toThrow('No Magic set has the code "ZZZ".');
    await expect(fetchSetCards("tst", scryfall([]).fetchFn, undefined, 0)).rejects.toThrow(/Testing Grounds \(TST\) has no regular booster cards/);
  });
});

describe("importCube with a set code", () => {
  it("imports the whole set as the cube", async () => {
    const cards = [print("One"), print("Two"), print("Three")];
    const res = await importCube("set:TST", scryfall(cards, SET, 175).fetchFn, () => {});
    expect(res.name).toBe("Testing Grounds (TST)");
    expect(res.source).toBe("set:tst");
    expect(res.pool).toEqual(cards.map((c) => c.id));
    expect(res.cards.map((c) => c.name)).toEqual(["One", "Two", "Three"]);
    expect(res.notFound).toEqual([]);
  });

  it("rejects a malformed code before calling Scryfall", async () => {
    const { fetchFn, log } = scryfall([]);
    await expect(importCube("set: not-a-set", fetchFn, () => {})).rejects.toThrow(/isn't a set code/);
    expect(log).toEqual([]);
  });
});

describe("readSetInput", () => {
  it("waits while typing, flags malformed codes and passes good ones through", () => {
    expect(readSetInput("")).toEqual({ state: "idle" });
    expect(readSetInput("m")).toEqual({ state: "idle" });
    expect(readSetInput("mh")).toEqual({ state: "idle" });
    expect(readSetInput(" MH3 ")).toEqual({ code: "mh3" });
    expect(readSetInput("set:wth")).toEqual({ code: "wth" });
    expect(readSetInput("toolong")).toMatchObject({ state: "bad" });
    expect(readSetInput("w-th")).toMatchObject({ state: "bad" });
  });
});
