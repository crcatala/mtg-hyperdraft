// Wire protocol between browser and room Durable Object.
// Client messages are validated with zod on the server; server messages are trusted by the client.

import { z } from "zod";
import type {
  CardInstance,
  CardMap,
  DeckState,
  LobbyConfig,
  Phase,
  Player,
  ImportStatus,
  TableState,
  BasicCounts,
} from "./types";

const id = z.string().min(1).max(64);
const basicCounts = z.object({
  W: z.number().int().min(0).max(99),
  U: z.number().int().min(0).max(99),
  B: z.number().int().min(0).max(99),
  R: z.number().int().min(0).max(99),
  G: z.number().int().min(0).max(99),
  C: z.number().int().min(0).max(99),
});
const color = z.enum(["W", "U", "B", "R", "G"]);
const zone = z.enum(["library", "hand", "battlefield", "graveyard", "exile", "sideboard"]);
const coord = z.number().finite().min(-200).max(200);
const tokenDef = z.object({
  name: z.string().max(40),
  power: z.string().max(4).optional(),
  toughness: z.string().max(4).optional(),
  colors: z.array(color).max(5),
  text: z.string().max(200).optional(),
});

export const tableActionSchema = z.discriminatedUnion("a", [
  z.object({ a: z.literal("move"), ids: z.array(id).min(1).max(100), to: zone, x: coord.optional(), y: coord.optional(), bottom: z.boolean().optional(), faceDown: z.boolean().optional(), face: z.number().int().min(0).max(3).optional() }),
  z.object({ a: z.literal("setPos"), id, x: coord, y: coord }),
  z.object({ a: z.literal("place"), cards: z.array(z.object({ id, x: coord, y: coord })).min(1).max(100) }),
  z.object({ a: z.literal("tap"), ids: z.array(id).min(1).max(100), tapped: z.boolean().optional() }),
  z.object({ a: z.literal("untapAll") }),
  z.object({ a: z.literal("flip"), ids: z.array(id).min(1).max(100) }),
  z.object({ a: z.literal("turnFace"), id }),
  z.object({ a: z.literal("draw"), n: z.number().int().min(1).max(60) }),
  z.object({ a: z.literal("shuffle") }),
  z.object({ a: z.literal("mill"), n: z.number().int().min(1).max(60) }),
  z.object({ a: z.literal("peek"), n: z.number().int().min(0).max(500) }),
  z.object({ a: z.literal("life"), playerId: id, delta: z.number().int().min(-999).max(999) }),
  z.object({ a: z.literal("poison"), playerId: id, delta: z.number().int().min(-99).max(99) }),
  z.object({ a: z.literal("counter"), id, kind: z.string().max(24), delta: z.number().int().min(-99).max(99) }),
  z.object({ a: z.literal("token"), token: tokenDef.optional(), cardId: id.optional(), x: coord.optional(), y: coord.optional(), count: z.number().int().min(1).max(20).optional() }),
  z.object({ a: z.literal("clone"), id }),
  z.object({ a: z.literal("mulligan") }),
  z.object({ a: z.literal("nextTurn") }),
  z.object({ a: z.literal("roll"), sides: z.number().int().min(2).max(100) }),
  z.object({ a: z.literal("reveal"), ids: z.array(id).min(1).max(100) }),
]);

const draftConfigPatch = z
  .object({
    packsPerPlayer: z.number().int().min(1).max(6),
    cardsPerPack: z.number().int().min(2).max(30),
    picksPerTurn: z.number().int().min(1).max(5),
    burnsPerTurn: z.number().int().min(0).max(5),
    passPattern: z.enum(["alternate", "left"]),
    pickTimerSec: z.number().int().min(0).max(600),
    timerStyle: z.enum(["fixed", "shrinking"]),
    allowDuplicates: z.boolean(),
    foilChance: z.number().min(0).max(1),
  })
  .partial();
const gameConfigPatch = z
  .object({
    startingLife: z.number().int().min(1).max(999),
    minDeckSize: z.number().int().min(1).max(200),
    openingHandSize: z.number().int().min(0).max(20),
  })
  .partial();

