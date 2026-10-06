import { beforeEach, describe, expect, it } from "vitest";
import { battlefieldMenu, handMenu, useTableUi, zoomHovered } from "../src/client/table/tableUi";
import { useStore, type MenuState } from "../src/client/store";
import type { RoomView } from "../src/shared/protocol";
import type { TableCard } from "../src/shared/types";
import { makeCard } from "./fixtures";

const bolt = makeCard(1, { name: "Lightning Bolt" });

function tableCard(id: string, overrides: Partial<TableCard> = {}): TableCard {
  return { id, cardId: bolt.id, owner: "me", controller: "me", zone: "battlefield", x: 0, y: 0, tapped: false, faceDown: false, face: 0, counters: {}, z: 0, ...overrides };
}

const cards: Record<string, TableCard> = {
  mine: tableCard("mine"),
  other: tableCard("other"),
  // Opponent's face-down card, as their view sends it: no card data the viewer may see.
  theirsHidden: tableCard("theirsHidden", { owner: "opp", controller: "opp", faceDown: true, hidden: true, cardId: undefined }),
  // Your own face-down card: you know what it is.
  mineFaceDown: tableCard("mineFaceDown", { faceDown: true }),
  plainToken: tableCard("plainToken", { cardId: undefined, token: { name: "Goblin", colors: ["R"], power: "1", toughness: "1" } }),
  transformed: tableCard("transformed", { face: 1 }),
  inHand: tableCard("inHand", { zone: "hand" }),
};

const menu = () => useStore.getState().menu as MenuState;
const labels = () => menu().items.filter((i) => !i.separator).map((i) => i.label);
const zoom = () => useTableUi.getState().logZoom;

describe("zooming in on table cards", () => {
  beforeEach(() => {
    useStore.setState({ view: { you: "me", players: [], table: { cards } } as unknown as RoomView, cards: { [bolt.id]: bolt }, menu: null });
    useTableUi.setState({ selected: [], hovered: null, handHover: null, logZoom: null, handZoom: null });
  });

  it("puts Zoom in first on a battlefield card's menu, and opens the carousel on that card", () => {
    battlefieldMenu(cards.mine, 10, 10);
    expect(labels()[0]).toBe("Zoom in");
    menu().items[0].onSelect!();
    expect(zoom()).toEqual({ key: "table:mine", cardId: bolt.id, face: 0, title: "Battlefield" });
  });

  it("zooms from the menu title (the card's name) too", () => {
    battlefieldMenu(cards.mine, 10, 10);
    expect(menu().title).toBe("Lightning Bolt");
    menu().onTitle!.onSelect();
    expect(zoom()?.key).toBe("table:mine");
  });

  it("opens on the face that's showing", () => {
    battlefieldMenu(cards.transformed, 10, 10);
    menu().items[0].onSelect!();
    expect(zoom()?.face).toBe(1);
  });

  it("offers no zoom for cards the viewer can't see, or a selection of several", () => {
    battlefieldMenu(cards.theirsHidden, 10, 10);
    expect(labels()).not.toContain("Zoom in");
    expect(menu().onTitle).toBeUndefined();

    battlefieldMenu(cards.plainToken, 10, 10);
    expect(labels()).not.toContain("Zoom in");

    useTableUi.setState({ selected: ["mine", "other"] });
    battlefieldMenu(cards.mine, 10, 10);
    expect(menu().title).toBe("2 cards");
    expect(labels()).not.toContain("Zoom in");
    expect(menu().onTitle).toBeUndefined();
  });

  it("lets you zoom your own face-down card", () => {
    battlefieldMenu(cards.mineFaceDown, 10, 10);
    expect(labels()[0]).toBe("Zoom in");
  });

  it("puts Zoom in first on a hand card's menu, opening the hand carousel", () => {
    handMenu(cards.inHand, 10, 10);
    expect(labels()[0]).toBe("Zoom in");
    menu().items[0].onSelect!();
    expect(useTableUi.getState().handZoom).toBe("inHand");
  });

  describe("Z", () => {
    it("zooms the hovered battlefield card", () => {
      useTableUi.setState({ hovered: "mine" });
      zoomHovered();
      expect(zoom()?.key).toBe("table:mine");
    });

    it("zooms the hovered hand card in the hand carousel", () => {
      useTableUi.setState({ handHover: "inHand" });
      zoomHovered();
      expect(useTableUi.getState().handZoom).toBe("inHand");
      expect(zoom()).toBeNull();
    });

    it("does nothing over nothing, or over a card the viewer can't see", () => {
      zoomHovered();
      useTableUi.setState({ hovered: "theirsHidden" });
      zoomHovered();
      expect(zoom()).toBeNull();
      expect(useTableUi.getState().handZoom).toBeNull();
    });
  });
});
