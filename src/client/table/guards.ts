// Second looks for table actions that are easy to trigger by accident. Nothing is forbidden (there's
// no rules engine, and sometimes you do need to untap an opponent's creature or end a turn for an
// absent friend); these only ask "are you sure?" first:
//  - turn-structure actions (draw, untap all, shuffle, mill, end turn) while it's someone else's turn;
//  - anything done to another player's card (tap, flip, transform, counters, moving it);
//  - a mulligan, which always asked.

import type { TableAction } from "../../shared/table";
import type { TableCard, TableState } from "../../shared/types";

export type GuardPart =
  | { text: string; kind?: undefined }
  | { text: string; kind: "player"; playerId: string }
  | { text: string; kind: "card"; cardId?: string; face?: number };

export interface Guard {
  question: string;
  /** Styled pieces embedded in the question, matching the game-log player and card treatments. */
  parts?: GuardPart[];
  /** Label of the confirming button. */
  confirm: string;
}

export interface GuardContext {
  table: TableState;
  me: string;
  /** Display name of a player. */
  nameOf: (playerId: string) => string;
  /** What a card is called, as far as this player can see. */
  cardLabel: (card: TableCard) => string;
}

/** Whose card it is right now: the controller on the battlefield, the owner elsewhere. */
function holder(card: TableCard): string {
  return card.zone === "battlefield" ? card.controller : card.owner;
}

/** The cards an action touches (empty for actions that aren't about specific cards). */
function touchedIds(action: TableAction): string[] {
  switch (action.a) {
    case "move":
    case "tap":
    case "flip":
      return action.ids;
    case "turnFace":
    case "counter":
    case "setPos":
      return [action.id];
    case "place":
      return action.cards.map((c) => c.id);
    default:
      return [];
  }
}

function offTurn(action: TableAction, whose: string, playerId: string): Guard | null {
  const start: GuardPart[] = [{ text: "It's " }, { text: whose, kind: "player", playerId }, { text: "'s turn" }];
  const build = (ending: string, confirm: string): Guard => {
    const parts: GuardPart[] = [...start, { text: ending }];
    return { question: parts.map((part) => part.text).join(""), parts, confirm };
  };
  switch (action.a) {
    case "draw":
      return build(`. Draw ${action.n === 1 ? "a card" : `${action.n} cards`} anyway?`, "Draw");
    case "untapAll":
      return build(". Untap all your permanents anyway?", "Untap all");
    case "shuffle":
      return build(". Shuffle your library anyway?", "Shuffle");
    case "mill":
      return build(`. Mill ${action.n === 1 ? "a card" : `${action.n} cards`} anyway?`, "Mill");
    case "nextTurn":
      return build(", not yours. End it anyway?", "End their turn");
    default:
      return null;
  }
}

/** What the action would do to the card(s), as a verb phrase ("tap it", "exile them"). */
function doing(action: TableAction, it: string): { phrase: string; confirm: string } {
  switch (action.a) {
    case "tap":
      return action.tapped === false ? { phrase: `untap ${it}`, confirm: "Untap" } : { phrase: `tap ${it}`, confirm: "Tap" };
    case "flip":
      return { phrase: `turn ${it} over`, confirm: "Turn over" };
    case "turnFace":
      return { phrase: `transform ${it}`, confirm: "Transform" };
    case "counter":
      return action.delta > 0 ? { phrase: `add a ${action.kind} counter to ${it}`, confirm: "Add counter" } : { phrase: `remove a ${action.kind} counter from ${it}`, confirm: "Remove counter" };
    case "setPos":
    case "place":
      return { phrase: `move ${it}`, confirm: "Move" };
    case "move": {
      const where =
        action.to === "hand" ? `return ${it} to hand`
        : action.to === "graveyard" ? `put ${it} into the graveyard`
        : action.to === "exile" ? `exile ${it}`
        : action.to === "library" ? `put ${it} on the ${action.bottom ? "bottom" : "top"} of the library`
        : action.to === "sideboard" ? `put ${it} in the sideboard`
        : `put ${it} onto the battlefield`;
      return { phrase: where, confirm: "Move" };
    }
    default:
      return { phrase: `act on ${it}`, confirm: "Continue" };
  }
}

/** The confirmation an action needs before it's sent, or null to send it right away. */
export function guardFor(action: TableAction, ctx: GuardContext): Guard | null {
  const { table, me } = ctx;
  if (action.a === "mulligan") return { question: "Shuffle your hand into your library and draw a new hand?", confirm: "Mulligan" };

  const turnOwner = table.turn.playerId;
  if (turnOwner !== me && table.players[turnOwner]) {
    const guard = offTurn(action, ctx.nameOf(turnOwner), turnOwner);
    if (guard) return guard;
  }

  return cardGuard(action, touchedIds(action), ctx);
}

function cardGuard(action: TableAction, ids: string[], ctx: GuardContext): Guard | null {
  const { table, me } = ctx;
  const cards = ids.map((id) => table.cards[id]).filter((c): c is TableCard => !!c);
  const foreign = cards.filter((c) => holder(c) !== me);
  if (foreign.length === 0) return null;
  const owners = [...new Set(foreign.map(holder))];
  const single = cards.length === 1;
  const { phrase, confirm } = doing(action, single ? "it" : "them");
  const actionText = ` ${phrase[0].toUpperCase()}${phrase.slice(1)} anyway?`;
  const ownerParts: GuardPart[] = owners.flatMap((id, i) => [
    ...(i === 0 ? [] : [{ text: i === owners.length - 1 ? " and " : ", " }]),
    { text: ctx.nameOf(id), kind: "player" as const, playerId: id },
  ]);
  const subjectParts: GuardPart[] = single
    ? [
        { text: ctx.cardLabel(foreign[0]), kind: "card", cardId: foreign[0].hidden ? undefined : foreign[0].cardId, face: foreign[0].face },
        { text: " belongs to " },
        ...ownerParts,
        { text: "." },
      ]
    : [
        { text: `${foreign.length} of these ${cards.length} cards belong to ` },
        ...ownerParts,
        { text: "." },
      ];
  const parts = [...subjectParts, { text: actionText }];
  return { question: parts.map((part) => part.text).join(""), parts, confirm };
}

/** One guard for several actions sent together (so they share one prompt). */
export function guardForAll(actions: TableAction[], ctx: GuardContext): Guard | null {
  for (const a of actions) {
    const g = guardFor(a, ctx);
    if (g) return g;
  }
  return null;
}
