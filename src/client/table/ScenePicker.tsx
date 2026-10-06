// The Scene menu (the dock's Scene button): which table everyone plays on and what surrounds it. Shared by the
// whole table: a pick goes to the room, which stores it, logs who changed it and shows it to everyone (see
// shared/scene.ts). Purely cosmetic: nothing on the table moves.

import { useStore } from "../store";
import { DEFAULT_SCENE, ENVIRONMENTS, TABLE_STYLES, type EnvironmentId, type TableStyleId } from "../../shared/scene";

export function ScenePicker({ id }: { id?: string }) {
  const scene = useStore((s) => s.view?.scene) ?? DEFAULT_SCENE;
  const send = useStore((s) => s.send);
  const pickTable = (table: TableStyleId) => table !== scene.table && send({ t: "scene", table });
  const pickEnv = (env: EnvironmentId) => env !== scene.env && send({ t: "scene", env });
  return (
    <div className="scene-menu panel" id={id} role="group" aria-label="Scene">
      <p className="scene-note faint">Everyone at the table sees what you pick.</p>
      <h3 className="scene-h">Table</h3>
      <div className="scene-opts" role="group" aria-label="Table">
        {TABLE_STYLES.map((t) => (
          <button key={t.id} type="button" className="scene-opt" aria-pressed={scene.table === t.id} onClick={() => pickTable(t.id)}>
            <span className={`scene-swatch s-${t.id}`} aria-hidden />
            <b>{t.label}</b>
            <span className="faint">{t.blurb}</span>
          </button>
        ))}
      </div>
      <h3 className="scene-h">Environment</h3>
      <div className="scene-opts" role="group" aria-label="Environment">
        {ENVIRONMENTS.map((e) => (
          <button key={e.id} type="button" className="scene-opt" aria-pressed={scene.env === e.id} onClick={() => pickEnv(e.id)}>
            <span className={`scene-swatch s-${e.id}`} aria-hidden />
            <b>{e.label}</b>
            <span className="faint">{e.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
