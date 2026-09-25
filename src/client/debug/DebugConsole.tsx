// Collapsible playtest console (toggle with the backtick key): phase jumps, bots, render toggles, state.

import { useState } from "react";
import { useStore } from "../store";
import type { DebugCommand } from "../../shared/protocol";

const SAMPLE = "https://cubecobra.com/cube/list/vintage";

export function DebugConsole() {
  const open = useStore((s) => s.debug.open);
  const debug = useStore((s) => s.debug);
  const setDebug = useStore((s) => s.setDebug);
  const view = useStore((s) => s.view);
  const status = useStore((s) => s.status);
  const send = useStore((s) => s.send);
  const [showState, setShowState] = useState(false);

  if (!open) {
    return (
      <button className="debug-tab" onClick={() => setDebug({ open: true })} title="Debug console (`)">
        ⚙
      </button>
    );
  }

  const cmd = (c: DebugCommand) => send({ t: "debug", cmd: c });
  const me = view?.players.find((p) => p.id === view.you);
  const isHost = !!me?.isHost;

  const soloQuickstart = () => {
    if (!view) return;
    if (!view.cube) send({ t: "import", source: SAMPLE });
    const bots = Math.max(0, 4 - view.players.length);
    const waitForCube = () => {
      const v = useStore.getState().view;
      if (!v?.cube || v.importStatus.state === "running") return void setTimeout(waitForCube, 300);
      for (let i = 0; i < bots; i++) send({ t: "addBot" });
      setTimeout(() => send({ t: "setReady", ready: true }), 150);
    };
    waitForCube();
  };

  const seatLinks = view
    ? [2, 3, 4].map((n) => ({ n, href: `${location.origin}/r/${view.code}?as=${n}` }))
    : [];

  return (
    <div className="debug-console panel">
      <div className="debug-head">
        <b>Debug console</b>
        <span className="faint">` to toggle</span>
        <div className="spacer" />
        <button className="btn ghost small" onClick={() => setDebug({ open: false })}>
          ✕
        </button>
      </div>

      {view ? (
        <>
          <section>
            <div className="label">Room</div>
            <div className="debug-kv">
              <span>code</span>
              <b>{view.code}</b>
              <span>phase</span>
              <b>{view.phase}</b>
              <span>you</span>
              <b>
                {me?.name} ({view.you}){isHost ? " · host" : ""}
              </b>
              <span>seats</span>
              <b>{view.players.map((p) => p.name).join(", ")}</b>
            </div>
          </section>

          <section>
            <div className="label">Jump ahead</div>
            <div className="debug-buttons">
              {view.phase === "lobby" && (
                <>
                  <button className="btn small primary" onClick={soloQuickstart} disabled={!isHost}>
                    Solo quickstart (Vintage Cube + bots)
                  </button>
                  <button className="btn small" onClick={() => send({ t: "import", source: SAMPLE })} disabled={!isHost}>
                    Import sample cube
                  </button>
                  <button className="btn small" onClick={() => send({ t: "addBot" })} disabled={!isHost}>
                    Add bot
                  </button>
                </>
              )}
              {view.phase === "drafting" && (
                <button className="btn small" onClick={() => cmd("autoPickMe")}>
                  Auto-pick for me
                </button>
              )}
              {(view.phase === "lobby" || view.phase === "drafting") && (
                <button className="btn small" onClick={() => cmd("finishDraft")} disabled={!!view.startBlocker && view.phase === "lobby"}>
                  Finish draft (auto-pick all)
                </button>
              )}
              {view.phase === "deckbuilding" && (
                <button className="btn small" onClick={() => cmd("autoBuildMe")}>
                  Auto-build my deck
                </button>
              )}
              {view.phase !== "playing" && (
                <button className="btn small" onClick={() => cmd("startGame")} disabled={!!view.startBlocker && view.phase === "lobby"}>
                  Skip to table
                </button>
              )}
              {view.phase !== "lobby" && (
                <button className="btn small danger" onClick={() => cmd("toLobby")}>
                  Back to lobby (keeps cube)
                </button>
              )}
            </div>
          </section>

          <section>
            <div className="label">Play as another seat (new tab)</div>
            <div className="debug-buttons">
              {seatLinks.map((l) => (
                <a key={l.n} className="btn small" href={l.href} target="_blank" rel="noreferrer">
                  Seat {l.n}
                </a>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="muted">Not in a room. Create or join one to use room tools.</p>
      )}

      <section>
        <div className="label">Rendering</div>
        <label className="field check">
          <input type="checkbox" checked={debug.forceText} onChange={(e) => setDebug({ forceText: e.target.checked })} />
          <span>Text-only cards (skip Scryfall images)</span>
        </label>
      </section>

      <section>
        <div className="label">Network</div>
        <div className="debug-kv">
          <span>status</span>
          <b>{status}</b>
          <span>msgs in / out</span>
          <b>
            {debug.msgIn} / {debug.msgOut}
          </b>
          <span>received</span>
          <b>{(debug.bytesIn / 1024).toFixed(0)} KB</b>
          <span>cards loaded</span>
          <b>{Object.keys(useStore.getState().cards).length}</b>
        </div>
      </section>

      <section>
        <button className="btn ghost small" onClick={() => setShowState((v) => !v)}>
          {showState ? "▾" : "▸"} Room state (your view)
        </button>
        {showState && <pre className="debug-state scroll">{JSON.stringify(view, null, 1)?.slice(0, 60_000)}</pre>}
      </section>
    </div>
  );
}
