import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, initTheme, isTheme, nextTheme, resolveTheme, setTheme, THEME_KEY, THEMES, type ThemeId } from "../src/client/theme";
import mainSrc from "../src/client/main.tsx?raw";
import indexHtml from "../index.html?raw";

const themeFiles = Object.keys(import.meta.glob("../src/client/themes/*.css")).map((p) => p.replace(/^.*\/([\w-]+)\.css$/, "$1"));
const ids = THEMES.map((t) => t.id as string);

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
    expect(resolveTheme("nope", THEMES[1].id)).toBe(THEMES[1].id);
  });

  it("cycles through every theme and wraps around", () => {
    let t: ThemeId = THEMES[0].id;
    const seen = new Set<string>();
    for (let i = 0; i < THEMES.length; i++) {
      seen.add(t);
      t = nextTheme(t);
    }
    expect(seen.size).toBe(THEMES.length);
    expect(t).toBe(THEMES[0].id);
  });
});

describe("theme wiring", () => {
  it("imports a stylesheet for every theme except Arcane, which is the base CSS", () => {
    const imported = [...mainSrc.matchAll(/import "\.\/themes\/([\w-]+)\.css";/g)].map((m) => m[1]);
    const expected = ids.filter((id) => id !== "arcane").sort();
    expect(imported.sort()).toEqual(expected);
    expect(themeFiles.sort()).toEqual(expected);
  });

  it("keeps index.html's pre-paint allowlist and default in step with theme.ts", () => {
    const list = indexHtml.match(/var ids = (\[[^\]]*\]);/);
    expect(list).not.toBeNull();
    expect(JSON.parse(list![1]).sort()).toEqual([...ids].sort());
    expect(indexHtml).toContain(`<html lang="en" data-theme="${DEFAULT_THEME}">`);
    expect(indexHtml).toContain(`localStorage.getItem("${THEME_KEY}")`);
  });
});

describe("remembering the theme", () => {
  let store: Map<string, string>;
  let html: { dataset: Record<string, string> };

  const boot = (search = "") => {
    vi.stubGlobal("location", { search });
    initTheme();
  };

  beforeEach(() => {
    store = new Map();
    html = { dataset: {} };
    vi.stubGlobal("document", { documentElement: html });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("applies the default on a first visit without saving it", () => {
    boot();
    expect(html.dataset.theme).toBe(DEFAULT_THEME);
    expect(store.has(THEME_KEY)).toBe(false);
  });

  it("previews ?theme= without replacing the saved choice", () => {
    store.set(THEME_KEY, "arcane");
    boot("?theme=signal");
    expect(html.dataset.theme).toBe("signal");
    expect(store.get(THEME_KEY)).toBe("arcane");
    boot();
    expect(html.dataset.theme).toBe("arcane");
  });

  it("remembers an explicit choice", () => {
    boot();
    setTheme("signal");
    expect(html.dataset.theme).toBe("signal");
    expect(store.get(THEME_KEY)).toBe("signal");
    boot();
    expect(html.dataset.theme).toBe("signal");
  });
});
