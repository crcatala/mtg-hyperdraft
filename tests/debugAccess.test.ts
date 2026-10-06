import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_KEY, debugAccess, debugParam, initDebugAccess, setDebugAccess, withoutDebugParam } from "../src/client/debugAccess";
import appSrc from "../src/client/App.tsx?raw";

describe("debug console access", () => {
  let store: Map<string, string>;
  // The address bar: replaceState rewrites it, and a reload starts the app again from whatever it says.
  let url: { pathname: string; search: string; hash: string };

  /** Opens the app at `path` (a fresh page load). */
  const visit = (path: string) => {
    const u = new URL(path, "http://hd.test");
    url = { pathname: u.pathname, search: u.search, hash: u.hash };
    initDebugAccess();
  };
  const boot = (search = "") => visit(`/${search}`);
  const reload = () => initDebugAccess();

  beforeEach(() => {
    store = new Map();
    url = { pathname: "/", search: "", hash: "" };
    vi.stubGlobal("location", {
      get pathname() {
        return url.pathname;
      },
      get search() {
        return url.search;
      },
      get hash() {
        return url.hash;
      },
    });
    vi.stubGlobal("history", {
      state: null,
      replaceState: (_: unknown, __: string, next: string) => {
        const u = new URL(next, "http://hd.test");
        url = { pathname: u.pathname, search: u.search, hash: u.hash };
      },
    });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads ?debug as on, ?debug=0 / off / false as off, and no param as nothing said", () => {
    expect(debugParam("?debug")).toBe(true);
    expect(debugParam("?debug=1")).toBe(true);
    expect(debugParam("?as=2&debug=true")).toBe(true);
    expect(debugParam("?debug=0")).toBe(false);
    expect(debugParam("?debug=OFF")).toBe(false);
    expect(debugParam("?debug=false")).toBe(false);
    expect(debugParam("")).toBeNull();
    expect(debugParam("?theme=signal")).toBeNull();
  });

  it("is off on a first visit", () => {
    boot();
    expect(debugAccess()).toBe(false);
    expect(store.has(DEBUG_KEY)).toBe(false);
  });

  it("turns on with ?debug and stays on for later visits without it", () => {
    boot("?debug");
    expect(debugAccess()).toBe(true);
    boot();
    expect(debugAccess()).toBe(true);
  });

  it("turns off with ?debug=0, or from the console", () => {
    boot("?debug");
    boot("?debug=0");
    expect(debugAccess()).toBe(false);
    expect(store.has(DEBUG_KEY)).toBe(false);

    boot("?debug");
    setDebugAccess(false);
    boot();
    expect(debugAccess()).toBe(false);
  });

  it("stays off after Turn off, even reloading the page that was opened with ?debug", () => {
    visit("/r/ABCD?debug");
    expect(debugAccess()).toBe(true);
    setDebugAccess(false);
    reload();
    expect(debugAccess()).toBe(false);
  });

  it("takes ?debug out of the address bar, keeping the rest of it", () => {
    visit("/r/ABCD?as=2&debug&theme=signal#log");
    expect(url).toEqual({ pathname: "/r/ABCD", search: "?as=2&theme=signal", hash: "#log" });
    visit("/?debug=0");
    expect(url.search).toBe("");
    // Nothing to take out: the address is left alone.
    visit("/r/ABCD?as=3");
    expect(url.search).toBe("?as=3");
    expect(withoutDebugParam("?debug=1&as=2")).toBe("?as=2");
  });

  it("still applies for the visit when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    boot("?debug");
    expect(debugAccess()).toBe(true);
    boot();
    expect(debugAccess()).toBe(false);
  });

  it("only mounts the console, and only answers the backtick, when it's on", () => {
    expect(appSrc).toContain("{debugTools && <DebugConsole />}");
    expect(appSrc).toMatch(/if \(!debugAccess\(\) \|\| shortcutsBlocked\(\)\) return;/);
  });
});
