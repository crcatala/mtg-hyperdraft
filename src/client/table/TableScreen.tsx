// Tabletop screen: 3D canvas underneath, DOM HUD on top (players, hand, actions, log, dialogs).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverNow, useStore } from "../store";
import { CardView } from "../components/CardView";
import { PreviewPane } from "../components/Preview";
import { NameEditor } from "../components/TopBar";
import { PublicRoomChip } from "../components/PublicRoomChip";
import { Icon } from "../components/Icon";
import { TableCanvas, seatHue } from "./TableScene";
import { act, askNumber, cardLabel, clickHandCard, handMenu, moveTo, pileMenu, pingAt, seatsFromMe, targetIds, toggleTap, turnHandCard, useTableUi, viewFrom } from "./tableUi";
import { CardCarousel, type CarouselItem } from "../components/CardCarousel";
import { beginDrag, tableApi } from "./drag";
import { handLayout } from "./handLayout";
import { reducedMotion, startTableMotion, useMotion } from "./motion";
import { relativeTime, RELATIVE_TIME_REFRESH_MS } from "../relativeTime";
import { countNewEntries, logKeys } from "./logFeed";
import { AnchoredPreview } from "../components/AnchoredPreview";
import { Tooltip } from "../components/Tooltip";
import { logSegments } from "../../shared/logText";
import { activePeek } from "../../shared/table";
import type { IconName } from "../icons";
import type { CardData, Color, LogEntry, LogKind, LogMark, TableCard, TokenDef, ZoneName } from "../../shared/types";
import { COLORS, ZONE_LABELS } from "../../shared/types";

