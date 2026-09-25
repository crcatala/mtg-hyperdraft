// Offline solo mode: the room engine runs in this tab (see local.ts), no server involved.

import { useEffect } from "react";
import { startLocal, stopLocal } from "../local";
import { useStore } from "../store";
import { PhaseScreen } from "./RoomScreen";

export function SoloScreen() {
  const phase = useStore((s) => s.view?.phase);
  const started = useStore((s) => s.mode === "solo" && s.view !== null);

  useEffect(() => {
    startLocal();
    return () => stopLocal();
  }, []);

  // Nothing is saved in solo mode: warn before a refresh or close throws away a game in progress.
  const inProgress = !!phase && phase !== "lobby";
  useEffect(() => {
    if (!inProgress) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inProgress]);

  if (!started) {
    return (
      <div className="screen">
        <div className="center-stage">
          <div className="loading-sigil" />
        </div>
      </div>
    );
  }
  return <PhaseScreen />;
}
