import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEBUG_KEY, debugAccess, debugParam, initDebugAccess, setDebugAccess } from "../src/client/debugAccess";
import appSrc from "../src/client/App.tsx?raw";

describe("debug console access", () => {
  let store: Map<string, string>;

  const boot = (search = "") => {
    vi.stubGlobal("location", { search });
    initDebugAccess();
  };

  beforeEach(() => {
    store = new Map();
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