export function TableScreen() {
  useTableShortcuts();
  useEffect(() => startTableMotion(), []);
  return (
    <div className="screen table-screen">
      <TableCanvas />
      <PlayersHud />
      <TurnBar />
      <TableDock />
      <LogPanel />
      <LogZoom />
      <Hand />
      <HandDragGhost />
      <HandZoom />
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
      // Dialogs and the zoom carousels own the keyboard while open.
      if (ui.ask || ui.handZoom || ui.logZoom) return;
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
          else if (ui.handSelected && !ui.hovered && ids.length === 0) turnHandCard(ui.handSelected);
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
        case "1":
        case "2":
        case "3":
        case "4": {
          // View from a seat, numbered as the camera switcher lists them (you're 1).
          const view = useStore.getState().view;
          const pid = view?.table && seatsFromMe(view.table.seats, view.you)[Number(k) - 1];
          if (!pid) return;
          viewFrom(pid);
          break;
        }
        case "?":
          ui.set({ help: !ui.help });
          break;
        case "escape":
          // Esc closes an open menu first (it listens for Esc itself), not the dialog behind it.
          if (useStore.getState().menu) return;
          ui.set({ selected: [], handSelected: null, viewer: null, tokenDialog: false, help: false });
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
        const look = p && !p.connected ? undefined : table.looks?.[pid];
        return (
          <div key={pid} className={`hud-player${active ? " active" : ""}${pid === me ? " me" : ""}${p && !p.connected ? " offline" : ""}`} style={{ "--hue": seatHue(seat) } as React.CSSProperties}>
            <div className="hud-name">
              {pid === me ? <NameEditor /> : <span>{p?.name}</span>}
              {p && !p.connected && (
                <span className="pill bad" title="Disconnected: their cards stay put until they're back">
                  <Icon name="offline" /> offline
                </span>
              )}
              {look && (
                <span className="pill look" title={look.kind === "search" ? "Searching their library" : `Looking at the top ${look.n} cards of their library (${look.left} left)`}>
                  <Icon name={look.kind === "search" ? "search" : "eye"} /> {look.kind === "search" ? "searching" : `top ${look.n}`}
                </span>
              )}
              {active && <span className="pill ok">turn</span>}
            </div>
            <div className="hud-life">
              <button className="life-btn" onClick={(e) => bump(e.shiftKey ? -5 : -1)} title="−1 (Shift: −5)">
                <Icon name="minus" />
              </button>
              <LifeTotal value={tp.life} onSet={(v) => bump(v - tp.life)} />
              <button className="life-btn" onClick={(e) => bump(e.shiftKey ? 5 : 1)} title="+1 (Shift: +5)">
                <Icon name="plus" />
              </button>
            </div>
            <div className="hud-meta">
              <span title="Poison counters" className="poison" onClick={(e) => act({ a: "poison", playerId: pid, delta: e.shiftKey ? -1 : 1 })}>
                <Icon name="skull" /> {tp.poison}
              </span>
              <span title="Cards in hand">
                <Icon name="hand" /> {tp.zones.hand.length}
              </span>
              <span title="Library" onContextMenu={(e) => (e.preventDefault(), pileMenu(pid, "library", e.clientX, e.clientY))}>
                <Icon name="library" /> {tp.zones.library.length}
              </span>
              <span title="Graveyard — click to view" className="clickable" onClick={() => useTableUi.getState().setViewer({ playerId: pid, zone: "graveyard" })}>
                <Icon name="graveyard" /> {tp.zones.graveyard.length}
              </span>
              <span title="Exile — click to view" className="clickable" onClick={() => useTableUi.getState().setViewer({ playerId: pid, zone: "exile" })}>
                <Icon name="exile" /> {tp.zones.exile.length}
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
      // Opening the field and leaving it unchanged (or blank) is not a life change.
      if (Number.isFinite(n) && n !== value) onSet(n);
      setEditing(false);
    };
    return (
      <input
        className="life-input"
        autoFocus
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
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
      <PublicRoomChip />
      <button className={`btn small ${mine ? "primary" : ""}`} onClick={() => act({ a: "nextTurn" })} title="Pass the turn (N)">
        End turn <Icon name="skip" />
      </button>
    </div>
  );
}

// --- dock: table actions + camera ---------------------------------------------------------

function TableDock() {
  return (
    <div className="table-dock">
      <ActionBar />
      <CameraSwitcher />
    </div>
  );
}

/** A toolbar tile: icon over a short label, with the full description and shortcut in a tooltip. */
function DockButton({ icon, label, tip, keys, on, onClick }: { icon: IconName; label: string; tip: string; keys?: string; on?: boolean; onClick: () => void }) {
  return (
    <Tooltip
      placement="bottom"
      content={
        <span className="dock-tip">
          {tip} {keys && <kbd>{keys}</kbd>}
        </span>
      }
    >
      <button className={`dock-btn${on ? " on" : ""}`} onClick={onClick} aria-label={tip} aria-pressed={on}>
        <Icon name={icon} />
        <span className="dock-label">{label}</span>
      </button>
    </Tooltip>
  );
}

function ActionBar() {
  const set = useTableUi((s) => s.set);
  const [dice, setDice] = useState(false);
  const diceRef = useRef<HTMLDivElement>(null);
  // Clicking anywhere else closes the dice menu.
  useEffect(() => {
    if (!dice) return;
    const onDown = (e: PointerEvent) => {
      if (!diceRef.current?.contains(e.target as Node)) setDice(false);
    };
    // Esc closes it too (capture phase, so the table doesn't also clear its selection).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setDice(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [dice]);
  return (
    <div className="dock-actions panel" role="toolbar" aria-label="Table actions">
      <DockButton icon="draw" label="Draw" tip="Draw a card" keys="D" onClick={() => act({ a: "draw", n: 1 })} />
      <DockButton icon="untap" label="Untap" tip="Untap all your permanents" keys="U" onClick={() => act({ a: "untapAll" })} />
      <DockButton icon="shuffle" label="Shuffle" tip="Shuffle your library" onClick={() => act({ a: "shuffle" })} />
      <DockButton icon="sparkle" label="Token" tip="Create a token" onClick={() => set({ tokenDialog: true })} />
      <div className="dice-wrap" ref={diceRef}>
        <DockButton icon="dice" label="Roll" tip="Flip a coin or roll a die" on={dice} onClick={() => setDice((d) => !d)} />
        {dice && (
          <div className="dice-menu panel">
            {[2, 6, 20].map((s) => (
              <button
                key={s}
                className="dice-opt"
                onClick={() => {
                  act({ a: "roll", sides: s });
                  setDice(false);
                }}
              >
                <b>{s === 2 ? "Coin" : `d${s}`}</b>
                <span className="faint">{s === 2 ? "heads / tails" : `1–${s}`}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="dock-sep" aria-hidden />
      <DockButton icon="help" label="Help" tip="Table controls" keys="?" onClick={() => set({ help: true })} />
    </div>
  );
}

/** Where the camera sits: behind any player's seat, or high above the whole table. */
function CameraSwitcher() {
  const table = useStore((s) => s.view!.table!);
  const players = useStore((s) => s.view!.players);
  const me = useStore((s) => s.view!.you);
  const overview = useTableUi((s) => s.overview);
  const pov = useTableUi((s) => s.pov);
  const set = useTableUi((s) => s.set);
  const order = seatsFromMe(table.seats, me);
  const current = pov && table.seats.includes(pov) ? pov : me;
  return (
    <div className="camera-switch panel" role="group" aria-label="Camera">
      <span className="camera-label">
        <Icon name="eye" /> View
      </span>
      {order.map((pid, i) => {
        const mine = pid === me;
        const name = players.find((p) => p.id === pid)?.name ?? "Player";
        const active = !overview && current === pid;
        return (
          <Tooltip key={pid} placement="bottom" content={<span className="dock-tip">{mine ? "Your seat" : `${name}'s seat`} {<kbd>{i + 1}</kbd>}</span>}>
            <button
              aria-pressed={active}
              aria-label={mine ? "View from your seat" : `View from ${name}'s seat`}
              className={`camera-opt${active ? " active" : ""}`}
              style={{ "--hue": seatHue(table.seats.indexOf(pid)) } as React.CSSProperties}
              onClick={() => viewFrom(pid)}
            >
              <span className="seat-dot" />
              <span className="camera-name">{mine ? "You" : name}</span>
            </button>
          </Tooltip>
        );
      })}
      <Tooltip placement="bottom" content={<span className="dock-tip">Look down on the whole table <kbd>V</kbd></span>}>
        <button aria-pressed={overview} aria-label="Overhead view of the whole table" className={`camera-opt overview${overview ? " active" : ""}`} onClick={() => set({ overview: true })}>
          <Icon name="overview" />
          <span className="camera-name">Overview</span>
        </button>
      </Tooltip>
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

/**
 * The log follows new entries while you're at the bottom. Scrolled up (reading history), it holds
 * still — through new entries, trimmed old ones and relative-time refreshes alike — and offers an
 * "N new events" button that glides back down.
 */
function LogPanel() {
  const log = useStore((s) => s.view!.table!.log);
  const seats = useStore((s) => s.view!.table!.seats);
  const cards = useStore((s) => s.cards);
  const [hover, setHover] = useState<LogHover | null>(null);
  const open = useTableUi((s) => s.logOpen);
  const set = useTableUi((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const tick = useServerNow(RELATIVE_TIME_REFRESH_MS, open);
  // A new entry is always "Just now", even between ticks.
  const now = Math.max(tick, log.at(-1)?.at ?? 0);
  // Solo mode mutates the log array in place, so change is detected by content, not identity.
  const keys = logKeys(log);
  const newestKey = keys.at(-1) ?? "";

  /** Following the newest entry (scrolled to the bottom). */
  const stick = useRef(true);
  /** Gliding back down after "N new events" was clicked. */
  const gliding = useRef(false);
  /** While scrolled up: the first visible line and how far it sits below the top edge. */
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const newest = useRef<LogEntry | null>(null);
  const [unseen, setUnseen] = useState(0);

  // Reopening the panel starts at the latest entry (and with no preview left over from before).
  useEffect(() => {
    stick.current = true;
    gliding.current = false;
    setUnseen(0);
    setHover(null);
  }, [open]);

  // A hovered line trimmed off the top of the log never gets its pointerleave: drop its preview.
  useEffect(() => {
    if (hover && !ref.current?.querySelector(`[data-log-card="${CSS.escape(hover.key)}"]`)) setHover(null);
  });

  // Count entries that arrive while the reader is scrolled up.
  useLayoutEffect(() => {
    const added = countNewEntries(newest.current, log);
    newest.current = log.at(-1) ?? null;
    if (added > 0 && open && !stick.current && !gliding.current) setUnseen((n) => n + added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestKey, log.length, open]);

  // After every render: stay pinned to the bottom, or keep the anchored line exactly where it was.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || gliding.current) return;
    if (stick.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const a = anchor.current;
    const line = a && el.querySelector<HTMLElement>(`[data-key="${CSS.escape(a.key)}"]`);
    if (a && line) el.scrollTop = line.offsetTop - a.offset;
  });

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    // The preview would stay behind while its link scrolls away.
    setHover(null);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 6;
    if (atBottom) {
      stick.current = true;
      gliding.current = false;
      anchor.current = null;
      setUnseen(0);
      return;
    }
    if (gliding.current) return;
    stick.current = false;
    for (const line of el.querySelectorAll<HTMLElement>(".log-line")) {
      if (line.offsetTop + line.offsetHeight > el.scrollTop) {
        anchor.current = { key: line.dataset.key!, offset: line.offsetTop - el.scrollTop };
        break;
      }
    }
  };

  const toLatest = () => {
    const el = ref.current;
    if (!el) return;
    gliding.current = true;
    setUnseen(0);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={`log-panel panel${open ? "" : " closed"}`}>
      <button className="log-head" onClick={() => set({ logOpen: !open })}>
        Game log <Icon name={open ? "chevron-down" : "chevron-right"} />
      </button>
      {open && (
        <div
          className="log-body scroll"
          ref={ref}
          onScroll={onScroll}
          // Taking the wheel back during the glide down stops it where the reader is.
          onWheel={() => (gliding.current = false)}
          onPointerDown={() => (gliding.current = false)}
        >
          {log.map((l, i) => (
            <LogLine key={keys[i]} entry={l} lineKey={keys[i]} seats={seats} cards={cards} now={now} onHoverCard={setHover} />
          ))}
        </div>
      )}
      {open && hover && <AnchoredPreview card={hover.card} face={hover.face} anchor={hover.rect} width={230} prefer="right" />}
      {open && unseen > 0 && (
        <button className="log-new" onClick={toLatest}>
          <Icon name="arrow-down" /> {unseen} new event{unseen === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}

const LOG_ICONS: Record<LogKind, IconName> = {
  start: "sparkles",
  battlefield: "play",
  hand: "hand",
  graveyard: "graveyard",
  exile: "exile",
  library: "library",
  sideboard: "copy",
  tap: "tap",
  untap: "untap",
  flip: "flip",
  transform: "flip",
  draw: "draw",
  shuffle: "shuffle",
  mill: "graveyard",
  peek: "search",
  life: "heart",
  poison: "skull",
  counter: "counter",
  token: "sparkle",
  mulligan: "hand",
  turn: "skip",
  roll: "dice",
  reveal: "eye",
};

/** A card link under the pointer, previewed beside the log. */
interface LogHover {
  /** The link's data-log-card key. */
  key: string;
  card: CardData;
  face: number;
  rect: DOMRect;
}

/** Zone names as the log spells them, for colouring ("the battlefield" → battlefield). */
const zoneClass = (text: string) => text.replace(/^the /, "").toLowerCase();

/**
 * One log line: an icon for what happened, then the sentence with players in their seat colour,
 * the action in bold and card names as links (hover to preview, click to zoom in). Turn changes
 * read as dividers.
 */
function LogLine({
  entry,
  lineKey,
  seats,
  cards,
  now,
  onHoverCard,
}: {
  entry: LogEntry;
  lineKey: string;
  seats: string[];
  cards: Record<string, CardData>;
  now: number;
  onHoverCard: (h: LogHover | null) => void;
}) {
  const kind = entry.kind;
  const divider = kind === "turn";
  const actorSeat = seats.indexOf(entry.playerId);
  const render = (text: string, mark: LogMark | undefined, i: number) => {
    if (!mark) return text;
    switch (mark[2]) {
      case "p": {
        const seat = seats.indexOf(mark[3]);
        return (
          <span key={i} className={`log-player${seat < 0 ? " gone" : ""}`} style={seat < 0 ? undefined : ({ "--hue": seatHue(seat) } as React.CSSProperties)}>
            {text}
          </span>
        );
      }
      case "c": {
        const data = mark[3] ? cards[mark[3]] : undefined;
        if (!data) return <span key={i} className="log-card plain">{text}</span>;
        const face = mark[4] ?? 0;
        const linkKey = `${lineKey}~${i}`;
        return (
          <button
            key={i}
            type="button"
            className="log-card"
            data-log-card={linkKey}
            onPointerEnter={(e) => {
              if (e.pointerType !== "mouse") return;
              // Beside the log panel (not the link, which would cover the log), level with the link.
              const link = e.currentTarget.getBoundingClientRect();
              const panel = e.currentTarget.closest(".log-panel")?.getBoundingClientRect() ?? link;
              onHoverCard({ key: linkKey, card: data, face, rect: new DOMRect(panel.left, link.top, panel.width, link.height) });
            }}
            onPointerLeave={() => onHoverCard(null)}
            onClick={() => {
              onHoverCard(null);
              useTableUi.getState().set({ logZoom: { key: linkKey, cardId: data.id, face } });
            }}
          >
            {text}
          </button>
        );
      }
      case "v":
        return (
          <b key={i} className="log-verb">
            {text}
          </b>
        );
      case "z":
        return (
          <span key={i} className={`log-zone z-${zoneClass(text)}`}>
            {text}
          </span>
        );
      case "n":
        return (
          <span key={i} className={`log-num${mark[3] ? ` ${mark[3]}` : ""}`}>
            {text}
          </span>
        );
    }
  };
  return (
    <div
      data-key={lineKey}
      className={`log-line${kind ? ` kind-${kind}` : ""}${divider ? " divider" : ""}`}
      style={actorSeat < 0 ? undefined : ({ "--hue": seatHue(actorSeat) } as React.CSSProperties)}
    >
      {kind && !divider && (
        <span className="log-icon" aria-hidden>
          <Icon name={LOG_ICONS[kind] ?? "diamond"} />
        </span>
      )}
      <span className="log-text">
        {divider && kind && <Icon name={LOG_ICONS[kind]} className="log-divider-icon" />}
        <span>{logSegments(entry.text, entry.marks).map((seg, i) => render(seg.text, seg.mark, i))}</span>
      </span>
      <time className="log-time" dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>
        {relativeTime(now - entry.at)}
      </time>
    </div>
  );
}

/** Zoomed view of a card named in the log or a confirmation (the same carousel as your hand). */
function LogZoom() {
  const zoom = useTableUi((s) => s.logZoom);
  const card = useStore((s) => (zoom ? s.cards[zoom.cardId] : undefined));
  const items = useMemo<CarouselItem[]>(() => (zoom && card ? [{ key: zoom.key, card, face: zoom.face }] : []), [zoom, card]);
  const originFor = useCallback((key: string) => document.querySelector(`[data-log-card="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => useTableUi.getState().set({ logZoom: null }), []);
  if (!zoom || !card) return null;
  return <CardCarousel key={zoom.key} items={items} startKey={zoom.key} title={zoom.title ?? "Game log"} originFor={originFor} onClose={close} />;
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
  const handSelected = useTableUi((s) => s.handSelected);
  const arriving = useMotion((s) => s.arriving);
  const table = view.table!;
  const hand = table.players[view.you]?.zones.hand ?? [];
  const n = hand.length;
  const zone = useRef<HTMLDivElement>(null);
  // Leave a little room for the card lifted on hover (it scales up past its neighbours).
  const layout = handLayout(n, useWidth(zone, 900) - 40);
  const cardH = Math.round((layout.width * 88) / 63);

  // Cards joining or leaving: the rest slide over to their new spots instead of jumping there.
  // Positions are known from the layout, so there's nothing to measure.
  const placed = useRef({ key: "", x: new Map<string, number>() });
  const handKey = hand.join();
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    const offset = -layout.fanWidth / 2;
    hand.forEach((id, i) => next.set(id, offset + i * layout.spread));
    const { key, x: before } = placed.current;
    placed.current = { key: handKey, x: next };
    // Only when cards come or go (not while the window is being resized).
    if (key === handKey || before.size === 0 || reducedMotion()) return;
    for (const [id, x] of next) {
      const was = before.get(id);
      if (was === undefined || Math.abs(was - x) < 1) continue;
      zone.current
        ?.querySelector<HTMLElement>(`.hand-card[data-hid="${CSS.escape(id)}"]`)
        ?.animate([{ transform: `translateX(${was - x}px)` }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handKey, layout.spread, layout.fanWidth]);
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
          const selected = handSelected === id;
          return (
            <div
              key={id}
              data-hid={id}
              className={`hand-card${dragging ? " dragging" : ""}${selected ? " is-selected" : ""}${arriving[id] ? " arriving" : ""}`}
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
                // A click selects (then zooms); playing a card is always an explicit drag or menu pick,
                // so an over-eager double-click can't put a card onto the battlefield.
                beginDrag(e.nativeEvent, "hand", [id], () => clickHandCard(id));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (card) handMenu(card, e.clientX, e.clientY);
              }}
            >
              <div className="hand-card-visual">
                <CardView card={data} foil={card?.foil} face={face} width={layout.width} selected={selected} flippable onFlip={() => turnHandCard(id)} />
              </div>
            </div>
          );
        })}
      </div>
      {n === 0 && <div className="hand-empty faint">Your hand is empty · press D to draw</div>}
    </div>
  );
}

/** Zoom carousel over your hand, opened by clicking a selected hand card (same as the draft). */
function HandZoom() {
  const zoom = useTableUi((s) => s.handZoom);
  const handFaces = useTableUi((s) => s.handFaces);
  const view = useStore((s) => s.view);
  const cards = useStore((s) => s.cards);
  const hand = (view?.table && view.table.players[view.you]?.zones.hand) || [];
  const items = useMemo<CarouselItem[]>(
    () =>
      hand.map((id) => {
        const card = view?.table?.cards[id];
        return { key: id, card: card?.cardId ? cards[card.cardId] : undefined, foil: card?.foil, face: handFaces[id] ?? 0 };
      }),
    // Faces are read when the carousel opens; it tracks turning over itself afterwards. The hand
    // is compared by content: solo mode updates the same array in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hand.join(), view?.table?.cards, cards, zoom],
  );
  const originFor = useCallback((key: string) => document.querySelector(`.hand-card[data-hid="${key}"] .card`)?.getBoundingClientRect() ?? null, []);
  const close = useCallback(() => useTableUi.getState().set({ handZoom: null }), []);
  const onFaceChange = useCallback((key: string, face: number) => {
    const ui = useTableUi.getState();
    ui.set({ handFaces: { ...ui.handFaces, [key]: face } });
  }, []);
  if (!zoom || !hand.includes(zoom)) return null;
  return <CardCarousel key={zoom} items={items} startKey={zoom} title="Your hand" originFor={originFor} onFaceChange={onFaceChange} onClose={close} />;
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

  const libraryOpen = viewer?.zone === "library" && viewer.playerId === me;
  const peek = libraryOpen && table && me ? activePeek(table, me) : undefined;
  // "Look at top X" is done once every card has been placed: the server drops the look, so close.
  // Only after the look has shown up, though: right after asking for it, the view hasn't caught up.
  const sawPeek = useRef(false);
  // Set when the look already ended (a button here, or every card placed), so closing doesn't end it again.
  const ended = useRef(false);
  useEffect(() => {
    if (!libraryOpen) sawPeek.current = false;
    else if (peek) sawPeek.current = true;
    else if (sawPeek.current) {
      sawPeek.current = false;
      ended.current = true;
      setViewer(null);
    }
  }, [libraryOpen, peek, setViewer]);
  // Everyone sees a look while it lasts, so it ends however the library closes (Esc included). Even
  // if the look hasn't shown up in the view yet: the server gets this after the request that starts
  // it, and ending no look is a no-op.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !libraryOpen && !ended.current) act({ a: "peek", n: 0 });
    wasOpen.current = libraryOpen;
    ended.current = false;
  }, [libraryOpen]);
  // Back after a refresh in the middle of a look: pick it up where it was.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !table || !me) return;
    resumed.current = true;
    if (activePeek(table, me) && !useTableUi.getState().viewer) setViewer({ playerId: me, zone: "library" });
  }, [table, me, setViewer]);

  if (!viewer || !table) return null;
  const tp = table.players[viewer.playerId];
  if (!tp) return null;
  const mine = viewer.playerId === me;
  const looking = viewer.zone === "library" && !!peek && !peek.search;
  const searching = viewer.zone === "library" && !!peek?.search;
  let ids = tp.zones[viewer.zone];
  if (viewer.zone === "library") ids = searching ? ids : looking ? peek!.ids : [];
  const ownerName = players.find((p) => p.id === viewer.playerId)?.name ?? "Player";

  const close = (shuffle = false) => {
    if (viewer.zone === "library" && mine) {
      act({ a: "peek", n: 0 });
      if (shuffle) act({ a: "shuffle" });
      ended.current = true;
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

  const title = searching
    ? "Searching library"
    : looking
      ? `Top ${peek!.n} of your library`
      : `${mine ? "Your" : `${ownerName}'s`} ${ZONE_LABELS[viewer.zone].toLowerCase()}`;
  const count = looking ? `${ids.length} of ${peek!.n} left` : `${ids.length}`;
  const shown = viewer.zone === "graveyard" || viewer.zone === "exile" ? ids.slice().reverse() : ids;
  const hint = looking
    ? "Click a card for every option. Each card you place leaves this list; whatever is left stays on top of your library, in this order."
    : `${mine || viewer.zone === "graveyard" || viewer.zone === "exile" ? "Right-click (or click) a card for options. " : ""}${viewer.zone === "graveyard" || viewer.zone === "exile" ? "Most recent first." : viewer.zone === "library" ? "Top of library first." : ""}`;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal panel zone-viewer">
        <div className="row">
          <h2>{title}</h2>
          <span className="muted">({count})</span>
          <div className="spacer" />
          {viewer.zone === "library" && mine && (
            <button className="btn small" onClick={() => close(true)}>
              Shuffle & close
            </button>
          )}
          <button className="btn small" onClick={() => close()} title={looking && ids.length > 0 ? "The cards left here stay on top of your library, in this order" : undefined}>
            {looking ? (ids.length > 0 ? "Done — keep the rest on top" : "Done") : "Close"}
          </button>
        </div>
        <p className="faint">{hint}</p>
        {looking && ids.length > 1 && <p className="faint zone-tip">Putting cards on top one at a time? The last one you put there ends up on top.</p>}
        <div className="zone-grid scroll">
          {shown.map((id, i) => {
            const card = table.cards[id];
            if (!card) return null;
            const data = card.cardId ? cards[card.cardId] : undefined;
            return (
              <div key={id} className="zone-slot">
                <div
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
                {looking && (
                  <>
                    <span className="zone-pos faint">{i === 0 ? "Top card" : `${ordinal(i + 1)} from top`}</span>
                    <div className="zone-quick">
                      <button className="btn small" onClick={() => moveTo([id], "library")} title="Put it on top of your library">
                        Top
                      </button>
                      <button className="btn small" onClick={() => moveTo([id], "library", { bottom: true })} title="Put it on the bottom of your library (scry)">
                        Bottom
                      </button>
                      <button className="btn small" onClick={() => moveTo([id], "graveyard")} title="Put it into your graveyard (surveil)">
                        <Icon name="graveyard" title="Graveyard" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          {ids.length === 0 && <p className="muted">Nothing here.</p>}
        </div>
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
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
  const cards = useStore((s) => s.cards);
  const seats = useStore((s) => s.view?.table?.seats ?? []);
  const logZoom = useTableUi((s) => s.logZoom);
  const [value, setValue] = useState("");
  const [hover, setHover] = useState<{ card: CardData; face: number; rect: DOMRect } | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const previousLogZoom = useRef(logZoom);
  useEffect(() => {
    if (previousLogZoom.current && !logZoom && ask?.kind === "confirm") confirmButton.current?.focus();
    previousLogZoom.current = logZoom;
  }, [logZoom, ask]);
  useEffect(() => {
    setValue(ask?.initial ?? "");
    setHover(null);
  }, [ask]);
  // Confirmations have no input to catch Esc, so listen on the window.
  useEffect(() => {
    if (ask?.kind !== "confirm") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      set({ ask: null });
      ask.onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, set]);
  if (!ask) return null;
  const submit = () => {
    set({ ask: null });
    ask.onSubmit(value);
  };
  const cancel = () => {
    set({ ask: null });
    ask.onCancel?.();
  };
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div className="modal panel ask-dialog" role={ask.kind === "confirm" ? "alertdialog" : "dialog"} aria-modal="true" aria-label={ask.question}>
        <p className="ask-q">
          {ask.parts
            ? ask.parts.map((part, i) => {
                if (part.kind === "player") {
                  const seat = seats.indexOf(part.playerId);
                  return (
                    <span key={i} className={`log-player${seat < 0 ? " gone" : ""}`} style={seat < 0 ? undefined : ({ "--hue": seatHue(seat) } as React.CSSProperties)}>
                      {part.text}
                    </span>
                  );
                }
                if (part.kind === "card") {
                  const card = part.cardId ? cards[part.cardId] : undefined;
                  if (!card || !part.cardId) return <span key={i} className="log-card plain">{part.text}</span>;
                  const face = part.face ?? 0;
                  const linkKey = `ask-card-${i}-${part.cardId}`;
                  return (
                    <button
                      key={i}
                      type="button"
                      className="log-card"
                      data-log-card={linkKey}
                      onPointerEnter={(e) => {
                        if (e.pointerType !== "mouse") return;
                        const dialog = e.currentTarget.closest(".ask-dialog");
                        setHover({ card, face, rect: dialog?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect() });
                      }}
                      onPointerLeave={() => setHover(null)}
                      onClick={() => {
                        setHover(null);
                        useTableUi.getState().set({ logZoom: { key: linkKey, cardId: card.id, face, title: "Confirmation" } });
                      }}
                    >
                      {part.text}
                    </button>
                  );
                }
                return part.text;
              })
            : ask.question}
        </p>
        {hover && <AnchoredPreview card={hover.card} face={hover.face} anchor={hover.rect} width={230} prefer="right" className="ask-card-preview" />}
        {ask.kind !== "confirm" && (
          <input
            className="input"
            autoFocus
            type={ask.kind === "number" ? "number" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") cancel();
            }}
          />
        )}
        <div className="row">
          <div className="spacer" />
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button ref={confirmButton} className="btn primary" autoFocus={ask.kind === "confirm"} onClick={submit}>
            {ask.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Drag", "Move cards — onto piles, back to your hand, or anywhere on the table"],
  ["Click hand card", "Select it · click again to zoom in (← → browse your hand) · drag it to play"],
  ["Double-click", "Tap / untap a permanent · draw from your library"],
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
  ["1–4 · V", "View from a seat (1 is yours) · look down on the whole table"],
  ["Home", "Reset the camera"],
  ["Alt+Shift+T", "Switch UI theme (or pick one on the home page)"],
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

