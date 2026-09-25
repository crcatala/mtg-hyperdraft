// Tabletop screen: 3D canvas underneath, DOM HUD on top (players, hand, actions, log, dialogs).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverNow, useStore } from "../store";
import { CardView } from "../components/CardView";
import { PreviewPane } from "../components/Preview";
import { NameEditor } from "../components/TopBar";
import { TableCanvas, seatHue } from "./TableScene";
import { act, askNumber, cardLabel, handMenu, moveTo, pileMenu, pingAt, playFromHand, targetIds, toggleTap, turnHandCard, useTableUi } from "./tableUi";
import { beginDrag, tableApi } from "./drag";
import { handLayout } from "./handLayout";
import { relativeTime, RELATIVE_TIME_REFRESH_MS } from "../relativeTime";
import type { Color, TableCard, TokenDef, ZoneName } from "../../shared/types";
import { COLORS, ZONE_LABELS } from "../../shared/types";

export function TableScreen() {
  useTableShortcuts();
  return (
    <div className="screen table-screen">
      <TableCanvas />
      <PlayersHud />
      <TurnBar />
      <ActionBar />
      <LogPanel />
      <Hand />
      <HandDragGhost />
      <PreviewPane width={300} top={130} />
      <ZoneViewer />
      <TokenDialog />
      <AskDialog />
      <HelpOverlay />
    </div>
  );
}

// --- keyboard -------------------------------------------------------------------------------

/** Whether the pointer is over the 3D table itself (not the HUD, hand or a dialog). */
function overTable(clientX: number, clientY: number): boolean {
  return !!document.elementFromPoint(clientX, clientY)?.closest(".table-canvas");
}

