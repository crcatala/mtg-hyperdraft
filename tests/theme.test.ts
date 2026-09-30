import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, nextTheme, resolveTheme, THEMES } from "../src/client/theme";

describe("UI themes", () => {
  it("prefers the URL, then the saved choice, then the default", () => {
    const [a, b] = [THEMES[0].id, THEMES[THEMES.length - 1].id];
    expect(resolveTheme(a, b)).toBe(a);
    expect(resolveTheme(null, b)).toBe(b);
    expect(resolveTheme(null, null)).toBe(DEFAULT_THEME);
  });

  it("ignores unknown or retired theme names", () => {
    expect(isTheme("folio")).toBe(false);
    expect(resolveTheme("folio", "current")).toBe(DEFAULT_THEME);
    expect(resolveTheme("nope", THEMES[0].id)).toBe(THEMES[0].id);
  });

  it("cycles through every theme and wraps around", () => {
    let t = THEMES[0].id as (typeof THEMES)[number]["id"];
    const seen = new Set<string>();
    for (let i = 0; i < THEMES.length; i++) {
      seen.add(t);
      t = nextTheme(t);
    }
    expect(seen.size).toBe(THEMES.length);
    expect(t).toBe(THEMES[0].id);
  });
});
