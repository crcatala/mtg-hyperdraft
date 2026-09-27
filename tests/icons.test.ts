import { describe, expect, it } from "vitest";
import { cardTypeIcon, ICONS, type IconPart } from "../src/client/icons";

describe("icons", () => {
  it("every icon is well-formed SVG path data", () => {
    for (const [name, parts] of Object.entries(ICONS)) {
      expect(parts.length, name).toBeGreaterThan(0);
      for (const p of parts as IconPart[]) {
        expect(p.d, name).toMatch(/^M[-\d. ]/);
        expect(p.d, name).toMatch(/^[MLHVCSQTAZmlhvcsqtaz\d\s.,-]+$/);
        expect(p.d, name).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("picks card-type art by type line, most specific first", () => {
    expect(cardTypeIcon("Legendary Planeswalker — Jace")).toBe("planeswalker");
    expect(cardTypeIcon("Artifact Creature — Golem")).toBe("creature");
    expect(cardTypeIcon("Instant")).toBe("bolt");
    expect(cardTypeIcon("Sorcery")).toBe("sorcery");
    expect(cardTypeIcon("Enchantment — Aura")).toBe("enchantment");
    expect(cardTypeIcon("Artifact — Equipment")).toBe("gear");
    expect(cardTypeIcon("Basic Land — Island")).toBe("land");
    expect(cardTypeIcon("Kindred Tribal")).toBe("diamond");
  });
});
