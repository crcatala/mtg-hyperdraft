// Guards for the window-level keyboard shortcuts (the table's hotkeys and camera keys, the draft's
// Space, the debug backtick). Two situations should keep them from firing:
//   - a modal is open (Settings, the emote line editor): the keys belong to the dialog, not the game behind it;
//   - the key lands on a control that has its own use for it (Space presses a focused button).

import { useStore } from "./store";
import { useEmoteLines } from "./table/emoteLines";
import { useTreats } from "./table/treatState";

/** What a focused element can be that handles Space/Enter itself. */
const CONTROL = "button, a[href], input, textarea, select, summary, [role=button], [role=tab], [role=slider], [contenteditable=true], [contenteditable='']";

/** True when `target` is (inside) a control that uses the key for itself. */
export function isControl(target: EventTarget | null): boolean {
  const el = target as { closest?: (sel: string) => unknown } | null;
  return !!el && typeof el.closest === "function" && !!el.closest(CONTROL);
}

/** True while a modal owns the keyboard, so global shortcuts must stand down. */
export function shortcutsBlocked(): boolean {
  return useStore.getState().settingsOpen || useEmoteLines.getState().editing || useTreats.getState().open;
}
