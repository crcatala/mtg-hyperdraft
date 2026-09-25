// Deckbuilding: select / zoom cards like in the draft; right-click (or drag) moves them between Deck and Pool.
// Unlimited basics, auto-build, ready up.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { NameEditor, TopBar } from "../components/TopBar";
import { Tooltip } from "../components/Tooltip";
import { CardView } from "../components/CardView";
import { CardCarousel, type CarouselItem } from "../components/CardCarousel";
import type { BasicCounts, BasicLand, CardData, CardInstance, CardMap, Color, DeckState } from "../../shared/types";
import { BASIC_NAMES, COLORS } from "../../shared/types";
import { autoBuild, basicsTotal, colorPips, deckSize, suggestBasics } from "../../shared/deck";
import { isLand } from "../../shared/autopick";
import { playFlip, snapshotRects } from "../flip";

type Area = "main" | "side";
const COLUMNS = ["0–1", "2", "3", "4", "5", "6+"];

/** Visible strip of each stacked card, as a fraction of card height (shows the name bar). */
const STEP_RATIO = 0.15;
const MIN_CARD_W = 90;
const MAX_CARD_W = 150;

/**
 * Picks a card width so the Deck and Pool sections fit the scroll area without scrolling:
 * measures the fixed chrome, then solves for the card height that makes the tallest stacks fit.
 * Only scrolls when cards would get smaller than MIN_CARD_W.
 */
function useFitCardWidth(ref: React.RefObject<HTMLDivElement | null>, tallest: number[]) {
  const [width, setWidth] = useState(132);
  const key = tallest.join(",");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const areas = [...el.querySelectorAll<HTMLElement>(".db-area")];
      if (areas.length !== tallest.length) return;
      // Everything that isn't a card stack (headers, padding, gaps) is fixed chrome.
      let stacks = 0;
      for (const a of areas) stacks += Math.max(0, ...[...a.querySelectorAll<HTMLElement>(".db-stack")].map((s) => s.offsetHeight));
      // Real content height (scrollHeight never reports less than the container itself).
      const last = el.lastElementChild as HTMLElement | null;
      const content = last ? last.getBoundingClientRect().bottom - el.getBoundingClientRect().top + el.scrollTop + parseFloat(getComputedStyle(el).paddingBottom) : 0;
      let chrome = content - stacks;
      let units = 0;
      for (const n of tallest) {
        if (n === 0) chrome += 60; // empty sections keep their min-height
        else units += 1 + STEP_RATIO * (n - 1);
      }
      // A few px of slack absorbs rounding of card height / step.
      const byHeight = units > 0 ? (((el.clientHeight - chrome - 8) / units) * 63) / 88 : MAX_CARD_W;
      const cols = COLUMNS.length + 1;
      const byWidth = (el.clientWidth - 64 - (cols - 1) * 10) / cols;
      const next = Math.floor(Math.max(MIN_CARD_W, Math.min(MAX_CARD_W, byHeight, byWidth)));
      setWidth((w) => (Math.abs(w - next) >= 1 ? next : w));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key]);
  return width;
}

/** Mana value → column: 0–1, 2, 3, 4, 5, 6+. */
function columnOf(card: CardData): number {
  return Math.max(0, Math.min(5, Math.floor(card.cmc) - 1));
}