export const DEBUG_COMMANDS = ["autoPickMe", "finishDraft", "startGame", "toLobby", "autoBuildMe"] as const;
export type DebugCommand = (typeof DEBUG_COMMANDS)[number];

export const clientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("setName"), name: z.string().trim().min(1).max(24) }),
  z.object({ t: z.literal("setReady"), ready: z.boolean() }),
  z.object({ t: z.literal("config"), draft: draftConfigPatch.optional(), game: gameConfigPatch.optional() }),
  z.object({ t: z.literal("import"), source: z.string().min(1).max(200_000) }),
  z.object({ t: z.literal("addBot") }),
  z.object({ t: z.literal("kick"), playerId: id }),
  z.object({ t: z.literal("pick"), packId: id, picks: z.array(id).max(5), burns: z.array(id).max(5) }),
  z.object({ t: z.literal("deck"), main: z.array(id).max(400), side: z.array(id).max(400), basics: basicCounts }),
  z.object({ t: z.literal("deckReady"), ready: z.boolean() }),
  z.object({ t: z.literal("table"), action: tableActionSchema }),
  z.object({ t: z.literal("drag"), id, x: coord, y: coord }),
  z.object({ t: z.literal("point"), x: coord, y: coord }),
  z.object({ t: z.literal("debug"), cmd: z.enum(DEBUG_COMMANDS) }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// --- Server → client --------------------------------------------------------------------------

export interface DraftSeatView {
  playerId: string;
  name: string;
  isBot: boolean;
  queued: number;
  picks: number;
}

export interface DraftView {
  round: number;
  packsPerPlayer: number;
  cardsPerPack: number;
  seat: number;
  seats: DraftSeatView[];
  pack: { id: string; cards: string[]; picksTaken: number; round: number; deadline?: number } | null;
  need: { picks: number; burns: number };
  passDirection: "left" | "right";
  picks: string[];
  done: boolean;
}

export interface CubeSummary {
  name: string;
  source: string;
  size: number;
  uniqueCards: number;
  notFound: string[];
  warnings: string[];
  importedAt: number;
}

export interface RoomView {
  code: string;
  phase: Phase;
  you: string;
  players: Player[];
  config: LobbyConfig;
  cube: CubeSummary | null;
  importStatus: ImportStatus;
  /** Why the draft can't start yet (pool too small etc.), or null. */
  startBlocker: string | null;
  draft: DraftView | null;
  deck: DeckState | null;
  deckStatus: Record<string, { ready: boolean; size: number }>;
  basicIds: Partial<Record<keyof BasicCounts, string>>;
  /** Instances the viewer can currently see (their pack, picks, deck). */
  instances: Record<string, CardInstance>;
  table: TableState | null;
  /** Public rooms only: when the room closes for good (it can close sooner if everyone leaves). */
  expiresAt: number | null;
  serverNow: number;
}

export type ServerMessage =
  | { t: "welcome"; you: string; secret: string; code: string }
  /** Sent before closing with CLOSE.claim: the game has started, pick a free seat to rejoin. */
  | { t: "claim"; seats: { id: string; name: string }[] }
  /**
   * The server is ending this session for good (e.g. the room was deleted). Sent right before the
   * close so the client can stop at once: the close event itself can lag behind by seconds while the
   * closing handshake finishes.
   */
  | { t: "closed"; code: number; message: string }
  | { t: "state"; view: RoomView }
  | { t: "cards"; cards: CardMap }
  | { t: "drag"; by: string; id: string; x: number; y: number }
  | { t: "point"; by: string; x: number; y: number }
  | { t: "error"; message: string }
  | { t: "pong" };

/** WebSocket close codes the server uses. Any 4xxx close is final: the client doesn't retry. */
export const CLOSE = {
  refused: 4403,
  notFound: 4404,
  claim: 4409,
  deleted: 4410,
  /** A public room reached its time limit, or sat empty too long. */
  expired: 4411,
  /** Closed for flooding the room with messages. */
  flood: 4429,
  offline: 4503,
} as const;
