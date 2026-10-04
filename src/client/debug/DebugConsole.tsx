// Collapsible playtest console (toggle with the backtick key): phase jumps, bots, render toggles, state.

import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import type { DebugCommand } from "../../shared/protocol";
import { quickstart, SAMPLE_CUBE, STARTER_CUBE } from "../quickstart";
import { setTheme, THEMES, useTheme } from "../theme";
import { setSoundPack, SOUND_PACKS, useSoundPack, type PackId } from "../soundPacks";
import { loadPack, sfx } from "../sfx";

export function DebugConsole() {
  const open = useStore((s) => s.debug.open);
  const debug = useStore((s) => s.debug);
  const setDebug = useStore((s) => s.setDebug);
  const view = useStore((s) => s.view);
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const send = useStore((s) => s.send);
  const [showState, setShowState] = useState(false);
  const theme = useTheme();
  const soundPack = useSoundPack();

  // Switching plays a short sample of the new pack, once its files have loaded.
  const chooseSounds = (p: PackId) => {
    setSoundPack(p);
    void loadPack(p).then(() => sfx.preview());
  };

  if (!open) {
    return (
      <button className="debug-tab" onClick={() => setDebug({ open: true })} title="Debug console (`)">
        <Icon name="gear" />
      </button>
    );
  }

  const cmd = (c: DebugCommand) => send({ t: "debug", cmd: c });
  const me = view?.players.find((p) => p.id === view.you);
  const isHost = !!me?.isHost;

  const seatLinks = view && mode === "online"
    ? [2, 3, 4].map((n) => ({ n, href: `${location.origin}/r/${view.code}?as=${n}` }))
    : [];

  return (
    <div className="debug-console panel">
      <div className="debug-head">
        <b>Debug console</b>
        <span className="faint">` to toggle</span>
        <div className="spacer" />
        <button className="btn ghost small icon-only" aria-label="Close debug console" onClick={() => setDebug({ open: false })}>
          <Icon name="x" />
        </button>
      </div>

      <section>
        <div className="label">Theme · Alt+Shift+T cycles</div>
        <div className="debug-buttons">
          {THEMES.map((t) => (
            <button key={t.id} className={`btn small${theme === t.id ? " primary" : ""}`} onClick={() => setTheme(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="label">Sound effects · pick one to hear it</div>
        <div className="debug-buttons">
          {SOUND_PACKS.map((p) => (
            <button key={p.id} className={`btn small${soundPack === p.id ? " primary" : ""}`} title={p.blurb} onClick={() => chooseSounds(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <p className="faint debug-note">{SOUND_PACKS.find((p) => p.id === soundPack)?.blurb}</p>
        <a href="/dev/sound-studio" target="_blank" rel="noreferrer">
          Open Sound Studio (new tab)
        </a>
      </section>

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
                  <button className="btn small primary" onClick={quickstart} disabled={!isHost}>
                    Quickstart ({STARTER_CUBE.name} + bots)
                  </button>
                  <button className="btn small" onClick={() => send({ t: "import", source: SAMPLE_CUBE })} disabled={!isHost}>
                    Import Vintage Cube (live lookup)
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

          {seatLinks.length > 0 && (
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
          )}
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
        <label className="field check">
          <input type="checkbox" checked={debug.slowMotion} onChange={(e) => setDebug({ slowMotion: e.target.checked })} />
          <span>Slow-motion card animations (6×)</span>
        </label>
        <a href="/dev/icons" target="_blank" rel="noreferrer">
          Open icon gallery (new tab)
        </a>
      </section>

      <section>
        <div className="label">Network</div>
        <div className="debug-kv">
          <span>mode</span>
          <b>{mode === "solo" ? "solo (in-browser engine)" : "online"}</b>
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
          <Icon name={showState ? "chevron-down" : "chevron-right"} /> Room state (your view)
        </button>
        {showState && <pre className="debug-state scroll">{JSON.stringify(view, null, 1)?.slice(0, 60_000)}</pre>}
      </section>
    </div>
  );
}