export function Deckbuilder() {
  const view = useStore((s) => s.view)!;
  const cards = useStore((s) => s.cards);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const [pending, setPending] = useState<DeckState | null>(null);
  const [colorFilter, setColorFilter] = useState<Set<Color | "C">>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ area: Area; key: string } | null>(null);
  // Hover hints teach right-click/drag. Each section stops showing them once you've moved a card
  // out of it: taking a card from the pool doesn't mean you know how to put one back.
  const [learned, setLearned] = useState<Record<Area, boolean>>({ main: false, side: false });

  const server = view.deck!;
  // Optimistic local copy until the server echoes it back (or 3s pass, e.g. after a rejected change).
  const deck = pending ?? server;
  useEffect(() => {
    if (pending && sameDeck(pending, server)) setPending(null);
  }, [pending, server]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 3000);
    return () => clearTimeout(t);
  }, [pending]);
  const min = view.config.game.minDeckSize;
  const size = deckSize(deck);
  const instances = view.instances;

  const commit = (next: DeckState) => {
    // FLIP: remember where every card is, then animate from there once the new layout
    // (including any card re-sizing) has rendered but before it is painted.
    const before = snapshotRects(".db-card[data-iid]", "iid");
    const wasMain = new Set(deck.main);
    const moved = new Set([...next.main.filter((iid) => !wasMain.has(iid)), ...next.side.filter((iid) => wasMain.has(iid))]);
    setPending(next);
    send({ t: "deck", main: next.main, side: next.side, basics: next.basics });
    requestAnimationFrame(() => playFlip(before, ".db-card[data-iid]", "iid", { emphasize: moved }));
  };

  const move = (iid: string, to: Area) => {
    if (deck.ready) return toast("Unready first to change your deck.");
    const main = deck.main.filter((x) => x !== iid);
    const side = deck.side.filter((x) => x !== iid);
    (to === "main" ? main : side).push(iid);
    setLearned((l) => ({ ...l, [to === "main" ? "side" : "main"]: true }));
    commit({ ...deck, main, side });
  };

  const setBasic = (land: BasicLand, n: number) => {
    if (deck.ready) return toast("Unready first to change your deck.");
    commit({ ...deck, basics: { ...deck.basics, [land]: Math.max(0, Math.min(60, n)) } });
  };

  const mainCards = deck.main.map((iid) => cards[instances[iid]?.cardId]).filter(Boolean);

  const doAutoBuild = () => {
    const picks = [...deck.main, ...deck.side];
    commit({ ...autoBuild(picks, instances, cards, min), ready: false });
    toast("Built a two-colour deck from your strongest picks. Tweak away!");
  };

  const doLands = () => commit({ ...deck, basics: suggestBasics(mainCards, min) });

  const exportList = async () => {
    const lines = ["Deck", ...countLines(deck.main, instances, cards)];
    for (const land of Object.keys(deck.basics) as BasicLand[]) if (deck.basics[land] > 0) lines.push(`${deck.basics[land]} ${BASIC_NAMES[land]}`);
    lines.push("", "Sideboard", ...countLines(deck.side, instances, cards));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Decklist copied (Arena/MTGO format).");
    } catch {
      toast("Couldn't access the clipboard.", "error");
    }
  };

  const others = view.players.filter((p) => !p.isBot && p.id !== view.you);

  // Left click selects; clicking the selected card again zooms into it (same as the draft).
  const clickCard = (iid: string, area: Area) => {
    if (selected === iid) setZoom({ area, key: iid });
    else setSelected(iid);
  };
  const moveOther = (iid: string) => move(iid, deck.main.includes(iid) ? "side" : "main");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  const carouselItems = useMemo<CarouselItem[]>(() => {
    if (!zoom) return [];
    const layout = layoutArea(zoom.area === "main" ? deck.main : deck.side, instances, cards, zoom.area === "side" ? colorFilter : undefined);
    return [...layout.cols.flat(), ...layout.lands].map((iid) => ({ key: iid, card: cards[instances[iid]?.cardId], foil: instances[iid]?.foil }));
  }, [zoom, deck.main, deck.side, instances, cards, colorFilter]);
  const originFor = useCallback((key: string) => document.querySelector(`.db-card[data-iid="${key}"]`)?.getBoundingClientRect() ?? null, []);

  const areasRef = useRef<HTMLDivElement>(null);
  const tallest = useMemo(
    () =>
      [layoutArea(deck.main, instances, cards), layoutArea(deck.side, instances, cards, colorFilter)].map((l) =>
        Math.max(0, ...[...l.cols, l.lands].map((c) => c.length)),
      ),
    [deck.main, deck.side, instances, cards, colorFilter],
  );
  const cardW = useFitCardWidth(areasRef, tallest);
  const cardH = Math.round((cardW * 88) / 63);
  const sizeVars = { "--card-w": `${cardW}px`, "--card-h": `${cardH}px`, "--step": `${Math.round(cardH * STEP_RATIO)}px` } as React.CSSProperties;
  const closeZoom = useCallback(() => setZoom(null), []);

  return (
    <div className="screen deckbuilder">
      <TopBar title="Build your deck">
        <NameEditor />
      </TopBar>
      <div className="db-toolbar">
        <span className={`pill ${size >= min ? "ok" : "warn"}`}>
          {size} / {min}+ cards
        </span>
        <button className="btn small" onClick={doAutoBuild} disabled={deck.ready}>
          ✨ Auto-build
        </button>
        <button className="btn small" onClick={doLands} disabled={deck.ready} title="Fill to the minimum with basics matching your mana symbols">
          ⛰ Auto lands
        </button>
        <button className="btn small" onClick={exportList}>
          ⧉ Copy list
        </button>
        <span className="db-filter">
          <span className="faint">Pool filter:</span>
          {[...COLORS, "C" as const].map((c) => (
            <button
              key={c}
              className={`chip${colorFilter.has(c) ? " on" : ""}`}
              onClick={() => {
                const next = new Set(colorFilter);
                if (next.has(c)) next.delete(c);
                else next.add(c);
                setColorFilter(next);
              }}
              title={c === "C" ? "Colorless" : c}
            >
              <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
            </button>
          ))}
        </span>
        <div className="spacer" />
        <span className="db-others">
          {others.map((p) => {
            const st = view.deckStatus[p.id];
            return (
              <span key={p.id} className={`pill ${st?.ready ? "ok" : ""}`}>
                {p.name} {st?.ready ? "✓ ready" : "building…"}
              </span>
            );
          })}
        </span>
        <button
          className={`btn ${deck.ready ? "on" : "primary"}`}
          disabled={!deck.ready && size < min}
          onClick={() => send({ t: "deckReady", ready: !deck.ready })}
          title={size < min ? `Add at least ${min - size} more card(s)` : ""}
        >
          {deck.ready ? "✓ Ready — waiting for others" : "Ready to play"}
        </button>
      </div>

      <div className="db-body">
        <div className="db-areas scroll" ref={areasRef} style={sizeVars}>
          <CardArea
            title={`Deck · ${deck.main.length} spells/lands + ${basicsTotal(deck.basics)} basics`}
            area="main"
            extra={
              <div className="db-hint">
                <span>
                  <b>Click</b> select
                </span>
                <span>
                  <b>Click again</b> zoom in
                </span>
                <span>
                  <b>Right-click</b> move between deck &amp; pool
                </span>
                <span>
                  <b>Drag</b> move
                </span>
              </div>
            }
            ids={deck.main}
            instances={instances}
            cards={cards}
            onMove={move}
            onClickCard={clickCard}
            onMoveOther={moveOther}
            selected={selected}
            cardWidth={cardW}
            dragging={dragging}
            setDragging={setDragging}
            locked={deck.ready}
            hints={!learned.main}
          />
          <CardArea
            title={`Pool / sideboard · ${deck.side.length}`}
            area="side"
            ids={deck.side}
            instances={instances}
            cards={cards}
            onMove={move}
            onClickCard={clickCard}
            onMoveOther={moveOther}
            selected={selected}
            cardWidth={cardW}
            dragging={dragging}
            setDragging={setDragging}
            filter={colorFilter}
            locked={deck.ready}
            hints={!learned.side}
          />
        </div>
        <aside className="db-side panel scroll">
          <BasicsEditor basics={deck.basics} basicIds={view.basicIds} cards={cards} onChange={setBasic} disabled={deck.ready} />
          <DeckStats main={mainCards} basics={deck.basics} />
        </aside>
      </div>
      {zoom && carouselItems.length > 0 && (
        <CardCarousel
          key={`${zoom.area}:${zoom.key}`}
          items={carouselItems}
          startKey={zoom.key}
          title={zoom.area === "main" ? "Your deck" : "Pool / sideboard"}
          originFor={originFor}
          badge={(k) => (deck.main.includes(k) ? <span className="pill ok">In deck</span> : <span className="pill">In pool</span>)}
          onClose={closeZoom}
        />
      )}
    </div>
  );
}

