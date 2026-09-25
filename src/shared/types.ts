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
}

export type PassPattern = "alternate" | "left";
export type TimerStyle = "fixed" | "shrinking";

export interface DraftConfig {
  mode: "cube";
  packsPerPlayer: number;
  cardsPerPack: number;
  picksPerTurn: number;
  burnsPerTurn: number;
  passPattern: PassPattern;
  /** 0 = no time limit. For "shrinking", this is the time for the first pick of a full pack. */
  pickTimerSec: number;
  timerStyle: TimerStyle;
  allowDuplicates: boolean;
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
    foilChance: 0.35,
  },
  game: {
    startingLife: 20,
    minDeckSize: 40,
    openingHandSize: 7,
  },
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
}

export interface LogEntry {
  at: number;
  playerId: string;
  text: string;
}

export interface TableState {
  seats: string[];
  players: Record<string, TablePlayer>;
  cards: Record<string, TableCard>;
  turn: { playerId: string; number: number };
  nextZ: number;
  log: LogEntry[];
  /** How many top library cards each player is currently looking at (search = whole library). */
  peek: Record<string, number>;
  openingHandSize: number;
}

// ---------------------------------------------------------------------------------------------
// Room

export interface RoomState {
  code: string;
  createdAt: number;
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
