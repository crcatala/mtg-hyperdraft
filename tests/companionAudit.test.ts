import { describe, expect, it } from "vitest";
import { companionKit, REACTION_IDS, VOICE_SLOT_IDS } from "../src/shared/companionKit";
import { COMPANION_IDS } from "../src/shared/roster";
import { reactionFor } from "../src/client/table/companionReactions";

// The "Living companions" epic's inventory, checked against what actually shipped: per companion, 16 voice slots
// (hello, 7 pokes, pick-up, drop, 6 emotes), 15 speech lines (no line for hello) and 18 reactions (the voice slots
// plus the sulk and the carry loop). Prints the counts (see them with
// `npx vitest run tests/companionAudit.test.ts --reporter=verbose`) and fails naming whatever is missing.

const EPIC = { companions: 10, voiceSlots: 16, lines: 15, reactions: 18 };

// Keys only: the voice files on disk, as "/public/sfx/companions/<id>/<slot>[-<take>].mp3".
const mp3s = Object.keys(import.meta.glob("/public/sfx/companions/*/*.mp3"));

interface Row {
  companion: string;
  voiceSlots: number;
  voiceFiles: number;
  lines: number;
  reactions: number;
  missing: string[];
}

function audit(id: string): Row {
  const files = mp3s.filter((f) => f.split("/")[4] === id).map((f) => f.split("/")[5].replace(/(-\d+)?\.mp3$/, ""));
  const voiced = VOICE_SLOT_IDS.filter((s) => files.includes(s));
  const lines = companionKit(id)?.lines;
  const said = lines ? [...lines.poke, lines.pickup, lines.drop, ...lines.emote].filter((l) => typeof l === "string" && l.trim().length > 0) : [];
  const moves = REACTION_IDS.filter((s) => reactionFor(id, s));
  const missing = [
    ...VOICE_SLOT_IDS.filter((s) => !voiced.includes(s)).map((s) => `voice ${s}`),
    ...(said.length < EPIC.lines ? [`${EPIC.lines - said.length} line(s)`] : []),
    ...REACTION_IDS.filter((s) => !moves.includes(s)).map((s) => `reaction ${s}`),
  ];
  return { companion: id, voiceSlots: voiced.length, voiceFiles: files.length, lines: said.length, reactions: moves.length, missing };
}

describe("companion inventory audit", () => {
  const rows = COMPANION_IDS.map(audit);
  const total = (k: "voiceSlots" | "voiceFiles" | "lines" | "reactions") => rows.reduce((n, r) => n + r[k], 0);

  it("matches the epic: 10 companions × (16 voice slots, 15 lines, 18 reactions) = 160 / 150 / 180", () => {
    console.table(rows.map(({ missing, ...r }) => ({ ...r, missing: missing.join(", ") || "-" })));
    console.log(`totals: ${rows.length} companions, ${total("voiceSlots")} voice slots in ${total("voiceFiles")} files, ${total("lines")} lines, ${total("reactions")} reactions`);

    expect(rows.flatMap((r) => r.missing.map((m) => `${r.companion}: ${m}`))).toEqual([]);
    expect(rows).toHaveLength(EPIC.companions);
    expect(total("voiceSlots")).toBe(EPIC.companions * EPIC.voiceSlots);
    expect(total("lines")).toBe(EPIC.companions * EPIC.lines);
    expect(total("reactions")).toBe(EPIC.companions * EPIC.reactions);
  });

  it("ships no stray voice files (only known slots, only known companions)", () => {
    const stray = mp3s.filter((f) => {
      const [, , , , id, file] = f.split("/");
      return !COMPANION_IDS.includes(id) || !VOICE_SLOT_IDS.includes(file.replace(/(-\d+)?\.mp3$/, ""));
    });
    expect(stray).toEqual([]);
    // At least one file per slot, and the extra takes (hello, poke 1, poke 2) on top.
    expect(total("voiceFiles")).toBeGreaterThanOrEqual(EPIC.companions * EPIC.voiceSlots);
  });
});