function sameDeck(a: DeckState, b: DeckState) {
  return a.main.join() === b.main.join() && a.side.join() === b.side.join() && JSON.stringify(a.basics) === JSON.stringify(b.basics) && a.ready === b.ready;
}

function countLines(ids: string[], instances: Record<string, CardInstance>, cards: CardMap): string[] {
  const counts = new Map<string, number>();
  for (const iid of ids) {
    const name = cards[instances[iid]?.cardId]?.name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => `${n} ${name}`);
}

interface CardAreaProps {
  title: string;
  area: Area;
  ids: string[];
  instances: Record<string, CardInstance>;
  cards: CardMap;
  onMove: (iid: string, to: Area) => void;
  onClickCard: (iid: string, area: Area) => void;
  onMoveOther: (iid: string) => void;
  selected: string | null;
  cardWidth: number;
  dragging: string | null;
  setDragging: (iid: string | null) => void;
  filter?: Set<Color | "C">;
  /** Rendered at the right end of the section's title row. */
  extra?: ReactNode;
  /** Deck is readied: moves are refused until the player unreadies. */
  locked: boolean;
  /** Show the right-click/drag hover hint (the "locked" hint always shows). */
  hints: boolean;
}

/** Hover hint on each card, so first-timers find right-click and drag. */
function CardHint({ area, locked }: { area: Area; locked: boolean }) {
  if (locked) {
    return (
      <>
        Your deck is locked in. <b>Unready</b> to make changes.
      </>
    );
  }
  const inDeck = area === "main";
  return (
    <div className="tip-keys">
      <b>Right-click</b>
      <span>{inDeck ? "move back to the pool" : "add to your deck"}</span>
      <b>Drag</b>
      <span>{inDeck ? "into the pool" : "into the deck"}</span>
      <b>Click</b>
      <span>select · click again to zoom</span>
    </div>
  );
}

