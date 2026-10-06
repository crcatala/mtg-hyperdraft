// Core data model shared by the client and the room Durable Object.
// Everything here must stay JSON-serializable: it is persisted to DO storage and sent over the wire.

export type Rarity = "common" | "uncommon" | "rare" | "mythic" | "special";
export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "mythic", "special"];

export type Color = "W" | "U" | "B" | "R" | "G";
export const COLORS: Color[] = ["W", "U", "B", "R", "G"];
export type BasicLand = Color | "C";
export const BASIC_NAMES: Record<BasicLand, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
  C: "Wastes",
};

export interface CardImages {
  small?: string;
  normal?: string;
  large?: string;
}

export interface CardFaceData {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: Color[];
  /** Present only for layouts where each face has its own printed image (transform, modal DFC, ...). */
  images?: CardImages;
}

/** Trimmed Scryfall card: just what drafting and the tabletop need. Keyed by Scryfall printing id. */
export interface CardData {
  id: string;
  oracleId: string;
  name: string;
  layout: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  /** Scryfall's keyword abilities, keyword actions and ability words (Flying, Scry, Landfall...). */
  keywords?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  colors: Color[];
  colorIdentity: Color[];
  rarity: Rarity;
  set: string;
  collectorNumber: string;
  artist?: string;
  images?: CardImages;
  faces?: CardFaceData[];
  /** CubeCobra draft rating, when the cube came from CubeCobra. */
  elo?: number;
  /** Related tokens (Scryfall `all_parts` with component "token"). */
  tokens?: { id: string; name: string }[];
  /** Synthetic cards (basic lands we add, custom tokens) are not from an import. */
  basic?: BasicLand;
}

export type CardMap = Record<string, CardData>;

/** A physical copy of a card. Drafted cards, added basics and tokens all get instance ids. */
export interface CardInstance {
  iid: string;
  cardId: string;
  foil?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Lobby

export type Phase = "lobby" | "drafting" | "deckbuilding" | "playing";

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  /**
   * Their avatar and table companion (ids from shared/roster.ts). Humans have neither until they
   * choose; bots are dealt both. Several players may hold the same one.
   */
  avatar?: string;
  companion?: string;
  /** Which colour variant they have of it: 0 is the original, and later holders of the same one get different ones. */
  avatarVariant?: number;
  companionVariant?: number;
  /**
   * Where they put their companion down at the table (table coordinates), if they moved it off its home spot
   * by their mat. Set only by a valid drop (setPetPos); cleared by a new game or a new companion.
   */
  companionAt?: { x: number; y: number };
}

export type PassPattern = "alternate" | "left";
export type TimerStyle = "fixed" | "shrinking";

/** "cube": any cards at random. "set": packs built like real boosters. */
export type DraftMode = "cube" | "set";
/** The rarity groups a pack can be built from: the rare slot also holds mythics and specials. */
export type RarityGroup = "rare" | "uncommon" | "common";
export type PackSlots = Record<RarityGroup, number>;

export interface DraftConfig {
  /** The preset the host last picked (DRAFT_PRESETS); the settings it covers may have been tweaked since. */
  mode: DraftMode;
  packsPerPlayer: number;
  cardsPerPack: number;
  picksPerTurn: number;
  burnsPerTurn: number;
  passPattern: PassPattern;
  /** 0 = no time limit. For "shrinking", this is the time for the first pick of a full pack. */
  pickTimerSec: number;
  timerStyle: TimerStyle;
  /** Cards may repeat across packs (never within one pack). */
  allowDuplicates: boolean;
  /** Build every pack from these rarity counts (cardsPerPack is their sum); null = any cards at random. */
  packSlots: PackSlots | null;
  /** Chance that a pack contains one foil card (purely cosmetic). */
  foilChance: number;
}

export interface GameConfig {
  startingLife: number;
  minDeckSize: number;
  openingHandSize: number;
}

export interface LobbyConfig {
  draft: DraftConfig;
  game: GameConfig;
}

