import { describe, expect, it } from "vitest";
import {
  createBlocker,
  emptyLedger,
  expiredRooms,
  INVITE_LIMITS,
  inviteLabelFor,
  parseInviteCodes,
  pruneWindow,
  quotaInfo,
  type RoomRecord,
} from "../src/shared/invites";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function record(code: string, lastActiveAt: number): RoomRecord {
  return { code, createdAt: lastActiveAt, lastActiveAt, phase: "lobby", players: [], bots: 0, cubeName: null, cardCount: 0 };
}

describe("invite codes", () => {
  it("parses label:key pairs and skips malformed entries", () => {
    const invites = parseInviteCodes(" Sam:abcdefgh1 , jo:short,\nno-colon, bad label:abcdefghij\nkim:k:with:colons ");
    expect(invites).toEqual([
      { label: "sam", key: "abcdefgh1" },
      { label: "kim", key: "k:with:colons" },
    ]);
    expect(parseInviteCodes(undefined)).toEqual([]);
  });

  it("maps keys to labels", () => {
    const invites = parseInviteCodes("sam:abcdefgh1,jo:zyxwvuts9");
    expect(inviteLabelFor(invites, "zyxwvuts9")).toBe("jo");
    expect(inviteLabelFor(invites, "abcdefgh")).toBeNull();
    expect(inviteLabelFor(invites, "abcdefgh12")).toBeNull();
    expect(inviteLabelFor(invites, "")).toBeNull();
    expect(inviteLabelFor([], "abcdefgh1")).toBeNull();
  });
});

describe("invite ledger quotas", () => {
  it("allows 10 rooms per rolling 24 hours", () => {
    const ledger = emptyLedger("sam");
    const t0 = 10 * DAY;
    for (let i = 0; i < INVITE_LIMITS.perWindow; i++) {
      expect(createBlocker(ledger, t0 + i * HOUR)).toBeNull();
      ledger.created.push(t0 + i * HOUR);
    }
    const now = t0 + 10 * HOUR;
    expect(createBlocker(ledger, now)).toMatch(/last 24 hours/);
    // The oldest creation (t0) leaves the window 24h later.
    expect(quotaInfo(ledger, now).nextSlotAt).toBe(t0 + DAY);
    expect(createBlocker(ledger, t0 + DAY + 1)).toBeNull();
    pruneWindow(ledger, t0 + DAY + 1);
    expect(ledger.created).toHaveLength(INVITE_LIMITS.perWindow - 1);
  });

  it("caps saved rooms at 25 regardless of the window", () => {
    const ledger = emptyLedger("sam");
    ledger.rooms = Array.from({ length: INVITE_LIMITS.maxRooms }, (_, i) => record(`R${i}`, 0));
    expect(createBlocker(ledger, 100 * DAY)).toMatch(/Delete one/);
    ledger.rooms.pop();
    expect(createBlocker(ledger, 100 * DAY)).toBeNull();
    expect(quotaInfo(ledger, 100 * DAY)).toMatchObject({ rooms: 24, maxRooms: 25, createdInWindow: 0, nextSlotAt: null });
  });

  it("finds rooms idle for more than 90 days", () => {
    const now = 200 * DAY;
    const ledger = emptyLedger("sam");
    ledger.rooms = [record("OLD", now - 91 * DAY), record("EDGE", now - 90 * DAY), record("NEW", now - DAY)];
    expect(expiredRooms(ledger, now).map((r) => r.code)).toEqual(["OLD"]);
  });
});