/** Cards of one area split into mana-value columns + a lands column, each sorted by colour then name. */
function layoutArea(ids: string[], instances: Record<string, CardInstance>, cards: CardMap, filter?: Set<Color | "C">) {
  const cols: string[][] = COLUMNS.map(() => []);
  const lands: string[] = [];
  for (const iid of ids) {
    const card = cards[instances[iid]?.cardId];
    if (!card) continue;
    if (filter && filter.size > 0) {
      const keys: (Color | "C")[] = card.colors.length ? card.colors : ["C"];
      if (!keys.some((k) => filter.has(k))) continue;
    }
    if (isLand(card)) lands.push(iid);
    else cols[columnOf(card)].push(iid);
  }
  const byColor = (a: string, b: string) => {
    const ca = cards[instances[a].cardId];
    const cb = cards[instances[b].cardId];
    return colorKey(ca) - colorKey(cb) || ca.cmc - cb.cmc || ca.name.localeCompare(cb.name);
  };
  cols.forEach((c) => c.sort(byColor));
  lands.sort(byColor);
  return { cols, lands };
}

function CardArea({ title, area, ids, instances, cards, onMove, onClickCard, onMoveOther, selected, cardWidth, dragging, setDragging, filter, extra, locked, hints }: CardAreaProps) {
  const [over, setOver] = useState(false);
  const columns = useMemo(() => layoutArea(ids, instances, cards, filter), [ids, instances, cards, filter]);
  const hint = locked || hints ? <CardHint area={area} locked={locked} /> : null;

  return (
    <section
      className={`db-area${over && dragging && !ids.includes(dragging) ? " drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const iid = e.dataTransfer.getData("text/plain");
        if (iid && !ids.includes(iid)) onMove(iid, area);
        setDragging(null);
      }}
    >
      <div className="db-area-head">
        <h3>{title}</h3>
        {extra}
      </div>
      <div className="db-columns">
        {[...columns.cols, columns.lands].map((col, ci) => (
          <div className="db-col" key={ci}>
            <div className="db-col-head">{ci < COLUMNS.length ? COLUMNS[ci] : "Lands"}</div>
            <div className="db-stack" style={{ "--count": col.length } as React.CSSProperties}>
              {col.map((iid, k) => {
                const inst = instances[iid];
                const isSel = selected === iid;
                return (
                  <Tooltip key={iid} follow placement="right" delay={500} content={hint}>
                    <div
                      data-iid={iid}
                      className={`db-card${isSel ? " is-selected" : ""}`}
                      style={{ "--k": k } as React.CSSProperties}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", iid);
                        setDragging(iid);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onClick={() => onClickCard(iid, area)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onMoveOther(iid);
                      }}
                    >
                      <CardView card={cards[inst.cardId]} foil={inst.foil} width={cardWidth} glow={false} selected={isSel} />
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function colorKey(c: CardData) {
  if (c.colors.length === 0) return 7;
  if (c.colors.length > 1) return 6;
  return "WUBRG".indexOf(c.colors[0]);
}

function BasicsEditor({ basics, basicIds, cards, onChange, disabled }: { basics: BasicCounts; basicIds: Partial<Record<BasicLand, string>>; cards: CardMap; onChange: (l: BasicLand, n: number) => void; disabled: boolean }) {
  return (
    <div className="basics">
      <div className="label">Basic lands · unlimited</div>
      {(Object.keys(BASIC_NAMES) as BasicLand[]).map((land) => (
        <div key={land} className="basic-row">
          <i className={`ms ms-${land.toLowerCase()} ms-cost ms-shadow`} />
          <span className="basic-name">{cards[basicIds[land] ?? ""]?.name ?? BASIC_NAMES[land]}</span>
          <button className="btn small" disabled={disabled || basics[land] === 0} onClick={() => onChange(land, basics[land] - 1)}>
            −
          </button>
          <BasicCount value={basics[land]} disabled={disabled} label={BASIC_NAMES[land]} onChange={(n) => onChange(land, n)} />
          <button className="btn small" disabled={disabled} onClick={() => onChange(land, basics[land] + 1)}>
            +
          </button>
        </div>
      ))}
    </div>
  );
}

/** Editable count: click (or tab) in and type a number; Enter/blur applies, Esc cancels, ↑/↓ nudge. */
function BasicCount({ value, disabled, label, onChange }: { value: number; disabled: boolean; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft !== "" && Number.isFinite(n) && n !== value) onChange(Math.max(0, Math.min(60, n)));
  };
  return (
    <input
      className="basic-count"
      aria-label={`${label} count`}
      inputMode="numeric"
      disabled={disabled}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setDraft(null);
          onChange(Math.max(0, Math.min(60, value + (e.key === "ArrowUp" ? 1 : -1))));
        }
      }}
    />
  );
}

function DeckStats({ main, basics }: { main: CardData[]; basics: BasicCounts }) {
  const spells = main.filter((c) => !isLand(c));
  const curve = COLUMNS.map((_, i) => spells.filter((c) => columnOf(c) === i).length);
  const maxCurve = Math.max(1, ...curve);
  const creatures = spells.filter((c) => /Creature/.test(c.typeLine)).length;
  const pips: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of spells) {
    const p = colorPips(c.manaCost);
    for (const k of COLORS) pips[k] += p[k];
  }
  const lands = main.length - spells.length + basicsTotal(basics);
  return (
    <div className="deck-stats">
      <div className="label">Mana curve</div>
      <div className="curve">
        {curve.map((n, i) => (
          <div key={i} className="curve-col">
            <div className="curve-bar" style={{ height: `${(n / maxCurve) * 100}%` }}>
              {n > 0 && <span>{n}</span>}
            </div>
            <div className="curve-label">{COLUMNS[i]}</div>
          </div>
        ))}
      </div>
      <div className="stat-grid">
        <span>Creatures</span>
        <b>{creatures}</b>
        <span>Other spells</span>
        <b>{spells.length - creatures}</b>
        <span>Lands</span>
        <b>{lands}</b>
      </div>
      <div className="label">Colour symbols vs. basics</div>
      <div className="pip-table">
        {COLORS.filter((c) => pips[c] > 0 || basics[c] > 0).map((c) => (
          <div key={c} className="pip-row">
            <i className={`ms ms-${c.toLowerCase()} ms-cost`} />
            <span>{Math.round(pips[c] * 10) / 10} symbols</span>
            <span className="faint">{basics[c]} basics</span>
          </div>
        ))}
      </div>
    </div>
  );
}