export const DEFAULT_CONFIG: LobbyConfig = {
  draft: {
    mode: "cube",
    packsPerPlayer: 3,
    cardsPerPack: 15,
    picksPerTurn: 1,
    burnsPerTurn: 0,
    passPattern: "alternate",
    pickTimerSec: 0,
    timerStyle: "fixed",
    allowDuplicates: false,
    packSlots: null,
    foilChance: 0.35,
  },
  game: {
    startingLife: 20,
    minDeckSize: 40,
    openingHandSize: 7,
  },
};

/** What picking a draft style sets. Everything else (picks, burns, timers, passing) is left alone. */
export const DRAFT_PRESETS: Record<DraftMode, Pick<DraftConfig, "packsPerPlayer" | "cardsPerPack" | "allowDuplicates" | "packSlots">> = {
  cube: { packsPerPlayer: 3, cardsPerPack: 15, allowDuplicates: false, packSlots: null },
  // A draft booster without its basic land: one rare (or mythic), three uncommons, ten commons.
  set: { packsPerPlayer: 3, cardsPerPack: 14, allowDuplicates: true, packSlots: { rare: 1, uncommon: 3, common: 10 } },
};

export const MAX_HUMANS = 4;
export const MAX_SEATS = 8;

export interface CubeInfo {
  name: string;
  source: string;
  /** Pool entries (card id per copy). Singleton cubes list each id once. */
  pool: string[];
  notFound: string[];
  warnings: string[];
  importedAt: number;
  /** Card ids used for the unlimited basic lands in deckbuilding. */
  basics: Partial<Record<BasicLand, string>>;
}

export interface ImportStatus {
  state: "idle" | "running" | "error";
  message?: string;
}

// ---------------------------------------------------------------------------------------------
// Draft

export interface Pack {
  id: string;
  /** Card instance ids still in the pack. */
  cards: string[];
  round: number;
  /** Seat index that opened the pack. */
  openedBy: number;
  /** How many picks have been taken from this pack (drives pick numbers + shrinking timer). */
  picksTaken: number;
  /** Set while the pack sits at the head of a seat's queue and a pick timer is on (epoch ms). */
  deadline?: number;
}

export interface PickRecord {
  seat: number;
  round: number;
  pick: number;
  iid: string;
  auto: boolean;
}

export interface DraftState {
  round: number;
  /** Player ids in seat order. Passing left = seat + 1. */
  seats: string[];
  /** Packs waiting for each seat; head (index 0) is the one being picked from. */
  queues: Pack[][];
  /** Unopened packs per round per seat: unopened[round][seat]. */
  unopened: Pack[][];
  picks: Record<string, string[]>;
  burned: string[];
  log: PickRecord[];
  done: boolean;
  /** Set while the pick clock is paused (no humans connected). Deadlines are shifted on resume. */
  pausedAt?: number;
}

// ---------------------------------------------------------------------------------------------
// Deckbuilding

export type BasicCounts = Record<BasicLand, number>;

