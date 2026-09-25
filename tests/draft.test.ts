import { describe, expect, it } from "vitest";
import { advance, createDraft, makePick, nextDeadline, passTarget, validatePool, type DraftEnv } from "../src/shared/draft";
import { DEFAULT_CONFIG, type DraftConfig } from "../src/shared/types";
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
    expect(validatePool(179, 4, DEFAULT_CONFIG.draft)).toMatch(/Need 180/);
    expect(validatePool(180, 4, DEFAULT_CONFIG.draft)).toBeNull();
    expect(validatePool(10, 4, { ...DEFAULT_CONFIG.draft, allowDuplicates: true })).toBeNull();
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
