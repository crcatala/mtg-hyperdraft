import { describe, expect, it } from "vitest";
import {
  advance,
  createDraft,
  dealPacks,
  makePick,
  matchesPreset,
  nextDeadline,
  normalizeDraftConfig,
  passTarget,
  poolStats,
  rarityGroup,
  validatePool,
  type DraftEnv,
} from "../src/shared/draft";
import { DEFAULT_CONFIG, DRAFT_PRESETS, type CardMap, type DraftConfig } from "../src/shared/types";
import { mulberry32 } from "../src/shared/rng";
import { makeCube } from "./fixtures";

function env(overrides: Partial<DraftConfig> = {}, now = 0): DraftEnv {
  let n = 0;
  return {
    config: { ...DEFAULT_CONFIG.draft, ...overrides },
    cards: makeCube(400),
    instances: {},
    rng: mulberry32(7),
    now,
    nextId: (p) => `${p}${n++}`,
  };
}
const pool = Array.from({ length: 400 }, (_, i) => `card-${i}`);

describe("draft engine", () => {
  it("validates pool size", () => {
    const stats = (n: number) => poolStats(pool.slice(0, n), makeCube(400));
    expect(validatePool(stats(179), 4, DEFAULT_CONFIG.draft)).toMatch(/Need 180/);
    expect(validatePool(stats(180), 4, DEFAULT_CONFIG.draft)).toBeNull();
    expect(validatePool(stats(15), 4, { ...DEFAULT_CONFIG.draft, allowDuplicates: true })).toBeNull();
    expect(validatePool(stats(10), 4, { ...DEFAULT_CONFIG.draft, allowDuplicates: true })).toMatch(/need 15 different cards/);
  });

  it("alternates pass direction by round", () => {
    const c = DEFAULT_CONFIG.draft;
    expect(passTarget(0, 0, 4, c)).toBe(1);
    expect(passTarget(0, 1, 4, c)).toBe(3);
    expect(passTarget(3, 2, 4, c)).toBe(0);
    expect(passTarget(0, 1, 4, { ...c, passPattern: "left" })).toBe(1);
  });

  it("deals unique singleton packs and gives everyone 45 picks in a 4-seat all-bot draft", () => {
    const e = env();
    const draft = createDraft(["a", "b", "c", "d"], pool, e);
    const all = draft.unopened.flat().flatMap((p) => p.cards.map((iid) => e.instances[iid].cardId));
    expect(new Set(all).size).toBe(180);
    advance(draft, () => true, e);
    expect(draft.done).toBe(true);
    for (const id of ["a", "b", "c", "d"]) expect(draft.picks[id]).toHaveLength(45);
  });

  it("passes packs to the neighbour and queues them while a human thinks", () => {
    const e = env();
    const draft = createDraft(["human", "bot1", "bot2"], pool, e);
    advance(draft, (s) => s !== 0, e);
    // Bots each picked once and passed left; the bot to the human's right passed into the human's queue.
    expect(draft.queues[0].length).toBe(3);
    const pack = draft.queues[0][0];
    makePick(draft, 0, pack.id, [pack.cards[0]], [], e);
    expect(draft.picks.human).toHaveLength(1);
    expect(() => makePick(draft, 0, pack.id, [pack.cards[0]], [], e)).toThrow(/isn't in front of you/);
  });

  it("supports burns", () => {
    const e = env({ burnsPerTurn: 1, cardsPerPack: 6, packsPerPlayer: 1 });
    const draft = createDraft(["a", "b"], pool, e);
    const pack = draft.queues[0][0];
    expect(() => makePick(draft, 0, pack.id, [pack.cards[0]], [], e)).toThrow(/Burn exactly 1/);
    makePick(draft, 0, pack.id, [pack.cards[0]], [pack.cards[1]], e);
    expect(draft.burned).toHaveLength(1);
    advance(draft, () => true, e);
    expect(draft.done).toBe(true);
    expect(draft.picks.a.length + draft.picks.b.length + draft.burned.length).toBe(12);
  });

  it("auto-picks when a timer expires", () => {
    const e = env({ pickTimerSec: 30 }, 1000);
    const draft = createDraft(["a", "b"], pool, e);
    expect(nextDeadline(draft)).toBe(31_000);
    e.now = 31_000;
    const changed = advance(draft, () => false, e);
    expect(changed).toBe(true);
    expect(draft.picks.a).toHaveLength(1);
    expect(draft.log.every((l) => l.auto)).toBe(true);
  });

  it("shrinks timers as packs empty", () => {
    const e = env({ pickTimerSec: 60, timerStyle: "shrinking", cardsPerPack: 15 }, 0);
    const draft = createDraft(["a"], pool, e);
    const pack = draft.queues[0][0];
    expect(pack.deadline).toBe(60_000);
    makePick(draft, 0, pack.id, [pack.cards[0]], [], e);
    expect(draft.queues[0][0].deadline).toBe(56_000);
  });
});

describe("pack building", () => {
  const cards: CardMap = makeCube(400);
  const set = { ...DEFAULT_CONFIG.draft, ...DRAFT_PRESETS.set };
  const rarities = (ids: string[]) => ids.map((id) => rarityGroup(cards[id]));

  it("counts the pool by rarity, copies and distinct cards", () => {
    const stats = poolStats(["card-0", "card-0", "card-3", "card-5", "card-6"], cards);
    expect(stats).toEqual({
      copies: 5,
      unique: 4,
      byRarity: { common: { copies: 2, unique: 1 }, uncommon: { copies: 1, unique: 1 }, rare: { copies: 2, unique: 2 } },
    });
  });

  it("builds set-style packs: commons, then uncommons, then the rare", () => {
    const packs = dealPacks(24, pool, { config: set, cards, rng: mulberry32(3) });
    expect(packs).toHaveLength(24);
    for (const p of packs) {
      expect(rarities(p)).toEqual([...Array(10).fill("common"), "uncommon", "uncommon", "uncommon", "rare"]);
      expect(new Set(p).size).toBe(14);
    }
  });

  it("repeats cards across packs but never within one when duplicates are on", () => {
    const small = pool.slice(0, 40); // ~17 commons, ~11 uncommons, ~12 rares
    const config = { ...set, packSlots: { rare: 1, uncommon: 3, common: 10 } };
    expect(validatePool(poolStats(small, cards), 8, config)).toBeNull();
    const packs = dealPacks(24, small, { config, cards, rng: mulberry32(5) });
    for (const p of packs) expect(new Set(p).size).toBe(p.length);
    expect(new Set(packs.flat()).size).toBeLessThan(packs.flat().length);
  });

  it("deals every copy once without duplicates", () => {
    const config = { ...set, allowDuplicates: false };
    const packs = dealPacks(10, pool, { config, cards, rng: mulberry32(9) });
    expect(new Set(packs.flat()).size).toBe(140);
  });

  it("favours rares over mythics 2:1 in the rare slot", () => {
    const rareSlot = pool.filter((id) => rarityGroup(cards[id]) === "rare"); // equal numbers of rares and mythics
    const config = { ...set, packSlots: { rare: 1, uncommon: 0, common: 0 } };
    const packs = dealPacks(3000, rareSlot, { config, cards, rng: mulberry32(11) });
    const mythics = packs.filter((p) => cards[p[0]].rarity === "mythic").length / packs.length;
    expect(mythics).toBeGreaterThan(0.28);
    expect(mythics).toBeLessThan(0.39);
  });

  it("explains which rarity runs short", () => {
    const commonsOnly = pool.filter((id) => cards[id].rarity === "common").slice(0, 50);
    expect(validatePool(poolStats(commonsOnly, cards), 4, set)).toMatch(/Each pack needs 1 different rares & mythics, but the cube only has 0/);
    const noDupes = { ...set, allowDuplicates: false };
    expect(validatePool(poolStats(pool, cards), 4, noDupes)).toBeNull(); // 172 commons for 120 slots
    expect(validatePool(poolStats(pool, cards), 8, noDupes)).toMatch("24 packs × 10 commons = 240 needed, but the cube has 172. Allow duplicates");
  });

  it("keeps cards per pack in step with the slots and fills in old saved configs", () => {
    expect(normalizeDraftConfig({ ...set, packSlots: { rare: 2, uncommon: 4, common: 9 }, cardsPerPack: 3 }).cardsPerPack).toBe(15);
    const { packSlots: _, mode: __, ...old } = DEFAULT_CONFIG.draft;
    expect(normalizeDraftConfig(old as DraftConfig)).toMatchObject({ mode: "cube", packSlots: null });
  });

  it("tells when the settings have drifted from the picked style", () => {
    expect(matchesPreset(DEFAULT_CONFIG.draft, "cube")).toBe(true);
    expect(matchesPreset(set, "set")).toBe(true);
    expect(matchesPreset({ ...set, packSlots: { rare: 2, uncommon: 3, common: 10 } }, "set")).toBe(false);
    expect(matchesPreset({ ...DEFAULT_CONFIG.draft, allowDuplicates: true }, "cube")).toBe(false);
  });

  it("drafts a full set-style pod", () => {
    const e = { ...env(set), cards };
    const draft = createDraft(["a", "b", "c", "d"], pool.slice(0, 60), e);
    advance(draft, () => true, e);
    expect(draft.done).toBe(true);
    for (const id of ["a", "b", "c", "d"]) expect(draft.picks[id]).toHaveLength(42);
  });
});
