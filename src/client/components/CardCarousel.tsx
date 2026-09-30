// Full-screen zoomed card viewer. Flies out of the card you opened it from, lets you browse
// neighbours (← → buttons or keys), tilt the card by hovering or dragging, and flies back on close.
// Double-faced cards can be turned over (button on the card, or F).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { CardHelp, RulesHelpHint } from "./CardHelp";
import { CardView } from "./CardView";
import { Icon } from "./Icon";
import { faceOf, hasBackFace, nextFace } from "../cardStyle";
import { loadRulesHelpOpen, saveRulesHelpOpen, takeRulesHelpHint } from "../cardHelp";

export interface CarouselItem {
  key: string;
  card?: CardData;
  foil?: boolean;
  face?: number;
}

interface Props {
  items: CarouselItem[];
  startKey: string;
  title?: ReactNode;
  /** Screen rect of the item's on-page card, used to animate from/to it. */
  originFor: (key: string) => DOMRect | null;
  /** Extra label shown above the card (e.g. "Selected"). */
  badge?: (key: string) => ReactNode;
  /** Called when a double-faced card is turned over (e.g. so a hand card keeps that face). */
  onFaceChange?: (key: string, face: number) => void;
  onClose: () => void;
}

const EASE_OUT = "cubic-bezier(0.2, 0.9, 0.25, 1)";
const EASE_IN = "cubic-bezier(0.55, 0, 0.75, 0.3)";