function useTableShortcuts() {
  useEffect(() => {
    const pointer = { x: -1, y: -1 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useTableUi.getState();
      if (ui.ask) return;
      const k = e.key.toLowerCase();
      const ids = targetIds();
      switch (k) {
        case "tab": {
          // Ping under the pointer, like Tabletop Simulator. Elsewhere (HUD, dialogs) Tab keeps
          // moving keyboard focus as usual.
          if (!overTable(pointer.x, pointer.y)) return;
          e.preventDefault();
          const pt = tableApi.screenToTable(pointer.x, pointer.y);
          if (pt && !e.repeat) pingAt(pt.x, pt.y);
          break;
        }
        case " ":
        case "t":
          e.preventDefault();
          toggleTap(ids);
          break;
        case "f":
          if (ids.length) act({ a: "flip", ids });
          break;
        case "r":
          if (ui.handHover && !ui.hovered) turnHandCard(ui.handHover);
          else if (ids.length === 1) act({ a: "turnFace", id: ids[0] });
          break;
        case "g":
          moveTo(ids, "graveyard");
          break;
        case "x":
          moveTo(ids, "exile");
          break;
        case "h":
          moveTo(ids, "hand");
          break;
        case "c":
          if (ids.length === 1) act({ a: "counter", id: ids[0], kind: "+1/+1", delta: e.shiftKey ? -1 : 1 });
          break;
        case "d":
          if (e.shiftKey) askNumber("Draw how many?", 2, (n) => act({ a: "draw", n }));
          else act({ a: "draw", n: 1 });
          break;
        case "u":
          act({ a: "untapAll" });
          break;
        case "n":
          act({ a: "nextTurn" });
          break;
        case "v":
          ui.set({ overview: !ui.overview });
          break;
        case "?":
          ui.set({ help: !ui.help });
          break;
        case "escape":
          ui.set({ selected: [], viewer: null, tokenDialog: false, help: false });
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);
}

// --- HUD ------------------------------------------------------------------------------------

function PlayersHud() {
  const table = useStore((s) => s.view!.table!);
  const players = useStore((s) => s.view!.players);
  const me = useStore((s) => s.view!.you);
  return (
    <div className="players-hud">
      {table.seats.map((pid, seat) => {
        const tp = table.players[pid];
        const p = players.find((x) => x.id === pid);
        const active = table.turn.playerId === pid;
        const bump = (delta: number) => act({ a: "life", playerId: pid, delta });
        return (
          <div key={pid} className={`hud-player${active ? " active" : ""}${pid === me ? " me" : ""}`} style={{ "--hue": seatHue(seat) } as React.CSSProperties}>
            <div className="hud-name">
              {pid === me ? <NameEditor /> : <span>{p?.name}</span>}
              {p && !p.connected && <span className="pill bad">away</span>}
              {active && <span className="pill ok">turn</span>}
            </div>
            <div className="hud-life">
              <button className="life-btn" onClick={(e) => bump(e.shiftKey ? -5 : -1)} title="−1 (Shift: −5)">
                −
              </button>
              <LifeTotal value={tp.life} onSet={(v) => bump(v - tp.life)} />
              <button className="life-btn" onClick={(e) => bump(e.shiftKey ? 5 : 1)} title="+1 (Shift: +5)">
                +
              </button>
            </div>
            <div className="hud-meta">
              <span title="Poison counters" className="poison" onClick={(e) => act({ a: "poison", playerId: pid, delta: e.shiftKey ? -1 : 1 })}>
                ☠ {tp.poison}
              </span>
              <span title="Cards in hand">✋ {tp.zones.hand.length}</span>
              <span title="Library" onContextMenu={(e) => (e.preventDefault(), pileMenu(pid, "library", e.clientX, e.clientY))}>
                📚 {tp.zones.library.length}
              </span>
              <span title="Graveyard — click to view" className="clickable" onClick={() => useTableUi.getState().setViewer({ playerId: pid, zone: "graveyard" })}>
                🪦 {tp.zones.graveyard.length}
              </span>
              <span title="Exile — click to view" className="clickable" onClick={() => useTableUi.getState().setViewer({ playerId: pid, zone: "exile" })}>
                ✧ {tp.zones.exile.length}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LifeTotal({ value, onSet }: { value: number; onSet: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (value !== prev.current) {
      setFlash(value > prev.current ? "up" : "down");
      prev.current = value;
      const t = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(t);
    }
  }, [value]);
  if (editing) {
    const commit = () => {
      const n = parseInt(text, 10);
      if (Number.isFinite(n)) onSet(n);
      setEditing(false);
    };
    return <input className="life-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
  }
  return (
    <span
      className={`life-total${flash ? ` flash-${flash}` : ""}`}
      title="Click to set"
      onClick={() => {
        setText(String(value));
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}

function TurnBar() {
  const table = useStore((s) => s.view!.table!);
  const players = useStore((s) => s.view!.players);
  const me = useStore((s) => s.view!.you);
  const name = players.find((p) => p.id === table.turn.playerId)?.name ?? "?";
  const mine = table.turn.playerId === me;
  return (
    <div className="turn-bar panel">
      <span className="turn-label">
        Round {table.turn.number} · <b>{mine ? "Your turn" : `${name}'s turn`}</b>
      </span>
      <button className={`btn small ${mine ? "primary" : ""}`} onClick={() => act({ a: "nextTurn" })} title="Pass the turn (N)">
        End turn ⏭
      </button>
    </div>
  );
}

function ActionBar() {
  const overview = useTableUi((s) => s.overview);
  const set = useTableUi((s) => s.set);
  const [dice, setDice] = useState(false);
  return (
    <div className="action-bar panel">
      <button className="btn small" onClick={() => act({ a: "draw", n: 1 })} title="Draw a card (D)">
        Draw
      </button>
      <button className="btn small" onClick={() => act({ a: "untapAll" })} title="Untap all your permanents (U)">
        Untap all
      </button>
      <button className="btn small" onClick={() => act({ a: "shuffle" })} title="Shuffle your library">
        Shuffle
      </button>
      <button className="btn small" onClick={() => set({ tokenDialog: true })} title="Create a token">
        + Token
      </button>
      <div className="dice-wrap">
        <button className="btn small" onClick={() => setDice((d) => !d)}>
          🎲 Dice
        </button>
        {dice && (
          <div className="dice-menu panel">
            {[2, 6, 20].map((s) => (
              <button
                key={s}
                className="btn small"
                onClick={() => {
                  act({ a: "roll", sides: s });
                  setDice(false);
                }}
              >
                {s === 2 ? "Coin" : `d${s}`}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className={`btn small${overview ? " on" : ""}`} onClick={() => set({ overview: !overview })} title="Toggle overhead view (V)">
        {overview ? "My view" : "Overview"}
      </button>
      <button className="btn small ghost" onClick={() => set({ help: true })} title="Controls (?)">
        ?
      </button>
    </div>
  );
}

/** Server-clock "now", refreshed every `ms` while `active` (drives relative timestamps). */
function useServerNow(ms: number, active: boolean) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const iv = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(iv);
  }, [ms, active]);
  return now;
}

function LogPanel() {
  const log = useStore((s) => s.view!.table!.log);
  const open = useTableUi((s) => s.logOpen);
  const set = useTableUi((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const tick = useServerNow(RELATIVE_TIME_REFRESH_MS, open);
  // A new entry is always "Just now", even between ticks.
  const now = Math.max(tick, log.at(-1)?.at ?? 0);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [log.length, open]);
  return (
    <div className={`log-panel panel${open ? "" : " closed"}`}>
      <button className="log-head" onClick={() => set({ logOpen: !open })}>
        Game log {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="log-body scroll" ref={ref}>
          {log.slice(-80).map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-text">{l.text}</span>
              <time className="log-time" dateTime={new Date(l.at).toISOString()} title={new Date(l.at).toLocaleString()}>
                {relativeTime(now - l.at)}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- hand -----------------------------------------------------------------------------------

/** Width of an element, tracked with a ResizeObserver. */
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function Hand() {
  const view = useStore((s) => s.view!);
  const cards = useStore((s) => s.cards);
  const setPreview = useStore((s) => s.setPreview);
  const drag = useTableUi((s) => s.drag);
  const handFaces = useTableUi((s) => s.handFaces);
  const table = view.table!;
  const hand = table.players[view.you]?.zones.hand ?? [];
  const n = hand.length;
  const zone = useRef<HTMLDivElement>(null);
  // Leave a little room for the card lifted on hover (it scales up past its neighbours).
  const layout = handLayout(n, useWidth(zone, 900) - 40);
  const cardH = Math.round((layout.width * 88) / 63);
  // Each card's hit box stays where the card rests; only its visual lifts on hover. So sliding along
  // the hand hovers one card after another instead of getting stuck on the lifted one.
  return (
    <div ref={zone} className={`hand-zone${drag?.source === "battlefield" && drag.overHand ? " drop" : ""}`}>
      <div className="hand-fan" style={{ width: layout.fanWidth, "--card-h": `${cardH}px` } as React.CSSProperties}>
        {hand.map((id, i) => {
          const card = table.cards[id];
          const data = card?.cardId ? cards[card.cardId] : undefined;
          const face = handFaces[id] ?? 0;
          const dragging = drag?.source === "hand" && drag.ids.includes(id);
          return (
            <div
              key={id}
              className={`hand-card${dragging ? " dragging" : ""}`}
              style={{ left: i * layout.spread, width: layout.width, "--rot": `${layout.rot(i)}deg`, "--arc": `${layout.arc(i)}px`, "--z": i + 1 } as React.CSSProperties}
              onPointerEnter={() => {
                useTableUi.getState().set({ handHover: id });
                if (data) setPreview({ cardId: data.id, face, foil: card.foil });
              }}
              onPointerLeave={() => {
                if (useTableUi.getState().handHover === id) useTableUi.getState().set({ handHover: null });
                setPreview({});
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                beginDrag(e.nativeEvent, "hand", [id], () => {});
              }}
              onDoubleClick={() => playFromHand(id)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (card) handMenu(card, e.clientX, e.clientY);
              }}
            >
              <div className="hand-card-visual">
                <CardView card={data} foil={card?.foil} face={face} width={layout.width} flippable onFlip={() => turnHandCard(id)} />
              </div>
            </div>
          );
        })}
      </div>
      {n === 0 && <div className="hand-empty faint">Your hand is empty · press D to draw</div>}
    </div>
  );
}

function HandDragGhost() {
  const drag = useTableUi((s) => s.drag);
  const cards = useStore((s) => s.cards);
  const table = useStore((s) => s.view?.table);
  const handFaces = useTableUi((s) => s.handFaces);
  // Over the table the card is drawn in 3D where it will land (see HandDragCard in TableScene).
  if (!drag || drag.source !== "hand" || !drag.overHand || !table) return null;
  const card = table.cards[drag.ids[0]];
  const data = card?.cardId ? cards[card.cardId] : undefined;
  return (
    <div className="drag-ghost" style={{ left: drag.clientX, top: drag.clientY }}>
      <CardView card={data} face={handFaces[drag.ids[0]] ?? 0} width={120} />
    </div>
  );
}

// --- dialogs --------------------------------------------------------------------------------

function ZoneViewer() {
  const viewer = useTableUi((s) => s.viewer);
  const setViewer = useTableUi((s) => s.setViewer);
  const table = useStore((s) => s.view?.table);
  const players = useStore((s) => s.view?.players ?? []);
  const me = useStore((s) => s.view?.you);
  const cards = useStore((s) => s.cards);
  const setPreview = useStore((s) => s.setPreview);

  if (!viewer || !table) return null;
  const tp = table.players[viewer.playerId];
  if (!tp) return null;
  const mine = viewer.playerId === me;
  let ids = tp.zones[viewer.zone];
  const peek = viewer.zone === "library" ? table.peek[viewer.playerId] ?? 0 : 0;
  if (viewer.zone === "library") ids = ids.slice(0, peek);
  const ownerName = players.find((p) => p.id === viewer.playerId)?.name ?? "Player";
  const searching = viewer.zone === "library" && peek >= tp.zones.library.length;

  const close = (shuffle = false) => {
    if (viewer.zone === "library" && mine) {
      act({ a: "peek", n: 0 });
      if (shuffle) act({ a: "shuffle" });
    }
    setViewer(null);
  };

  const menuFor = (card: TableCard, x: number, y: number) => {
    if (!mine && viewer.zone !== "graveyard" && viewer.zone !== "exile") return;
    const destinations: [string, ZoneName, boolean?][] = [
      ["To hand", "hand"],
      ["To battlefield", "battlefield"],
      ["To graveyard", "graveyard"],
      ["Exile", "exile"],
      ["Top of library", "library"],
      ["Bottom of library", "library", true],
    ];
    useStore.getState().openMenu({
      x,
      y,
      title: cardLabel(card),
      items: destinations
        .filter(([, z]) => z !== card.zone || z === "library")
        .map(([label, zone, bottom]) => ({ label, onSelect: () => moveTo([card.id], zone, bottom ? { bottom: true } : {}) })),
    });
  };

  const title = viewer.zone === "library" ? (searching ? "Searching library" : `Top ${peek} of library`) : `${mine ? "Your" : `${ownerName}'s`} ${ZONE_LABELS[viewer.zone].toLowerCase()}`;
  const shown = viewer.zone === "graveyard" || viewer.zone === "exile" ? ids.slice().reverse() : ids;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal panel zone-viewer">
        <div className="row">
          <h2>{title}</h2>
          <span className="muted">({ids.length})</span>
          <div className="spacer" />
          {viewer.zone === "library" && mine && (
            <button className="btn small" onClick={() => close(true)}>
              Shuffle & close
            </button>
          )}
          <button className="btn small" onClick={() => close()}>
            Close
          </button>
        </div>
        <p className="faint">{mine || viewer.zone === "graveyard" || viewer.zone === "exile" ? "Right-click (or click) a card for options. " : ""}{viewer.zone === "graveyard" || viewer.zone === "exile" ? "Most recent first." : viewer.zone === "library" ? "Top of library first." : ""}</p>
        <div className="zone-grid scroll">
          {shown.map((id) => {
            const card = table.cards[id];
            if (!card) return null;
            const data = card.cardId ? cards[card.cardId] : undefined;
            return (
              <div
                key={id}
                className="zone-card"
                onClick={(e) => menuFor(card, e.clientX, e.clientY)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  menuFor(card, e.clientX, e.clientY);
                }}
                onPointerEnter={() => data && setPreview({ cardId: data.id })}
                onPointerLeave={() => setPreview({})}
              >
                <CardView card={data} token={card.token} back={card.hidden} width={140} flippable />
              </div>
            );
          })}
          {ids.length === 0 && <p className="muted">Nothing here.</p>}
        </div>
      </div>
    </div>
  );
}

const TOKEN_PRESETS: TokenDef[] = [
  { name: "Treasure", colors: [], text: "{T}, Sacrifice this artifact: Add one mana of any color." },
  { name: "Clue", colors: [], text: "{2}, Sacrifice this artifact: Draw a card." },
  { name: "Food", colors: [], text: "{2}, {T}, Sacrifice this artifact: You gain 3 life." },
  { name: "Soldier", power: "1", toughness: "1", colors: ["W"] },
  { name: "Spirit", power: "1", toughness: "1", colors: ["W"], text: "Flying" },
  { name: "Goblin", power: "1", toughness: "1", colors: ["R"] },
  { name: "Zombie", power: "2", toughness: "2", colors: ["B"] },
  { name: "Beast", power: "3", toughness: "3", colors: ["G"] },
  { name: "Elemental", power: "1", toughness: "1", colors: ["R"] },
  { name: "Construct", power: "0", toughness: "0", colors: [] },
];

function TokenDialog() {
  const open = useTableUi((s) => s.tokenDialog);
  const set = useTableUi((s) => s.set);
  const table = useStore((s) => s.view?.table);
  const cards = useStore((s) => s.cards);
  const me = useStore((s) => s.view?.you);
  const [tok, setTok] = useState<TokenDef>({ name: "", power: "1", toughness: "1", colors: [] });
  const [count, setCount] = useState(1);

  // Tokens that the cards you control mention (from Scryfall's related-card data).
  const related = useMemo(() => {
    if (!table || !me) return [];
    const names = new Set<string>();
    for (const c of Object.values(table.cards)) {
      if (c.controller !== me || c.hidden || !c.cardId) continue;
      for (const t of cards[c.cardId]?.tokens ?? []) names.add(t.name);
    }
    return [...names];
  }, [table, me, cards]);

  if (!open) return null;
  const create = () => {
    if (!tok.name.trim()) return;
    const clean: TokenDef = { ...tok, name: tok.name.trim(), power: tok.power?.trim() || undefined, toughness: tok.toughness?.trim() || undefined, text: tok.text?.trim() || undefined };
    act({ a: "token", token: clean, count });
    set({ tokenDialog: false });
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && set({ tokenDialog: false })}>
      <div className="modal panel token-dialog">
        <h2>Create token</h2>
        <div className="token-layout">
          <div className="col">
            <div className="token-presets">
              {related.map((name) => (
                <button key={`r-${name}`} className="btn small violet" onClick={() => setTok({ ...tok, name })}>
                  {name}
                </button>
              ))}
              {TOKEN_PRESETS.map((p) => (
                <button key={p.name} className="btn small" onClick={() => setTok({ ...p })}>
                  {p.power ? `${p.power}/${p.toughness} ` : ""}
                  {p.name}
                </button>
              ))}
            </div>
            <label className="field">
              <span className="label">Name</span>
              <input className="input" autoFocus value={tok.name} maxLength={40} onChange={(e) => setTok({ ...tok, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} />
            </label>
            <div className="row">
              <label className="field">
                <span className="label">Power</span>
                <input className="input" value={tok.power ?? ""} maxLength={4} onChange={(e) => setTok({ ...tok, power: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">Toughness</span>
                <input className="input" value={tok.toughness ?? ""} maxLength={4} onChange={(e) => setTok({ ...tok, toughness: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">How many</span>
                <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
              </label>
            </div>
            <div className="row">
              <span className="label" style={{ margin: 0 }}>
                Colours
              </span>
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`chip${tok.colors.includes(c) ? " on" : ""}`}
                  onClick={() => setTok({ ...tok, colors: tok.colors.includes(c) ? tok.colors.filter((x) => x !== c) : ([...tok.colors, c] as Color[]) })}
                >
                  <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
                </button>
              ))}
            </div>
            <label className="field">
              <span className="label">Rules text (optional)</span>
              <input className="input" value={tok.text ?? ""} maxLength={200} onChange={(e) => setTok({ ...tok, text: e.target.value })} />
            </label>
          </div>
          <CardView token={tok.name ? tok : { ...tok, name: "Token" }} width={190} />
        </div>
        <div className="row">
          <div className="spacer" />
          <button className="btn" onClick={() => set({ tokenDialog: false })}>
            Cancel
          </button>
          <button className="btn primary" disabled={!tok.name.trim()} onClick={create}>
            Create {count > 1 ? `${count} tokens` : "token"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AskDialog() {
  const ask = useTableUi((s) => s.ask);
  const set = useTableUi((s) => s.set);
  const [value, setValue] = useState("");
  useEffect(() => setValue(ask?.initial ?? ""), [ask]);
  if (!ask) return null;
  const submit = () => {
    set({ ask: null });
    ask.onSubmit(value);
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && set({ ask: null })}>
      <div className="modal panel ask-dialog">
        <p className="ask-q">{ask.question}</p>
        {ask.kind !== "confirm" && (
          <input
            className="input"
            autoFocus
            type={ask.kind === "number" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") set({ ask: null });
            }}
          />
        )}
        <div className="row">
          <div className="spacer" />
          <button className="btn" onClick={() => set({ ask: null })}>
            Cancel
          </button>
          <button className="btn primary" autoFocus={ask.kind === "confirm"} onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Drag", "Move cards — onto piles, back to your hand, or anywhere on the table"],
  ["Double-click", "Tap / untap a permanent · play a card from hand · draw from your library"],
  ["Right-click", "Card, pile and library menus (counters, face down, scry, search, mill…)"],
  ["Shift-click", "Select several cards (then drag or use keys on all of them)"],
  ["Space / T", "Tap or untap the hovered / selected cards"],
  ["F", "Turn face down / face up"],
  ["R", "Transform a double-faced card (on the table, or turn it over in your hand)"],
  ["Tab", "Ping the spot under the pointer — everyone sees and hears it"],
  ["G / X / H", "Send to graveyard / exile / hand"],
  ["C / Shift+C", "Add / remove a +1/+1 counter"],
  ["D / Shift+D", "Draw a card / draw X"],
  ["U", "Untap all your permanents"],
  ["N", "End turn"],
  ["Arrows · Q/E · wheel", "Pan · rotate · zoom the camera (or drag empty table / middle mouse)"],
  ["V · Home", "Overhead view · reset camera"],
  ["` (backtick)", "Debug console"],
];

function HelpOverlay() {
  const help = useTableUi((s) => s.help);
  const set = useTableUi((s) => s.set);
  if (!help) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && set({ help: false })}>
      <div className="modal panel help">
        <div className="row">
          <h2>Table controls</h2>
          <div className="spacer" />
          <button className="btn small" onClick={() => set({ help: false })}>
            Close
          </button>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="faint">This is a freeform table — no rules are enforced, just like playing in person. Everything you do shows up in the game log.</p>
      </div>
    </div>
  );
}

