// Modal listing every card in the cube as a grid of small images. Only tiles near the viewport
// load their image: a shared IntersectionObserver with a generous margin mounts each card as it
// approaches, so a 500-card cube fetches a few rows at a time while you scroll instead of all at once.
// Clicking a card opens the zoom carousel (large images) over the current (filtered) list.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { useStore } from "../store";
import { cubeCards, matchesName } from "../cubeList";
import { CardView } from "./CardView";
import { CardCarousel, type CarouselItem } from "./CardCarousel";
import { Icon } from "./Icon";

/** Scryfall's "small" image width: shown at 1:1, so the low-res images stay sharp enough. */
const TILE_W = 146;
const TILE_H = Math.round((TILE_W * 88) / 63);
/** How far outside the visible grid to start loading: about two rows ahead, above and below. */
const PRELOAD_MARGIN = `${TILE_H * 2}px 0px`;

type Observe = (el: Element, onVisible: () => void) => () => void;

/** One IntersectionObserver for all tiles; each tile's callback fires once, when it first nears view. */
function useVisibilityObserver(rootRef: RefObject<HTMLElement | null>): Observe {
  const [api] = useState(() => {
    const pending = new Map<Element, () => void>();
    let io: IntersectionObserver | null = null;
    return {
      start(root: HTMLElement | null) {
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              pending.get(e.target)?.();
              pending.delete(e.target);
              io?.unobserve(e.target);
            }
          },
          { root, rootMargin: PRELOAD_MARGIN },
        );
        pending.forEach((_, el) => io!.observe(el));
      },
      stop() {
        io?.disconnect();
        io = null;
      },
      observe(el: Element, onVisible: () => void) {
        pending.set(el, onVisible);
        io?.observe(el);
        return () => {
          pending.delete(el);
          io?.unobserve(el);
        };
      },
    };
  });
  // Layout effect: runs before the tiles' (passive) effects register themselves.
  useLayoutEffect(() => {
    api.start(rootRef.current);
    return () => api.stop();
  }, [api, rootRef]);
  return api.observe;
}

export function CubeBrowser({ onClose }: { onClose: () => void }) {
  const cards = useStore((s) => s.cards);
  const view = useStore((s) => s.view)!;
  const all = useMemo(() => cubeCards(cards, view.basicIds), [cards, view.basicIds]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => all.filter((c) => matchesName(c, query)), [all, query]);
  const [zoom, setZoom] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const observe = useVisibilityObserver(gridRef);
  const titleId = useId();

  // The carousel takes Esc first (capture phase), so this only runs when it's closed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = useMemo<CarouselItem[]>(() => shown.map((c) => ({ key: c.id, card: c })), [shown]);
  const originFor = useCallback((key: string) => gridRef.current?.querySelector(`[data-card="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null, []);
  const closeZoom = useCallback(() => setZoom(null), []);

  const total = view.cube?.size ?? all.length;
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel cube-browser" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="cb-head">
          <div className="cb-title">
            <h2 id={titleId}>{view.cube?.name ?? "Cube"}</h2>
            <span className="muted">
              {query ? `${shown.length} of ${all.length}` : all.length} unique cards{total !== all.length ? ` · ${total} total` : ""}
            </span>
          </div>
          <label className="cb-search">
            <Icon name="search" />
            <input className="input" placeholder="Search by name…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search cards by name" autoFocus />
          </label>
          <button className="btn ghost small icon-only" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <div className="cb-grid scroll" ref={gridRef} style={{ "--tile-w": `${TILE_W}px`, "--tile-h": `${TILE_H}px` } as React.CSSProperties}>
          {shown.map((c) => (
            <CubeTile key={c.id} card={c} observe={observe} onOpen={setZoom} />
          ))}
          {shown.length === 0 && <p className="muted cb-empty">No cards match “{query}”.</p>}
        </div>
        <p className="cb-foot faint">Click a card to zoom in, then browse with the arrow keys</p>
      </div>
      {zoom && items.length > 0 && <CardCarousel key={zoom} items={items} startKey={zoom} title={view.cube?.name} originFor={originFor} onClose={closeZoom} />}
    </div>,
    document.body,
  );
}

function CubeTile({ card, observe, onOpen }: { card: CardData; observe: Observe; onOpen: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => (ref.current ? observe(ref.current, () => setNear(true)) : undefined), [observe]);
  return (
    <div
      ref={ref}
      className="cb-tile"
      data-card={card.id}
      role="button"
      tabIndex={0}
      aria-label={`Zoom in on ${card.name}`}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen(card.id);
      }}
    >
      {near ? <CardView card={card} width={TILE_W} imageSize="small" glow={false} /> : <span className="cb-placeholder">{card.name}</span>}
      <span className="cb-zoom" aria-hidden>
        <Icon name="zoom-in" />
      </span>
    </div>
  );
}