function flipTransform(from: DOMRect, to: DOMRect): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${from.width / to.width})`;
}

const PANEL_SPACE = 340; // Side panel width plus the gap to the card.
const BADGE_SPACE = 22; // Below the title bar, room for the badge above the card.
const STACK_CHROME = 24 + 20; // Bottom padding, and the gap above the help.
// These breakpoints match the carousel media queries in screens.css.
const NARROW = 560; // Below this width the browse arrows shrink, leaving more room for the card.
const SHORT = 500; // Below this height the key hint goes, leaving more room for the card.

/** Height kept for the rules help under the card, so both fit on screen without scrolling. */
function stackedHelpHeight() {
  return Math.round(Math.min(320, Math.max(180, window.innerHeight * 0.3)));
}

/** Card width that fits the space, before the minimum size is applied. */
function fitWidth(byHeight: number, byWidth: number) {
  return Math.min((byHeight * 63) / 88, byWidth, 640);
}

/** The help goes beside the card or under it, whichever leaves the bigger card. Compared before the
 *  minimum size, so on small screens it's whichever overflows less. Decided with the help open
 *  either way, so hiding it doesn't swap layouts; under the card, hiding it gives the card its
 *  space back. */
function zoomLayout(helpOpen: boolean, topBarHeight: number) {
  const { innerWidth: w, innerHeight: h } = window;
  const cardTop = topBarHeight + BADGE_SPACE;
  const arrowSpace = w < NARROW ? 112 : 260; // The browse arrows either side of the card.
  // Title bar and the key hint below; short screens drop the hint, others keep some breathing room.
  const sideChrome = h < SHORT ? cardTop + 16 : Math.max(170, cardTop + 48);
  const stackChrome = cardTop + STACK_CHROME;
  const helpHeight = stackedHelpHeight();
  const sideFit = fitWidth(h - sideChrome, w - arrowSpace - PANEL_SPACE);
  const side = sideFit > fitWidth(h - stackChrome - helpHeight, w - arrowSpace);
  const fit = side ? sideFit : fitWidth(h - stackChrome - (helpOpen ? helpHeight : 0), w - arrowSpace);
  const width = Math.max(220, Math.floor(fit));
  // Under-card help keeps the card at the top so it stays put while browsing; with the help
  // hidden there's nothing below it, so it's centred in the space instead.
  const spare = side || helpOpen ? 0 : h - 24 - cardTop - (width * 88) / 63; // Less the bottom padding.
  return { width, side, helpHeight, cardTop: Math.round(cardTop + Math.max(0, spare / 2)) };
}

/** Sizes the card to the window and to the title bar, which wraps on narrow screens. */
function useZoomLayout(helpOpen: boolean) {
  const [, setResizes] = useState(0);
  const [topBar, setTopBar] = useState<HTMLDivElement | null>(null);
  const [topBarHeight, setTopBarHeight] = useState(60);
  useEffect(() => {
    const onResize = () => setResizes((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useLayoutEffect(() => {
    if (!topBar) return;
    const measure = () => setTopBarHeight(Math.ceil(topBar.offsetHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topBar);
    return () => observer.disconnect();
  }, [topBar]);
  return { ...zoomLayout(helpOpen, topBarHeight), topBarRef: setTopBar };
}

export function CardCarousel({ items, startKey, title, originFor, badge, onFaceChange, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => i.key === startKey)));
  const [dir, setDir] = useState<"next" | "prev" | "open">("open");
  const [closing, setClosing] = useState(false);
  const flyRef = useRef<HTMLDivElement>(null);
  const item = items[Math.min(index, items.length - 1)];
  // Which face each card is showing, remembered while browsing back and forth.
  const [faces, setFaces] = useState<Record<string, number>>({});
  const dfc = hasBackFace(item?.card);
  const face = item ? faces[item.key] ?? item.face ?? 0 : 0;
  // Rules help can be hidden (remembered across visits); a button by the card name brings it back.
  const [helpOpen, setHelpOpen] = useState(loadRulesHelpOpen);
  const { width, side, helpHeight, cardTop, topBarRef } = useZoomLayout(helpOpen);
  const [hint, setHint] = useState(false);
  const [helpBtn, setHelpBtn] = useState<HTMLButtonElement | null>(null);
  const showHelp = (open: boolean) => {
    setHelpOpen(open);
    saveRulesHelpOpen(open);
    setHint(!open && takeRulesHelpHint());
  };
  const endHint = useCallback(() => setHint(false), []);
  // Browsing onto a hidden card removes the button; the tip goes with it.
  const hasHelpBtn = !helpOpen && !!item?.card;
  useEffect(() => {
    if (!hasHelpBtn) setHint(false);
  }, [hasHelpBtn]);
  const turnOver = useCallback(() => {
    if (!item || !hasBackFace(item.card)) return;
    const next = nextFace(item.card, face);
    setFaces((f) => ({ ...f, [item.key]: next }));
    onFaceChange?.(item.key, next);
  }, [item, face, onFaceChange]);

  // Fly in from the card that was clicked.
  useLayoutEffect(() => {
    const el = flyRef.current;
    if (!el || !item) return;
    const from = originFor(item.key);
    if (from && from.width > 0) {
      el.animate([{ transform: flipTransform(from, el.getBoundingClientRect()), opacity: 0.8 }, { transform: "none", opacity: 1 }], { duration: 420, easing: EASE_OUT });
    } else {
      el.animate([{ transform: "scale(0.85)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 260, easing: EASE_OUT });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const el = flyRef.current;
    if (!el || !item) return onClose();
    const from = originFor(item.key);
    const onScreen = from && from.width > 0 && from.bottom > 0 && from.top < window.innerHeight;
    const anim = onScreen
      ? el.animate([{ transform: "none", opacity: 1 }, { transform: flipTransform(from, el.getBoundingClientRect()), opacity: 0.6 }], { duration: 320, easing: EASE_IN, fill: "forwards" })
      : el.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.85)", opacity: 0 }], { duration: 220, easing: EASE_IN, fill: "forwards" });
    // Unmount when the animation ends, or shortly after regardless (slow frames must not trap the UI).
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    anim.onfinish = finish;
    setTimeout(finish, 450);
  }, [closing, item, originFor, onClose]);

  const go = useCallback(
    (delta: number) => {
      if (items.length < 2 || closing) return;
      setDir(delta > 0 ? "next" : "prev");
      setIndex((i) => (i + delta + items.length) % items.length);
    },
    [items.length, closing],
  );

  // Capture-phase keys so the screen underneath doesn't also react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Escape") close();
      else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && dfc) turnOver();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, close, dfc, turnOver]);

  // Items can disappear underneath us (e.g. the pack moved on); close if ours is gone.
  useEffect(() => {
    if (items.length === 0) onClose();
  }, [items.length, onClose]);

  if (!item) return null;

  return createPortal(
    <div
      className={`carousel${side ? " side-help" : ""}${closing ? " closing" : ""}`}
      style={{ "--card-top": `${cardTop}px`, "--card-h": `${Math.round((width * 88) / 63)}px` } as CSSProperties}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="carousel-top" ref={topBarRef}>
        <div className="carousel-title">
          {title && <span className="faint">{title}</span>}
          <b>{item.card && dfc ? faceOf(item.card, face).name : item.card?.name}</b>
          {dfc && <span className="pill">{face === 0 ? "Front face" : "Back face"}</span>}
          {items.length > 1 && (
            <span className="faint">
              {index + 1} / {items.length}
            </span>
          )}
          {!helpOpen && item.card && (
            <button ref={setHelpBtn} className={`carousel-help-btn${hint ? " hinting" : ""}`} onClick={() => showHelp(true)} aria-label="Show rules help" title="Show rules help">
              <Icon name="book" />
            </button>
          )}
        </div>
        <button className="carousel-close" onClick={close} aria-label="Close (Esc)" title="Close (Esc)">
          <Icon name="x" />
        </button>
      </div>

      {items.length > 1 && (
        <>
          <button className="carousel-arrow left" onClick={() => go(-1)} aria-label="Previous card (←)" title="Previous (←)">
            <Icon name="chevron-left" />
          </button>
          <button className="carousel-arrow right" onClick={() => go(1)} aria-label="Next card (→)" title="Next (→)">
            <Icon name="chevron-right" />
          </button>
        </>
      )}

      <div
        className="carousel-stage"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="carousel-fly" ref={flyRef} style={{ width }}>
          {badge && <div className="carousel-badge">{badge(item.key)}</div>}
          <TiltDrag key={item.key} className={`carousel-enter-${dir}`}>
            <CardView card={item.card} foil={item.foil} face={face} width={width} imageSize="large" tilt flippable onFlip={turnOver} />
          </TiltDrag>
        </div>
        {/* Hidden cards have no data, so they get no help (it would give them away). The slot stays
            so the card doesn't jump sideways when browsing past them, and it animates open and shut
            so the card glides to its new spot when the help is shown or hidden. */}
        <div className={`card-help-slot${helpOpen ? "" : " hidden"}`} inert={!helpOpen}>
          {item.card && (
            <CardHelp key={item.key} card={item.card} face={face} style={{ maxHeight: side ? Math.round((width * 88) / 63) : helpHeight }} onHide={() => showHelp(false)} />
          )}
        </div>
      </div>

      {hint && helpBtn && <RulesHelpHint anchor={helpBtn} onDone={endHint} />}

      <div className="carousel-hint faint">
        {items.length > 1 && (
          <>
            <kbd>←</kbd> <kbd>→</kbd> browse ·{" "}
          </>
        )}
        {dfc && (
          <>
            <kbd>F</kbd> turn over ·{" "}
          </>
        )}
        drag to tilt · <kbd>Esc</kbd> close
      </div>
    </div>,
    document.body,
  );
}

/** Drag anywhere on the card to swing it around in 3D; it springs back on release. */
function TiltDrag({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cardEl = () => ref.current?.querySelector<HTMLElement>(".card") ?? null;
  const set = (el: HTMLElement, rx: number, ry: number, mx: number, my: number, hyp: number) => {
    el.style.setProperty("--rx", `${rx}deg`);
    el.style.setProperty("--ry", `${ry}deg`);
    el.style.setProperty("--mx", `${mx}%`);
    el.style.setProperty("--my", `${my}%`);
    el.style.setProperty("--hyp", `${hyp}`);
  };

  return (
    <div
      ref={ref}
      className={`tilt-drag ${className ?? ""}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        cardEl()?.classList.add("drag-tilting");
      }}
      onPointerMove={(e) => {
        const s = start.current;
        const el = cardEl();
        if (!s || !el) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
        set(el, clamp(-dy * 0.25, 38), clamp(dx * 0.25, 48), 50 + clamp(dx * 0.2, 50), 50 + clamp(dy * 0.2, 50), Math.min(1, Math.hypot(dx, dy) / 160));
      }}
      onPointerUp={() => {
        start.current = null;
        const el = cardEl();
        if (!el) return;
        el.classList.remove("drag-tilting");
        set(el, 0, 0, 50, 50, 0);
      }}
    >
      {children}
    </div>
  );
}
