import { describe, expect, it } from "vitest";
import { fetchCubeCobra, normalizeName, resolveEntries, toCardData, type ScryfallCard } from "../src/shared/cardSources";

function scry(name: string, extra: Partial<ScryfallCard> = {}): ScryfallCard {
  const id = `id-${name.toLowerCase().replace(/\W+/g, "-")}`;
  return { id, name, layout: "normal", rarity: "common", set: "tst", collector_number: "1", mana_cost: "{R}", type_line: "Instant", colors: ["R"], ...extra };
}

const DB = [
  scry("Lightning Bolt"),
  scry("Lim-Dûl's Vault"),
  scry("Delver of Secrets // Insectile Aberration", {
    layout: "transform",
    mana_cost: undefined,
    card_faces: [
      { name: "Delver of Secrets", mana_cost: "{U}", type_line: "Creature", colors: ["U"], image_uris: { normal: "front.jpg" } },
      { name: "Insectile Aberration", mana_cost: "", type_line: "Creature", colors: ["U"], image_uris: { normal: "back.jpg" } },
    ],
  }),
];

function fakeFetch(log: string[]) {
  return async (url: string, init?: RequestInit) => {
    log.push(url);
    if (url.endsWith("/cards/collection")) {
      const ids = JSON.parse(String(init!.body)).identifiers as { name?: string; id?: string }[];
      const data = ids
        .map((ident) => DB.find((c) => c.id === ident.id || normalizeName(c.name) === normalizeName(ident.name ?? "") || c.card_faces?.some((f) => f.name === ident.name)))
        .filter(Boolean);
      return new Response(JSON.stringify({ data, not_found: [] }));
    }
    if (url.includes("/cards/named?fuzzy=")) {
      const q = decodeURIComponent(url.split("fuzzy=")[1]);
      return q === "lightnin bolt" ? new Response(JSON.stringify(DB[0])) : new Response("{}", { status: 404 });
    }
    return new Response("nope", { status: 500 });
  };
}

describe("resolveEntries", () => {
  it("resolves names, face names, accents, fuzzy typos and reports misses", async () => {
    const log: string[] = [];
    const res = await resolveEntries(
      [
        { name: "Lightning Bolt", count: 2 },
        { name: "lim-dul's vault", count: 1 },
        { name: "Delver of Secrets", count: 1 },
        { name: "lightnin bolt", count: 1 },
        { name: "Not A Card", count: 1 },
      ],
      fakeFetch(log),
      { delayMs: 0 },
    );
    expect(res.pool).toEqual(["id-lightning-bolt", "id-lightning-bolt", "id-lim-d-l-s-vault", "id-delver-of-secrets-insectile-aberration", "id-lightning-bolt"]);
    expect(res.notFound).toEqual(["Not A Card"]);
    expect(res.warnings.some((w) => w.includes("matched as"))).toBe(true);
    expect(res.cards).toHaveLength(3);
  });

  it("batches collection requests at 75", async () => {
    const log: string[] = [];
    const entries = Array.from({ length: 160 }, () => ({ name: "Lightning Bolt", count: 1 }));
    await resolveEntries(entries, fakeFetch(log), { delayMs: 0 });
    expect(log.filter((u) => u.endsWith("/cards/collection"))).toHaveLength(3);
  });
});

describe("toCardData", () => {
  it("keeps per-face images for double-faced cards", () => {
    const card = toCardData(DB[2]);
    expect(card.images?.normal).toBe("front.jpg");
    expect(card.faces?.[1].images?.normal).toBe("back.jpg");
    expect(card.manaCost).toBe("{U}");
  });
});

describe("fetchCubeCobra", () => {
  it("maps mainboard cards to id entries with elo", async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ name: "Test Cube", cards: { mainboard: [{ cardID: "abc", details: { name: "Bolt", elo: 1500 } }] } }));
    const cube = await fetchCubeCobra("x", fetchFn);
    expect(cube).toEqual({ name: "Test Cube", entries: [{ id: "abc", name: "Bolt", count: 1, elo: 1500 }] });
  });
});
