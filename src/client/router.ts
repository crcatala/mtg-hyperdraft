// Minimal path router: "/" (home), "/solo", "/r/CODE" (room), "/dev/icons" (icon gallery),
// "/dev/sound-studio" (sound packs) and "/dev/companion-lab" (companion reactions).
// Keeps ?as= for multi-tab testing.

import { useSyncExternalStore } from "react";
import { withAlias } from "./identity";

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function navigate(path: string) {
  history.pushState(null, "", withAlias(path));
  listeners.forEach((l) => l());
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

export function roomCodeFromPath(path: string): string | null {
  const m = path.match(/^\/r\/([A-Za-z0-9]{4,8})\/?$/);
  return m ? m[1].toUpperCase() : null;
}
