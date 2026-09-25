import { useMemo, useState } from "react";
import { useStore } from "../store";
import { NameEditor, TopBar } from "../components/TopBar";
import { CardView } from "../components/CardView";
import type { DraftConfig, GameConfig, Player } from "../../shared/types";
import { MAX_HUMANS, MAX_SEATS } from "../../shared/types";
import { cardsNeeded } from "../../shared/draft";
import { quickstart, STARTER_CUBE } from "../quickstart";
import { presetSource } from "../../shared/presets";

const SAMPLE_CUBES = [
  { label: "Vintage Cube", value: "https://cubecobra.com/cube/list/vintage" },
  { label: "The Pauper Cube", value: "https://cubecobra.com/cube/list/thepaupercube" },
  { label: "LSV's Cube", value: "https://cubecobra.com/cube/list/LSVCube" },
];

export function Lobby() {
  const view = useStore((s) => s.view)!;
  const send = useStore((s) => s.send);
  const solo = useStore((s) => s.mode === "solo");
  const me = view.players.find((p) => p.id === view.you);
  const isHost = !!me?.isHost;
  const humans = view.players.filter((p) => !p.isBot);
  const waitingOn = humans.filter((p) => !p.ready);
  const importing = view.importStatus.state === "running";

  return (
    <div className="screen lobby">
      <TopBar title="Lobby">
        <NameEditor />
      </TopBar>
      <div className="lobby-grid scroll">
        {solo && (
          <section className="panel solo-banner">
            <div>
              <h2>Solo draft</h2>
              <p className="muted">
                You and bots, running entirely in your browser: no account, no server. Nothing is saved, so closing the tab ends the game.
              </p>
            </div>
            <button className="btn primary big" disabled={importing || !!me?.ready} onClick={quickstart}>
              {importing ? "Importing…" : `⚡ Quick start: ${STARTER_CUBE.name}`}
            </button>
          </section>
        )}
        <section className="panel lobby-players">
          <div className="section-head">
            <h2>Players</h2>
            <span className="muted">
              {solo ? `${view.players.length}/${MAX_SEATS} seats` : `${humans.length}/${MAX_HUMANS} friends · ${view.players.length}/${MAX_SEATS} seats`}
            </span>
          </div>
          <ul className="seat-list">
            {view.players.map((p, i) => (
              <SeatRow key={p.id} player={p} seat={i} isMe={p.id === view.you} canKick={isHost && p.id !== view.you} />
            ))}
          </ul>
          {isHost && (
            <button className="btn small" onClick={() => send({ t: "addBot" })} disabled={view.players.length >= MAX_SEATS}>
              + Add bot drafter
            </button>
          )}
          <p className="faint small-print">Bots draft alongside you (great for small groups or solo testing) but don't play on the table.</p>

          <div className="ready-box">
            {view.startBlocker ? (
              <p className="pill warn">{view.startBlocker}</p>
            ) : waitingOn.length > 0 ? (
              <p className="muted">
                Waiting on {waitingOn.map((p) => p.name).join(", ")} to ready up. The draft starts when everyone is ready.
              </p>
            ) : (
              <p className="muted">Everyone's ready!</p>
            )}
            <button className={`btn big ${me?.ready ? "on" : "primary"}`} onClick={() => send({ t: "setReady", ready: !me?.ready })}>
              {me?.ready ? "✓ Ready — click to unready" : "I'm ready to draft"}
            </button>
          </div>
        </section>

        <CubePanel isHost={isHost} />
        <SettingsPanel isHost={isHost} />
      </div>
    </div>
  );
}

