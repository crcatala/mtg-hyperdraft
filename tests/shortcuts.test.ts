import { beforeEach, describe, expect, it } from "vitest";
import { isControl, shortcutsBlocked } from "../src/client/shortcuts";
import { useStore } from "../src/client/store";
import { getVolumes, DEFAULT_VOLUMES } from "../src/client/volume";
import { isMuted, setEffectsVolume, setMuted } from "../src/client/sfx";

// A stand-in for a DOM element: `closest` says yes when the selector names the element's tag or role.
const el = (tag: string, role?: string) => ({
  closest: (sel: string) => (sel.split(",").some((s) => s.trim() === tag || (role && s.trim() === `[role=${role}]`)) ? {} : null),
});

describe("global shortcut guards", () => {
  beforeEach(() => useStore.setState({ settingsOpen: false }));

  it("stand down while Settings is open", () => {
    expect(shortcutsBlocked()).toBe(false);
    useStore.setState({ settingsOpen: true });
    expect(shortcutsBlocked()).toBe(true);
  });

  it("treat buttons, links, inputs and tabs as controls that keep their own keys", () => {
    for (const tag of ["button", "input", "select", "textarea"]) expect(isControl(el(tag) as never)).toBe(true);
    expect(isControl(el("div", "tab") as never)).toBe(true);
  });

  it("leave plain page elements alone (Space still taps/skips there)", () => {
    expect(isControl(el("div") as never)).toBe(false);
    expect(isControl(el("canvas") as never)).toBe(false);
    expect(isControl(null)).toBe(false);
    expect(isControl({} as never)).toBe(false);
  });
});

describe("effects volume slider", () => {
  beforeEach(() => {
    setMuted(false);
    setEffectsVolume(DEFAULT_VOLUMES.sfx);
  });

  it("un-mutes when raised from a mute, and keeps the new level", () => {
    setMuted(true);
    setEffectsVolume(0.4);
    expect(isMuted()).toBe(false);
    expect(getVolumes().sfx).toBe(0.4);
  });

  it("stays muted when dragged to zero", () => {
    setMuted(true);
    setEffectsVolume(0);
    expect(isMuted()).toBe(true);
  });

  it("doesn't touch an unmuted state", () => {
    setEffectsVolume(0.2);
    expect(isMuted()).toBe(false);
    expect(getVolumes().sfx).toBe(0.2);
  });
});