export interface DeckState {
  main: string[];
  side: string[];
  basics: BasicCounts;
  ready: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tabletop

export type ZoneName = "library" | "hand" | "battlefield" | "graveyard" | "exile" | "sideboard";
export const ZONE_LABELS: Record<ZoneName, string> = {
  library: "Library",
  hand: "Hand",
  battlefield: "Battlefield",
  graveyard: "Graveyard",
  exile: "Exile",
  sideboard: "Sideboard",
};

export interface TokenDef {
  name: string;
  power?: string;
  toughness?: string;
  colors: Color[];
  text?: string;
}

export interface TableCard {
  id: string;
  /** Card data id for real cards. Tokens instead carry `token` (or a cardId when created from a Scryfall token). */
  cardId?: string;
  token?: TokenDef;
  owner: string;
  controller: string;
  zone: ZoneName;
  /** Battlefield position in table coordinates (world units, card = 2.5 x 3.5). */
  x: number;
  y: number;
  tapped: boolean;
  faceDown: boolean;
  /** Which face of a double-faced card is showing. */
  face: number;
  counters: Record<string, number>;
  /** Stacking order on the battlefield. */
  z: number;
  foil?: boolean;
  /** Set in per-player views when the viewer may not know what this card is. */
  hidden?: boolean;
}

export interface TablePlayer {
  id: string;
  seat: number;
  life: number;
  poison: number;
  zones: Record<Exclude<ZoneName, "battlefield">, string[]>;
  /**
   * How many times their library was shuffled / they took a mulligan. Clients animate these from
   * the counters: hidden cards get new ids when shuffled, so the ids themselves can't show it.
   */
  shuffles?: number;
  mulligans?: number;
}

/** What a log line is about; the client picks its icon and accent from it. Moves use the destination zone. */
export type LogKind =
  | ZoneName
  | "start"
  | "tap"
  | "untap"
  | "flip"
  | "transform"
  | "draw"
  | "shuffle"
  | "mill"
  | "peek"
  | "life"
  | "poison"
  | "counter"
  | "token"
  | "mulligan"
  | "turn"
  | "roll"
  | "reveal";

/**
 * A styled span of a log line's text, `[start, end, kind, …]` (a compact tuple: the whole log goes
 * out with every table update):
 * - `p` a player, with their id
 * - `c` a card name, with its card id when it has one (tokens made up on the spot don't) and the
 *   face it showed, when not the front
 * - `v` the action itself ("tapped", "drew")
 * - `z` a zone ("graveyard", "the battlefield")
 * - `n` a number or result, optionally "good" / "bad" news (life gained / lost)
 */
export type LogMark =
  | [start: number, end: number, kind: "p", playerId: string]
  | [start: number, end: number, kind: "c", cardId?: string, face?: number]
  | [start: number, end: number, kind: "v" | "z"]
  | [start: number, end: number, kind: "n", tone?: "good" | "bad"];

export interface LogEntry {
  at: number;
  playerId: string;
  /** The plain sentence. Always present, so entries from before marks existed still read fine. */
  text: string;
  kind?: LogKind;
  marks?: LogMark[];
}

/**
 * A look at your own library. "Look at top X" snapshots those X cards: moving one anywhere (even
 * back on top) takes it out of the look, and the rest simply stay on top in their order. A search
 * instead shows the whole library, live.
 */
export interface LibraryPeek {
  /** How many cards the look started with (for "2 of 3 left"). */
  n: number;
  /** The cards still being looked at, top first. Unused by a search. */
  ids: string[];
  search?: boolean;
}

/**
 * Someone's look at their library as everyone sees it: that it's happening (a real table would see
 * them holding their library), and for "look at top X" how far along it is, never which cards.
 */
export type PublicLook = { kind: "search" } | { kind: "top"; n: number; left: number };

export interface TableState {
  seats: string[];
  players: Record<string, TablePlayer>;
  cards: Record<string, TableCard>;
  turn: { playerId: string; number: number };
  nextZ: number;
  log: LogEntry[];
  /** What each player is currently looking at in their own library (scry, surveil, search). */
  peek: Record<string, LibraryPeek>;
  /** Per-player views only: every player's look in progress, as the whole table sees it. */
  looks?: Record<string, PublicLook>;
  openingHandSize: number;
  /**
   * Server only (never in a view): the id each player sees for every card hidden from them, by real
   * id. A card keeps its stand-in while it stays hidden; a shuffle, or a card leaving a hand
   * unseen, draws new ones, so hidden cards can't be followed by id. A card that was public when it
   * went out of sight keeps its real id as its stand-in (everyone saw where it went).
   */
  standIns?: Record<string, Record<string, string>>;
}

// ---------------------------------------------------------------------------------------------
// Room

export interface RoomState {
  code: string;
  createdAt: number;
  /** Label of the invite that created this room (online rooms only). Never sent to clients. */
  inviteId?: string;
  /** Public rooms only: the room closes for good at this time. */
  expiresAt?: number;
  /**
   * Public rooms only: since when no human has been connected (creation, before anyone joined);
   * null while someone is here. The room closes PUBLIC_LIMITS.idleMs after this.
   */
  idleSince?: number | null;
  phase: Phase;
  players: Player[];
  /** Reconnect secrets per player id. Never sent to clients. */
  secrets: Record<string, string>;
  config: LobbyConfig;
  cube: CubeInfo | null;
  importStatus: ImportStatus;
  instances: Record<string, CardInstance>;
  nextId: number;
  draft: DraftState | null;
  decks: Record<string, DeckState>;
  table: TableState | null;
}
