import { beforeEach, describe, expect, it } from "vitest";
import { cardHelpTerms, keywordsForFace, rulesLookupUrl, typeTerms } from "../src/client/cardHelp";
import { cachedRulings, clearRulingsCache, fetchRulings, hasRulingsLookup } from "../src/client/rulings";
import { makeCard } from "./fixtures";

const DELVER = makeCard(1, {
  name: "Delver of Secrets // Insectile Aberration",
  layout: "transform",
  typeLine: "Creature — Human Wizard // Creature — Human Insect",
  keywords: ["Flying", "Transform"],
  faces: [
    { name: "Delver of Secrets", manaCost: "{U}", typeLine: "Creature — Human Wizard", oracleText: "At the beginning of your upkeep, look at the top card of your library. If an instant or sorcery card is revealed this way, transform this creature.", colors: ["U"], images: { normal: "front.jpg" } },
    { name: "Insectile Aberration", manaCost: "", typeLine: "Creature — Human Insect", oracleText: "Flying", colors: ["U"], images: { normal: "back.jpg" } },
  ],
});

describe("card help terms", () => {
  it("links to MTG Wiki search, which lands on the exact page when there is one", () => {
    expect(rulesLookupUrl("First strike")).toBe("https://mtg.wiki/index.php?search=First%20strike");
    expect(rulesLookupUrl("Modal double-faced card")).toBe("https://mtg.wiki/index.php?search=Modal%20double-faced%20card");
  });

  it("keeps rules-relevant types and drops creature and land types", () => {
    expect(typeTerms("Legendary Artifact — Equipment")).toEqual(["Legendary", "Artifact", "Equipment"]);
    expect(typeTerms("Creature — Goblin Warrior")).toEqual(["Creature"]);
    expect(typeTerms("Basic Snow Land — Island")).toEqual(["Basic", "Snow", "Land"]);
    expect(typeTerms("Creature — Human Knight // Sorcery — Adventure")).toEqual(["Creature", "Sorcery", "Adventure"]);
    expect(typeTerms("Enchantment Creature — Nymph // Enchantment — Aura")).toEqual(["Enchantment", "Creature", "Aura"]);
    expect(typeTerms("Token Artifact — Treasure")).toEqual(["Token", "Artifact", "Treasure"]);
  });

  it("shows every keyword on a single-faced card, in rules-text order", () => {
    const card = makeCard(2, { keywords: ["Vigilance", "Haste", "Deathtouch"], oracleText: "Vigilance, deathtouch, haste" });
    expect(keywordsForFace(card)).toEqual(["Vigilance", "Deathtouch", "Haste"]);
    const unmentioned = makeCard(8, { keywords: ["Ascend", "Lifelink", "Mill"], oracleText: "Lifelink\nAscend" });
    expect(keywordsForFace(unmentioned)).toEqual(["Lifelink", "Ascend", "Mill"]);
    expect(keywordsForFace(makeCard(3))).toEqual([]);
  });

  it("splits a double-faced card's keywords by the face showing", () => {
    expect(keywordsForFace(DELVER, 0)).toEqual(["Transform"]);
    expect(keywordsForFace(DELVER, 1)).toEqual(["Flying"]);
  });

  it("adds the card's layout and doesn't repeat a type that is also a mechanic", () => {
    expect(cardHelpTerms(DELVER, 1)).toEqual({ mechanics: ["Flying"], types: ["Creature", "Double-faced card"] });
    const treasure = makeCard(4, { typeLine: "Token Artifact — Treasure", keywords: ["Treasure"] });
    expect(cardHelpTerms(treasure)).toEqual({ mechanics: ["Treasure"], types: ["Token", "Artifact"] });
  });
});

describe("rulings", () => {
  const ID = "e41cf82d-3213-47ce-a015-6e51a8b07e4f";
  const beast = makeCard(5, { id: ID, oracleId: "oracle-beast" });
  const reprint = makeCard(6, { id: "0a1b2c3d-3213-47ce-a015-6e51a8b07e4f", oracleId: "oracle-beast" });
  const body = { data: [{ source: "wotc", published_at: "2019-10-04", comment: "It can't be blocked by creatures with power 2 or less." }] };

  beforeEach(() => clearRulingsCache());

  it("only looks up real Scryfall printings", () => {
    expect(hasRulingsLookup(beast)).toBe(true);
    expect(hasRulingsLookup(makeCard(7))).toBe(false);
  });

  it("fetches once per card, on demand, and shares the result across printings", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(body));
    };
    expect(cachedRulings(beast)).toBeUndefined();
    const [a, b] = await Promise.all([fetchRulings(beast, fetchFn), fetchRulings(beast, fetchFn)]);
    expect(a).toEqual([{ source: "wotc", publishedAt: "2019-10-04", comment: body.data[0].comment }]);
    expect(b).toBe(a);
    expect(await fetchRulings(reprint, fetchFn)).toBe(a);
    expect(cachedRulings(reprint)).toBe(a);
    expect(urls).toEqual([`https://api.scryfall.com/cards/${ID}/rulings`]);
  });

  it("doesn't cache a failure, so the player can try again", async () => {
    let fail = true;
    const fetchFn = async () => (fail ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ data: [] })));
    await expect(fetchRulings(beast, fetchFn)).rejects.toThrow("503");
    expect(cachedRulings(beast)).toBeUndefined();
    fail = false;
    expect(await fetchRulings(beast, fetchFn)).toEqual([]);
    expect(cachedRulings(beast)).toEqual([]);
  });
});
