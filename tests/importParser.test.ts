import { describe, expect, it } from "vitest";
import { normalizeSetCode, parseImport, parseLine, splitCsvLine } from "../src/shared/importParser";

describe("parseImport", () => {
  it("detects CubeCobra URLs and prefixed ids", () => {
    expect(parseImport("https://cubecobra.com/cube/list/vintage")).toEqual({ kind: "cubecobra", id: "vintage" });
    expect(parseImport("https://cubecobra.com/cube/overview/LSVCube?tab=1")).toEqual({ kind: "cubecobra", id: "LSVCube" });
    expect(parseImport("https://cubecobra.com/c/629d64a43f631e4104551365")).toEqual({ kind: "cubecobra", id: "629d64a43f631e4104551365" });
    expect(parseImport("cubecobra: thepaupercube")).toEqual({ kind: "cubecobra", id: "thepaupercube" });
  });

  it("detects whole-set imports", () => {
    expect(parseImport("set:WTH")).toEqual({ kind: "set", code: "wth" });
    expect(parseImport("  set: mh3 ")).toEqual({ kind: "set", code: "mh3" });
    expect(parseImport("e:plst")).toEqual({ kind: "set", code: "plst" });
    expect(parseImport("https://scryfall.com/sets/dsk")).toEqual({ kind: "set", code: "dsk" });
    expect(parseImport("scryfall.com/sets/BLB?order=set")).toEqual({ kind: "set", code: "blb" });
    expect(() => parseImport("set:way-too-long")).toThrow(/isn't a set code/);
    // A one-card list is still a list, even when the name looks like a code.
    expect(parseImport("Opt")).toMatchObject({ kind: "list", entries: [{ name: "Opt" }] });
  });

  it("normalizes set codes", () => {
    expect(normalizeSetCode(" WTH ")).toBe("wth");
    expect(normalizeSetCode("set:MH3")).toBe("mh3");
    expect(normalizeSetCode("ab")).toBeNull();
    expect(normalizeSetCode("abcdefg")).toBeNull();
    expect(normalizeSetCode("w th")).toBeNull();
  });

  it("parses plain names, counts, comments and sections", () => {
    const src = parseImport(`// my cube
Lightning Bolt
2 Counterspell
3x Llanowar Elves
Delver of Secrets // Insectile Aberration

Sideboard
Duress
`);
    expect(src.kind).toBe("list");
    if (src.kind !== "list") return;
    expect(src.entries).toEqual([
      { name: "Lightning Bolt", count: 1, set: undefined, collectorNumber: undefined },
      { name: "Counterspell", count: 2, set: undefined, collectorNumber: undefined },
      { name: "Llanowar Elves", count: 3, set: undefined, collectorNumber: undefined },
      { name: "Delver of Secrets", count: 1, set: undefined, collectorNumber: undefined },
    ]);
    expect(src.warnings[0]).toMatch(/Skipped 1/);
  });

  it("merges duplicate lines", () => {
    const src = parseImport("Island\nIsland\n2 Island");
    expect(src.kind === "list" && src.entries).toEqual([{ name: "Island", count: 4, set: undefined, collectorNumber: undefined }]);
  });

  it("parses printings", () => {
    expect(parseLine("1 Lightning Bolt (M10) 146")).toEqual({ name: "Lightning Bolt", count: 1, set: "m10", collectorNumber: "146" });
    expect(parseLine("Jackknight [ust-11]")).toEqual({ name: "Jackknight", count: 1, set: "ust", collectorNumber: "11" });
    expect(parseLine("Lightning Bolt [M10]")).toEqual({ name: "Lightning Bolt", count: 1, set: "m10", collectorNumber: undefined });
    expect(parseLine("1 Brazen Borrower (ELD) 39 *F*")).toMatchObject({ name: "Brazen Borrower", set: "eld", foil: true });
  });

  it("parses CubeCobra CSV exports and skips maybeboard", () => {
    const csv = `name,CMC,Type,Color,Set,Collector Number,Rarity,Color Category,status,Finish,maybeboard,image URL
"Fire // Ice",2,Instant,R,mh2,290,uncommon,Multicolored,Owned,Non-foil,false,
"Brazen Borrower",3,"Creature — Faerie Rogue",U,eld,39,mythic,Blue,Owned,Non-foil,false,
Duress,1,Sorcery,B,m19,94,common,Black,Owned,Non-foil,true,`;
    const src = parseImport(csv);
    expect(src.kind === "list" && src.entries).toEqual([
      { name: "Fire", count: 1, set: "mh2", collectorNumber: "290" },
      { name: "Brazen Borrower", count: 1, set: "eld", collectorNumber: "39" },
    ]);
  });

  it("splits quoted CSV cells", () => {
    expect(splitCsvLine('a,"b, c","d ""q"""')).toEqual(["a", "b, c", 'd "q"']);
  });
});
