// Full-screen zoomed card viewer. Flies out of the card you opened it from, lets you browse
// neighbours (← → buttons or keys), tilt the card by hovering or dragging, and flies back on close.
// Double-faced cards can be turned over (button on the card, or F).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../../shared/types";
import { CardHelp } from "./CardHelp";
import { CardView } from "./CardView";
import { Icon } from "./Icon";
import { faceOf, hasBackFace, nextFace } from "../cardStyle";

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

/** Below this width the rules help sits under the card instead of beside it. */
const SIDE_PANEL_MIN_WIDTH = 900;
const PANEL_SPACE = 340; // Side panel width plus the gap to the card.

function zoomLayout() {
  const side = window.innerWidth >= SIDE_PANEL_MIN_WIDTH;
  const byHeight = ((window.innerHeight - (side ? 170 : 230)) * 63) / 88;
  const byWidth = window.innerWidth - (side ? 260 + PANEL_SPACE : 260);
  return { width: Math.max(220, Math.floor(Math.min(byHeight, byWidth, 640))), side };
}

function useZoomLayout() {
  const [layout, setLayout] = useState(zoomLayout);
  useEffect(() => {
    const onResize = () => setLayout(zoomLayout());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return layout;
}

export function CardCarousel({ items, startKey, title, originFor, badge, onFaceChange, onClose }: Props) {
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((i) => i.key === startKey)));
  const [dir, setDir] = useState<"next" | "prev" | "open">("open");
  const [closing, setClosing] = useState(false);
  const flyRef = useRef<HTMLDivElement>(null);
  const { width, side } = useZoomLayout();
  const item = items[Math.min(index, items.length - 1)];
  // Which face each card is showing, remembered while browsing back and forth.
  const [faces, setFaces] = useState<Record<string, number>>({});
  const dfc = hasBackFace(item?.card);
  const face = item ? faces[item.key] ?? item.face ?? 0 : 0;
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
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="carousel-top">
        <div className="carousel-title">
          {title && <span className="faint">{title}</span>}
          <b>{item.card && dfc ? faceOf(item.card, face).name : item.card?.name}</b>
          {dfc && <span className="pill">{face === 0 ? "Front face" : "Back face"}</span>}
          {items.length > 1 && (
            <span className="faint">
              {index + 1} / {items.length}
            </span>
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
        {/* Hidden cards have no data, so they get no help (it would give them away). An empty slot
            keeps the card from jumping sideways when browsing past them. */}
        {item.card ? (
          <CardHelp key={item.key} card={item.card} face={face} style={side ? { maxHeight: Math.round((width * 88) / 63) } : undefined} />
        ) : (
          side && <div className="card-help-slot" />
        )}
      </div>

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
