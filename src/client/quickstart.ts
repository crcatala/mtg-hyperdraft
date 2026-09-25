// One-click "import a cube, fill the table with bots, ready up" for solo play and testing.
// Defaults to the bundled preset cube: instant, and no Scryfall/CubeCobra lookups.

import { MAX_HUMANS } from "../shared/types";
import { PRESET_CUBES, presetSource } from "../shared/presets";
import { useStore } from "./store";

export const STARTER_CUBE = PRESET_CUBES[0];
/** A big cube imported live, for testing the real import path. */
export const SAMPLE_CUBE = "https://cubecobra.com/cube/list/vintage";

export function quickstart() {
  const { view, send } = useStore.getState();
  if (!view) return;
  if (!view.cube) send({ t: "import", source: presetSource(STARTER_CUBE.id) });
  const bots = Math.max(0, MAX_HUMANS - view.players.length);
  const waitForCube = () => {
    const v = useStore.getState().view;
    if (!v) return;
    if (v.importStatus.state === "error") return;
    if (!v.cube || v.importStatus.state === "running") return void setTimeout(waitForCube, 300);
    for (let i = 0; i < bots; i++) send({ t: "addBot" });
    setTimeout(() => send({ t: "setReady", ready: true }), 150);
  };
  waitForCube();
}