function SeatRow({ player, seat, isMe, canKick }: { player: Player; seat: number; isMe: boolean; canKick: boolean }) {
  const send = useStore((s) => s.send);
  const hue = (seat * 67 + 260) % 360;
  return (
    <li className={`seat-row${isMe ? " me" : ""}`}>
      <span className="avatar" style={{ background: `hsl(${hue} 70% 55%)` }}>
        {player.isBot ? "🤖" : player.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="seat-name">
        {player.name}
        {isMe && <span className="faint"> (you)</span>}
        {player.isHost && <span className="crown" title="Host"> ♛</span>}
      </span>
      <span className="spacer" />
      {!player.isBot && !player.connected && <span className="pill bad">away</span>}
      {player.isBot ? <span className="pill">bot</span> : player.ready ? <span className="pill ok">ready</span> : <span className="pill">not ready</span>}
      {canKick && (
        <button className="btn ghost small" title="Remove" onClick={() => send({ t: "kick", playerId: player.id })}>
          ✕
        </button>
      )}
    </li>
  );
}

function CubePanel({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.view)!;
  const cards = useStore((s) => s.cards);
  const send = useStore((s) => s.send);
  const solo = useStore((s) => s.mode === "solo");
  const [source, setSource] = useState("");
  const [showMissing, setShowMissing] = useState(false);
  const running = view.importStatus.state === "running";
  const cube = view.cube;

  // A handful of the cube's most exciting cards, for a visual "yes, this worked".
  const showcase = useMemo(() => {
    const list = Object.values(cards).filter((c) => !c.basic && !/Basic Land/.test(c.typeLine));
    const weight = { mythic: 4, special: 3, rare: 2, uncommon: 1, common: 0 };
    return list
      .sort((a, b) => weight[b.rarity] - weight[a.rarity] || (b.elo ?? 0) - (a.elo ?? 0))
      .slice(0, 7);
  }, [cards]);

  return (
    <section className="panel lobby-cube">
      <div className="section-head">
        <h2>Cube</h2>
        {cube && <span className="pill ok">{cube.size} cards</span>}
      </div>

      {cube ? (
        <div className="cube-summary">
          <div className="cube-name">{cube.name}</div>
          <div className="muted">
            {cube.uniqueCards} unique · {cube.source}
          </div>
          <div className="showcase">
            {showcase.map((c, i) => (
              <CardView key={c.id} card={c} width={112} tilt style={{ "--i": i, "--n": showcase.length } as React.CSSProperties} className="showcase-card" />
            ))}
          </div>
          {cube.notFound.length > 0 && (
            <div className="notice-box bad">
              <button className="btn ghost small" onClick={() => setShowMissing((v) => !v)}>
                {showMissing ? "▾" : "▸"} {cube.notFound.length} card(s) not found on Scryfall
              </button>
              {showMissing && <p className="missing-list">{cube.notFound.join(" · ")}</p>}
            </div>
          )}
          {cube.warnings.length > 0 && (
            <ul className="warnings">
              {cube.warnings.slice(0, 6).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {cube.warnings.length > 6 && <li>…and {cube.warnings.length - 6} more</li>}
            </ul>
          )}
        </div>
      ) : (
        <p className="muted">{isHost ? "Import a cube to draft from." : "Waiting for the host to import a cube…"}</p>
      )}

      {isHost && !cube && (
        <div className="starter-cube">
          <button className="btn violet" disabled={running} onClick={() => send({ t: "import", source: presetSource(STARTER_CUBE.id) })}>
            ⚡ Use the {STARTER_CUBE.name}
          </button>
          <span className="faint small-print">
            {STARTER_CUBE.cards} cards, bundled with the site so it loads instantly. Or import any cube below.
          </span>
        </div>
      )}

      {isHost && (
        <div className="import-box">
          <label className="label" htmlFor="import">
            {cube ? "Replace cube" : "Import cube"} — CubeCobra link or a card list
          </label>
          <textarea
            id="import"
            className="textarea"
            rows={5}
            placeholder={"https://cubecobra.com/cube/list/vintage\n\n— or paste a list —\n1 Lightning Bolt\nCounterspell\nBrazen Borrower (ELD) 39"}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={running}
          />
          <div className="row wrap">
            <button className="btn primary" disabled={running || !source.trim()} onClick={() => send({ t: "import", source })}>
              {running ? "Importing…" : "Import & validate"}
            </button>
            <span className="faint">Try:</span>
            {SAMPLE_CUBES.map((s) => (
              <button key={s.value} className="btn ghost small" disabled={running} onClick={() => setSource(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <p className="faint small-print">
            Accepts CubeCobra URLs, one name per line, "4 Card Name", Arena "(SET) 123" lines and CubeCobra CSV exports. Card data is looked up on Scryfall
            {solo ? " straight from your browser." : " and saved with the lobby."}
          </p>
        </div>
      )}
      {running && (
        <div className="import-progress">
          <span className="spinner" /> {view.importStatus.message}
        </div>
      )}
      {view.importStatus.state === "error" && <p className="pill bad">{view.importStatus.message}</p>}
    </section>
  );
}

const TIMER_OPTIONS = [0, 30, 45, 60, 75, 90, 120];

function SettingsPanel({ isHost }: { isHost: boolean }) {
  const view = useStore((s) => s.view)!;
  const send = useStore((s) => s.send);
  const d = view.config.draft;
  const g = view.config.game;
  const setDraft = (patch: Partial<DraftConfig>) => send({ t: "config", draft: patch });
  const setGame = (patch: Partial<GameConfig>) => send({ t: "config", game: patch });
  const needed = cardsNeeded(view.players.length, d);

  return (
    <section className="panel lobby-settings">
      <div className="section-head">
        <h2>Draft settings</h2>
        {!isHost && <span className="faint">host controls these</span>}
      </div>
      <fieldset disabled={!isHost} className="settings-grid">
        <NumberField label="Packs per player" value={d.packsPerPlayer} min={1} max={6} onChange={(v) => setDraft({ packsPerPlayer: v })} />
        <NumberField label="Cards per pack" value={d.cardsPerPack} min={2} max={30} onChange={(v) => setDraft({ cardsPerPack: v })} />
        <NumberField label="Picks per turn" value={d.picksPerTurn} min={1} max={5} onChange={(v) => setDraft({ picksPerTurn: v })} />
        <NumberField label="Burns per turn" value={d.burnsPerTurn} min={0} max={5} onChange={(v) => setDraft({ burnsPerTurn: v })} hint="Discard extra cards each pick — speeds up small pods." />
        <label className="field">
          <span className="label">Passing</span>
          <select className="select" value={d.passPattern} onChange={(e) => setDraft({ passPattern: e.target.value as DraftConfig["passPattern"] })}>
            <option value="alternate">Left, right, left… (standard)</option>
            <option value="left">Always left</option>
          </select>
        </label>
        <label className="field">
          <span className="label">Pick timer</span>
          <div className="row">
            <select className="select" value={d.pickTimerSec} onChange={(e) => setDraft({ pickTimerSec: Number(e.target.value) })}>
              {TIMER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === 0 ? "No limit" : `${t}s`}
                </option>
              ))}
            </select>
            {d.pickTimerSec > 0 && (
              <select className="select" value={d.timerStyle} onChange={(e) => setDraft({ timerStyle: e.target.value as DraftConfig["timerStyle"] })}>
                <option value="fixed">Same every pick</option>
                <option value="shrinking">Shrinks with pack</option>
              </select>
            )}
          </div>
        </label>
        <label className="field check">
          <input type="checkbox" checked={d.allowDuplicates} onChange={(e) => setDraft({ allowDuplicates: e.target.checked })} />
          <span>Allow duplicate cards across packs</span>
        </label>
        <label className="field">
          <span className="label">Foil chance per pack: {Math.round(d.foilChance * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={d.foilChance} onChange={(e) => setDraft({ foilChance: Number(e.target.value) })} />
        </label>
      </fieldset>
      <p className={`pool-check ${view.cube && view.cube.size >= needed ? "ok" : ""}`}>
        {view.players.length} seat(s) × {d.packsPerPlayer} packs × {d.cardsPerPack} cards = <b>{needed}</b> cards needed
        {view.cube && (
          <>
            {" "}
            · cube has <b>{view.cube.size}</b> {view.cube.size >= needed || d.allowDuplicates ? "✓" : "✗"}
          </>
        )}
      </p>

      <div className="section-head">
        <h2>Game settings</h2>
      </div>
      <fieldset disabled={!isHost} className="settings-grid">
        <NumberField label="Starting life" value={g.startingLife} min={1} max={999} onChange={(v) => setGame({ startingLife: v })} />
        <NumberField label="Minimum deck size" value={g.minDeckSize} min={1} max={200} onChange={(v) => setGame({ minDeckSize: v })} />
        <NumberField label="Opening hand" value={g.openingHandSize} min={0} max={20} onChange={(v) => setGame({ openingHandSize: v })} />
      </fieldset>
    </section>
  );
}

function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= min && n <= max && n !== value) onChange(n);
  };
  return (
    <div className="field" title={hint}>
      <span className="label">{label}</span>
      <div className="stepper">
        <button type="button" className="btn small" onClick={() => value > min && onChange(value - 1)}>
          −
        </button>
        <input
          className="input"
          inputMode="numeric"
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        />
        <button type="button" className="btn small" onClick={() => value < max && onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}
