import type { CardData, CardMap, Color, Rarity } from "../src/shared/types";
import type { RoomDeps } from "../src/shared/room";
import { mulberry32 } from "../src/shared/rng";

const COLORS: Color[] = ["W", "U", "B", "R", "G"];
const RARITIES: Rarity[] = ["common", "common", "common", "uncommon", "uncommon", "rare", "mythic"];

export function makeCard(i: number, overrides: Partial<CardData> = {}): CardData {
  const color = COLORS[i % 5];
  return {
    id: `card-${i}`,
    oracleId: `oracle-${i}`,
    name: `Card ${i}`,
    layout: "normal",
    manaCost: `{1}{${color}}`,
    cmc: 2,
    typeLine: "Creature — Test",
    oracleText: "",
    power: "2",
    toughness: "2",
    colors: [color],
    colorIdentity: [color],
    rarity: RARITIES[i % RARITIES.length],
    set: "tst",
    collectorNumber: String(i),
    ...overrides,
  };
}

export function makeCube(n: number): CardMap {
  const cards: CardMap = {};
  for (let i = 0; i < n; i++) cards[`card-${i}`] = makeCard(i);
  const basics: [string, Color | "C"][] = [["Plains", "W"], ["Island", "U"], ["Swamp", "B"], ["Mountain", "R"], ["Forest", "G"], ["Wastes", "C"]];
  for (const [name, c] of basics) {
    cards[`basic-${c}`] = makeCard(0, { id: `basic-${c}`, name, typeLine: `Basic Land — ${name}`, manaCost: "", cmc: 0, colors: [], colorIdentity: [], rarity: "common", power: undefined, toughness: undefined });
  }
  return cards;
}

export const basicIds = { W: "basic-W", U: "basic-U", B: "basic-B", R: "basic-R", G: "basic-G", C: "basic-C" };

export function testDeps(seed = 1): RoomDeps & { advance(ms: number): void } {
  let t = 1_000_000;
  return { now: () => t, rng: mulberry32(seed), advance: (ms: number) => void (t += ms) };
}
