// Draft screen: fresh packs are ripped open and revealed card by card (commons first, rares last);
// passed packs slide in from the neighbour. Click to select, click a selected card to zoom in,
// and confirm with the Pick button (never on a stray click).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { serverNow, useStore } from "../store";
import { TopBar } from "../components/TopBar";
import { Icon } from "../components/Icon";
import { SplitButton, type SplitItem } from "../components/SplitButton";
import { CardView } from "../components/CardView";
import { CardCarousel, type CarouselItem } from "../components/CardCarousel";
import { AnchoredPreview } from "../components/AnchoredPreview";
import { ManaCost } from "../components/Mana";
import type { CardData, CardInstance, CardMap, Rarity } from "../../shared/types";
import { sfx, isMuted, setMuted } from "../sfx";
import { hasBackFace } from "../cardStyle";
import { RARITY_RANK, REVEAL_FX_MS, revealSchedule, TEAR_MS } from "../revealSchedule";
import { hasOpened, markOpened } from "../openedPacks";

const COLOR_RANK = (c: CardData) => (c.colors.length === 0 ? 6 : c.colors.length > 1 ? 5 : "WUBRG".indexOf(c.colors[0]));

type Stage = "sealed" | "tearing" | "dealing" | "revealed";

export function Draft() {
  const view = useStore((s) => s.view)!;
  const cards = useStore((s) => s.cards);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const solo = useStore((s) => s.mode === "solo");
  const d = view.draft!;
  const pack = d.pack;

  const [selected, setSelected] = useState<string[]>([]);
  const [burning, setBurning] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [zoom, setZoom] = useState<{ source: "pack" | "picks"; key: string } | null>(null);
  const [stage, setStage] = useState<Stage>("revealed");
  const [revealCount, setRevealCount] = useState(99);
  // Screen flash for a rare / mythic landing (keyed so each one replays the animation).
  const [flash, setFlash] = useState<{ key: number; rarity: Rarity } | null>(null);
  // Cards whose reveal effects are still playing (value: is it one of the pack's highlights).
  // Tracked per card, not by stage, so the pack can become clickable while the last sparks fly.
  const [fx, setFx] = useState<ReadonlyMap<string, boolean>>(new Map());
  const fxTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearFx = useCallback(() => {
    fxTimers.current.forEach(clearTimeout);
    fxTimers.current = [];
    setFx(new Map());
  }, []);
  useEffect(() => () => fxTimers.current.forEach(clearTimeout), []);
  const [muted, setMutedState] = useState(isMuted());

  const sorted = useMemo(() => (pack ? sortPack(pack.cards, view.instances, cards) : []), [pack, view.instances, cards]);
  const fresh = !!pack && pack.picksTaken === 0 && !hasOpened(view.code, pack.id);

  // New pack arrived: reset selection and decide how it enters.
  useLayoutEffect(() => {
    setSelected([]);
    setBurning([]);
    setLeaving(false);
    setFlash(null);
    clearFx();
    setZoom((z) => (z?.source === "pack" ? null : z));
    if (!pack) return;
    if (fresh) {
      setStage("sealed");
      setRevealCount(0);
    } else {
      setStage("revealed");
      setRevealCount(99);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack?.id]);

  const skip = useCallback(() => {
    if (pack) markOpened(view.code, pack.id);
    setStage("revealed");
    setRevealCount(99);
    setFlash(null);
    clearFx();
  }, [pack, view.code, clearFx]);

  const rip = useCallback(() => {
    if (stage !== "sealed" || !pack) return;
    markOpened(view.code, pack.id);
    sfx.rip();
    // Reduced motion: no tearing, dealing or flipping — just show the pack.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return skip();
    setStage("tearing");
  }, [stage, pack, view.code, skip]);

  // tearing → dealing → a wave of flips (commons first; a short beat of suspense before rares).
  useEffect(() => {
    if (stage === "tearing") {
      const t = setTimeout(() => setStage("dealing"), TEAR_MS);
      return () => clearTimeout(t);
    }
    if (stage !== "dealing") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const revealOrder = sorted.slice().reverse();
    const rarities = revealOrder.map((iid) => cards[view.instances[iid]?.cardId]?.rarity ?? "common");
    const plan = revealSchedule(rarities.map((r) => RARITY_RANK[r]));
    for (const at of plan.deals) timers.push(setTimeout(() => sfx.deal(), at));
    let flashes = 0;
    for (const step of plan.reveals) {
      timers.push(
        setTimeout(() => {
          setRevealCount(step.k + 1);
          const iid = revealOrder[step.k];
          setFx((cur) => new Map(cur).set(iid, step.highlight));
          fxTimers.current.push(
            setTimeout(() => {
              setFx((cur) => {
                const next = new Map(cur);
                next.delete(iid);
                return next;
              });
            }, REVEAL_FX_MS),
          );
          if (!step.highlight) return sfx.flip(step.k);
          setFlash({ key: ++flashes, rarity: rarities[step.k] });
          if (step.rank >= 3) {
            sfx.mythic();
            document.querySelector(".pack-fan")?.animate(
              [{ transform: "none" }, { transform: "translate(-4px, 2px)" }, { transform: "translate(4px, -2px)" }, { transform: "translate(-2px, 1px)" }, { transform: "none" }],
              { duration: 280, easing: "ease-out" },
            );
          } else sfx.rare();
        }, step.at),
      );
    }
    timers.push(setTimeout(() => setStage("revealed"), plan.done));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const need = d.need;
  const readyToConfirm = !!pack && selected.length === need.picks && burning.length === need.burns;

  const confirm = useCallback(
    (picks = selected, burns = burning) => {
      if (!pack || leaving) return;
      if (picks.length !== need.picks || burns.length !== need.burns) return;
      setLeaving(true);
      sfx.pick();
      const packId = pack.id;
      setTimeout(() => send({ t: "pick", packId, picks, burns }), 360);
      // If the server rejects the pick (stale pack), let the player try again.
      setTimeout(() => setLeaving(false), 2500);
    },
    [pack, leaving, selected, burning, need, send],
  );

  // Click selects; clicking an already-chosen card zooms in. Picking only happens via the Pick button.
  const clickCard = (iid: string) => {
    if (stage !== "revealed") return skip();
    if (leaving) return;
    if (selected.includes(iid) || burning.includes(iid)) {
      setZoom({ source: "pack", key: iid });
      return;
    }
    sfx.select();
    if (selected.length < need.picks) setSelected([...selected, iid]);
    else if (burning.length < need.burns) setBurning([...burning, iid]);
    else if (need.picks === 1 && need.burns === 0) setSelected([iid]);
    else toast("Deselect a card first (the X on its corner), or confirm your choice.");
  };

  const deselect = (iid: string) => {
    setSelected((s) => s.filter((x) => x !== iid));
    setBurning((b) => b.filter((x) => x !== iid));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || zoom) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (stage === "sealed") rip();
        else if (stage !== "revealed") skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, rip, skip, zoom]);

  const mySeat = d.seat;
  const n = d.seats.length;
  const fromSeat = d.passDirection === "left" ? (mySeat - 1 + n) % n : (mySeat + 1) % n;
  const pickNo = pack ? pack.picksTaken + 1 : null;

  const carouselItems = useMemo<CarouselItem[]>(() => {
    if (!zoom) return [];
    const ids = zoom.source === "pack" ? sorted : d.picks;
    return ids.map((iid) => ({ key: iid, card: cards[view.instances[iid]?.cardId], foil: view.instances[iid]?.foil }));
  }, [zoom, sorted, d.picks, cards, view.instances]);
  const originFor = useCallback((key: string) => document.querySelector(`[data-iid="${key}"]`)?.getBoundingClientRect() ?? null, []);
  const closeZoom = useCallback(() => setZoom(null), []);
  const selectedName = selected.length === 1 && need.picks === 1 ? cards[view.instances[selected[0]]?.cardId]?.name : undefined;

  // The same bot logic the debug console uses. Finishing the whole draft only makes sense solo:
  // online it would auto-pick for your friends too.
  const autoPickItems: SplitItem[] = [
    {
      label: need.burns > 0 ? "Auto-pick & burn for me" : "Auto-pick for me",
      description: (
        <>
          <b>Let the bot choose this pick.</b> It takes the strongest card{need.picks > 1 ? "s" : ""} for the colors you're drafting (CubeCobra rating,
          rarity, and what you've already picked){need.burns > 0 ? ", and burns the weakest" : ""}. Your pack then passes as usual.
        </>
      ),
      onSelect: () => {
        sfx.pick();
        send({ t: "debug", cmd: "autoPickMe" });
      },
    },
    ...(solo
      ? [
          {
            label: "Finish the draft",
            description: (
              <>
                <b>Auto-pick everything that's left</b>, for you and every bot, and jump straight to deckbuilding. Handy for a quick game. Can't be undone.
              </>
            ),
            danger: true,
            onSelect: () => send({ t: "debug", cmd: "finishDraft" }),
          },
        ]
      : []),
  ];

  return (
    <div className="screen draft">
      <TopBar
        title={
          <span>
            Pack <b>{d.round + 1}</b>/{d.packsPerPlayer}
            {pickNo && (
              <>
                {" "}
                · Pick <b>{pickNo}</b>
              </>
            )}
          </span>
        }
      >
        <button
          className="btn ghost small icon-only"
          title={muted ? "Sound off" : "Sound on"}
          aria-label="Mute sound"
          aria-pressed={muted}
          onClick={() => {
            setMuted(!muted);
            setMutedState(!muted);
          }}
        >
          <Icon name={muted ? "volume-off" : "volume"} />
        </button>
      </TopBar>
      <SeatRing />
      <div className="draft-body">
        <main className="draft-main">
          {pack ? (
            <>
              <div className="draft-instructions">
                {stage === "sealed" ? (
                  <span>
                    A fresh pack! Click it or press <kbd>Space</kbd> to rip it open.
                  </span>
                ) : stage !== "revealed" ? (
                  <span className="faint">
                    Click or <kbd>Space</kbd> to skip
                  </span>
                ) : need.burns > 0 ? (
                  <span>
                    Choose <b className="gold">{need.picks}</b> to keep and <b className="red">{need.burns}</b> to burn · {selected.length}/{need.picks} kept, {burning.length}/{need.burns} burned
                  </span>
                ) : (
                  <span>
                    {selected.length === 0 ? `Click ${need.picks > 1 ? `${need.picks} cards` : "a card"} to select` : "Click a selected card to zoom in"} · then press <b className="gold">Pick</b>
                  </span>
                )}
                <span className="spacer" />
                {pack.deadline && <PickTimer deadline={pack.deadline} />}
                {stage === "revealed" && (
                  <SplitButton
                    className="primary"
                    mainClassName="pick-btn"
                    disabled={!readyToConfirm || leaving}
                    onClick={() => confirm()}
                    menuLabel="Auto-pick options"
                    menuDisabled={leaving}
                    items={autoPickItems}
                  >
                    {need.burns > 0 ? "Confirm" : selectedName ? `Pick ${selectedName}` : "Pick"} <Icon name="sparkle" />
                  </SplitButton>
                )}
              </div>
              <PackFan
                key={pack.id}
                ids={sorted}
                instances={view.instances}
                cards={cards}
                stage={stage}
                revealCount={revealCount}
                selected={selected}
                burning={burning}
                leaving={leaving}
                arrival={pack.picksTaken === 0 ? "fresh" : d.passDirection === "left" ? "from-left" : "from-right"}
                passDirection={d.passDirection}
                onRip={rip}
                onSkip={skip}
                onClickCard={clickCard}
                onDeselect={deselect}
                cubeName={view.cube?.name ?? "Cube"}
                flash={flash}
                fx={fx}
                round={d.round}
              />
            </>
          ) : (
            <div className="waiting">
              <div className="waiting-cards">
                <CardView back width={90} />
                <CardView back width={90} />
                <CardView back width={90} />
              </div>
              <p>
                Waiting for <b>{d.seats[fromSeat]?.name}</b> to pass you a pack…
              </p>
              <p className="faint">Hover or click your picks on the right to review them.</p>
            </div>
          )}
        </main>
        <aside className="draft-side panel">
          <PicksList picks={d.picks} instances={view.instances} cards={cards} onOpen={(iid) => setZoom({ source: "picks", key: iid })} />
        </aside>
      </div>
      {zoom && carouselItems.length > 0 && (
        <CardCarousel
          key={`${zoom.source}:${zoom.key}`}
          items={carouselItems}
          startKey={zoom.key}
          title={zoom.source === "pack" ? `Pack ${d.round + 1} · Pick ${pickNo}` : "Your picks"}
          originFor={originFor}
          badge={
            zoom.source === "pack"
              ? (k) => (selected.includes(k) ? <span className="pill ok"><Icon name="check" /> Selected</span> : burning.includes(k) ? <span className="pill bad">Burning</span> : null)
              : undefined
          }
          onClose={closeZoom}
        />
      )}
    </div>
  );
}

function sortPack(ids: string[], instances: Record<string, CardInstance>, cards: CardMap): string[] {
  return ids.slice().sort((a, b) => {
    const ca = cards[instances[a]?.cardId];
    const cb = cards[instances[b]?.cardId];
    if (!ca || !cb) return 0;
    return RARITY_RANK[cb.rarity] - RARITY_RANK[ca.rarity] || COLOR_RANK(ca) - COLOR_RANK(cb) || ca.cmc - cb.cmc || ca.name.localeCompare(cb.name);
  });
}

// --- Pack fan --------------------------------------------------------------------------------

interface PackFanProps {
  ids: string[];
  instances: Record<string, CardInstance>;
  cards: CardMap;
  stage: Stage;
  revealCount: number;
  selected: string[];
  burning: string[];
  leaving: boolean;
  arrival: "fresh" | "from-left" | "from-right";
  passDirection: "left" | "right";
  onRip: () => void;
  onSkip: () => void;
  onClickCard: (iid: string) => void;
  onDeselect: (iid: string) => void;
  cubeName: string;
  round: number;
  flash: { key: number; rarity: Rarity } | null;
  fx: ReadonlyMap<string, boolean>;
}

function useFanLayout(ref: React.RefObject<HTMLDivElement | null>, count: number) {
  const [box, setBox] = useState({ w: 1200, h: 700 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return useMemo(() => {
    let best = { rows: 1, perRow: count, width: 0 };
    for (let rows = 1; rows <= 3; rows++) {
      const perRow = Math.ceil(count / rows);
      const byW = (box.w - 40 - (perRow - 1) * 14) / perRow;
      const byH = ((box.h - 30) / rows - 26) / (88 / 63);
      const width = Math.min(byW, byH, 250);
      if (width > best.width) best = { rows, perRow, width };
    }
    return { ...best, width: Math.max(70, Math.floor(best.width)) };
  }, [box, count]);
}

function PackFan(props: PackFanProps) {
  const { ids, instances, cards, stage, revealCount, selected, burning, leaving, arrival, passDirection } = props;
  const ref = useRef<HTMLDivElement>(null);
  const layout = useFanLayout(ref, ids.length);
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += layout.perRow) rows.push(ids.slice(i, i + layout.perRow));

  const showCards = stage === "dealing" || stage === "revealed";
  return (
    <div ref={ref} className={`pack-fan stage-${stage}`} onClick={stage === "dealing" ? props.onSkip : undefined}>
      {props.flash && <div key={props.flash.key} className={`fan-flash r-${props.flash.rarity}`} />}
      {(stage === "sealed" || stage === "tearing") && (
        <SealedPack name={props.cubeName} round={props.round} tearing={stage === "tearing"} onClick={props.onRip} count={ids.length} />
      )}
      {showCards &&
        rows.map((row, r) => (
          <div className="fan-row" key={r}>
            {row.map((iid, i) => {
              const index = r * layout.perRow + i;
              const inst = instances[iid];
              const card = inst ? cards[inst.cardId] : undefined;
              const revealRank = ids.length - 1 - index;
              const flipped = stage === "revealed" || revealRank < revealCount;
              // Just flipped during the opening: extra polish (flip arc, glint, rarity ring, sparks).
              const revealing = flipped && props.fx.has(iid);
              const highlight = revealing && props.fx.get(iid) === true;
              const mid = (row.length - 1) / 2;
              const off = i - mid;
              const isSel = selected.includes(iid);
              const isBurn = burning.includes(iid);
              const rarity = card?.rarity ?? "common";
              const leaveClass = leaving ? (isSel ? "to-tray" : isBurn ? "burned" : `pass-${passDirection}`) : "";
              const style = {
                "--rot": `${off * 1.6}deg`,
                "--arc": `${Math.abs(off) ** 1.6 * 1.6}px`,
                "--delay": `${index * 18}ms`,
                "--slide-delay": `${index * 28}ms`,
                "--from-x": `${-(i - mid) * (layout.width + 14)}px`,
                "--from-y": `${-(r - (rows.length - 1) / 2) * layout.width * 1.4}px`,
                width: layout.width,
              } as React.CSSProperties;
              return (
                <div
                  key={iid}
                  data-iid={iid}
                  className={`fan-slot arrive-${stage === "dealing" ? "deal" : arrival === "fresh" ? "none" : arrival} ${leaveClass} ${flipped ? "is-flipped" : ""} ${revealing ? "revealing" : ""} ${highlight ? "highlight" : ""} ${isSel ? "is-selected" : ""} ${isBurn ? "is-burn" : ""} ${isSel || isBurn ? "zoomable" : ""} r-${rarity}`}
                  style={style}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClickCard(iid);
                  }}
                >
                  <div className="flipper">
                    <div className="flip-face flip-back">
                      <CardView back width={layout.width} />
                    </div>
                    <div className="flip-face flip-front">
                      <CardView card={card} foil={inst?.foil} width={layout.width} tilt flippable selected={isSel} className={isBurn ? "burn" : ""} />
                      {revealing && <div className="reveal-glint" />}
                    </div>
                  </div>
                  {revealing && RARITY_RANK[rarity] >= 1 && <div className={`reveal-ring r-${rarity}`} />}
                  {highlight && (
                    <>
                      <div className={`burst r-${rarity}`} />
                      <div className={`reveal-sparks r-${rarity}`}>
                        {Array.from({ length: 12 }, (_, k) => (
                          <span key={k} style={{ "--a": `${k * 30 + (k % 2) * 12}deg`, "--d": `${0.55 + (k % 3) * 0.18}` } as React.CSSProperties} />
                        ))}
                      </div>
                    </>
                  )}
                  {isBurn && <div className="burn-tag">BURN</div>}
                  {(isSel || isBurn) && !leaving && (
                    <button
                      className="deselect"
                      title="Deselect"
                      aria-label="Deselect"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onDeselect(iid);
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

function SealedPack({ name, round, tearing, onClick, count }: { name: string; round: number; tearing: boolean; onClick: () => void; count: number }) {
  return (
    <div className={`sealed-pack${tearing ? " tearing" : ""}`} onClick={onClick} role="button" aria-label="Open pack">
      <div className="sp-strip" />
      <div className="sp-body">
        <div className="sp-shine" />
        <div className="sp-sigil">
          <Icon name="sparkle" />
        </div>
        <div className="sp-brand">HyperDraft</div>
        <div className="sp-name">{name}</div>
        <div className="sp-meta">
          Pack {round + 1} · {count} cards
        </div>
      </div>
      <div className="sp-light" />
      {tearing && (
        <div className="sp-sparks">
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} style={{ "--a": `${(i / 16) * 360}deg`, "--d": `${60 + (i % 4) * 30}px` } as React.CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Header pieces ---------------------------------------------------------------------------

function SeatRing() {
  const d = useStore((s) => s.view?.draft)!;
  const players = useStore((s) => s.view?.players ?? []);
  const arrow = <Icon name={d.passDirection === "left" ? "arrow-right" : "arrow-left"} />;
  return (
    <div className="seat-ring">
      <span className="pass-dir" title="Packs pass this way">
        Passing {d.passDirection} {arrow}
      </span>
      {d.seats.map((s, i) => {
        const p = players.find((x) => x.id === s.playerId);
        return (
          <div className="ring-item" key={s.playerId}>
            {i > 0 && <span className="ring-arrow">{arrow}</span>}
            <div className={`ring-seat${i === d.seat ? " me" : ""}${s.queued === 0 ? " idle" : ""}`} title={`${s.name}: ${s.queued} pack(s) waiting, ${s.picks} picks`}>
              <span className="ring-name">
                {s.isBot && <Icon name="bot" className="ring-bot" title="Bot" />}
                {s.name}
                {p && !p.isBot && !p.connected ? " (away)" : ""}
              </span>
              <span className="ring-queue">
                {Array.from({ length: Math.min(s.queued, 6) }, (_, k) => (
                  <i key={k} />
                ))}
                {s.queued === 0 && <em>waiting</em>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PickTimer({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const iv = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(iv);
  }, []);
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const lastTick = useRef(-1);
  useEffect(() => {
    if (left <= 5 && left > 0 && left !== lastTick.current) {
      lastTick.current = left;
      sfx.tick();
    }
  }, [left]);
  return (
    <span className={`pick-timer${left <= 10 ? " urgent" : ""}`} title="Time left — a card is auto-picked when it runs out">
      <Icon name="timer" /> {left}s
    </span>
  );
}

function PicksList({ picks, instances, cards, onOpen }: { picks: string[]; instances: Record<string, CardInstance>; cards: CardMap; onOpen: (iid: string) => void }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const iid of picks) for (const col of cards[instances[iid]?.cardId]?.colors ?? []) c[col]++;
    return c;
  }, [picks, instances, cards]);
  const [hover, setHover] = useState<{ iid: string; rect: DOMRect } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [picks.length]);

  const hoverCard = hover ? cards[instances[hover.iid]?.cardId] : undefined;

  return (
    <div className="picks">
      <div className="picks-head">
        <span className="label">Your picks · {picks.length}</span>
        <span className="pip-counts">
          {Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([c, n]) => (
              <span key={c}>
                <i className={`ms ms-${c.toLowerCase()} ms-cost`} /> {n}
              </span>
            ))}
        </span>
      </div>
      {picks.length === 0 && <p className="faint picks-empty">Cards you pick show up here. Hover to preview, click to zoom.</p>}
      <ol className="picks-list scroll" ref={listRef} onScroll={() => setHover(null)}>
        {picks.map((iid, i) => {
          const card = cards[instances[iid]?.cardId];
          if (!card) return null;
          return (
            <li
              key={iid}
              data-iid={iid}
              className={`pick-row r-${card.rarity}`}
              onPointerEnter={(e) => setHover({ iid, rect: e.currentTarget.getBoundingClientRect() })}
              onPointerLeave={() => setHover(null)}
              onClick={() => {
                setHover(null);
                onOpen(iid);
              }}
            >
              <span className="pick-no">{i + 1}</span>
              <span className="pick-name">{card.name}</span>
              {hasBackFace(card) && (
                <span className="dfc-mark" title="Double-faced — hover to see both faces">
                  <Icon name="flip" />
                </span>
              )}
              <ManaCost cost={card.manaCost} />
            </li>
          );
        })}
      </ol>
      {hover && hoverCard && <AnchoredPreview card={hoverCard} foil={instances[hover.iid]?.foil} anchor={hover.rect} />}
    </div>
  );
}
