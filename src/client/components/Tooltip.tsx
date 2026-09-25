// Styled hover/focus tooltip. Wrap a single element that accepts pointer/focus handlers:
//
//   <Tooltip content="What this does" placement="left"><button>…</button></Tooltip>
//
// The bubble is portalled to <body> with fixed positioning, flips to the opposite side when there's
// no room, and stays inside the viewport. Keyboard focus shows it immediately; hover after a delay.
// `follow` anchors it at the mouse instead of the element (for big or partly covered targets like
// stacked cards) and waits until the pointer rests. Pressing on the target hides it until you leave.

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Placement = "top" | "bottom" | "left" | "right";

const OPPOSITE: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const GAP = 10;
const MARGIN = 8;

interface TargetProps {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
}

export function Tooltip({
  content,
  placement = "top",
  delay = 250,
  follow = false,
  children,
}: {
  content: ReactNode;
  placement?: Placement;
  delay?: number;
  /** Anchor at the resting mouse position instead of the element. */
  follow?: boolean;
  children: ReactElement<TargetProps>;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointer = useRef({ x: 0, y: 0 });
  // Set by pressing on the target (click, drag start); cleared when the pointer leaves.
  const suppressed = useRef(false);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  // A fixed-position bubble would drift away from its target when anything scrolls.
  useEffect(() => {
    if (!anchor) return;
    const onScroll = () => setAnchor(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [anchor]);

  const show = (el: HTMLElement, wait: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { x, y } = pointer.current;
      // Around the cursor: the arrow pointer extends ~12px right/down of its hotspot.
      setAnchor(follow ? new DOMRect(x - 4, y - 4, 16, 16) : el.getBoundingClientRect());
    }, wait);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAnchor(null);
  };

  const own = children.props;
  const target = cloneElement(children, {
    onPointerEnter: (e) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (e.pointerType === "mouse" && !suppressed.current) show(e.currentTarget, delay);
      own.onPointerEnter?.(e);
    },
    onPointerMove: (e) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      // In follow mode the delay counts from when the pointer stops moving.
      if (follow && e.pointerType === "mouse" && !suppressed.current && !anchor) show(e.currentTarget, delay);
      own.onPointerMove?.(e);
    },
    onPointerDown: (e) => {
      suppressed.current = true;
      hide();
      own.onPointerDown?.(e);
    },
    onPointerLeave: (e) => {
      suppressed.current = false;
      hide();
      own.onPointerLeave?.(e);
    },
    onFocus: (e) => {
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, 0);
      own.onFocus?.(e);
    },
    onBlur: (e) => {
      hide();
      own.onBlur?.(e);
    },
    "aria-describedby": anchor ? id : own["aria-describedby"],
  });

  return (
    <>
      {target}
      {anchor && content && (
        <Bubble id={id} anchor={anchor} placement={placement}>
          {content}
        </Bubble>
      )}
    </>
  );
}

function Bubble({ id, anchor, placement, children }: { id: string; anchor: DOMRect; placement: Placement; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: Placement } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fits = (side: Placement) =>
      side === "top" ? anchor.top - GAP - height >= MARGIN
      : side === "bottom" ? anchor.bottom + GAP + height <= vh - MARGIN
      : side === "left" ? anchor.left - GAP - width >= MARGIN
      : anchor.right + GAP + width <= vw - MARGIN;
    const side = fits(placement) || !fits(OPPOSITE[placement]) ? placement : OPPOSITE[placement];

    let x: number;
    let y: number;
    if (side === "top" || side === "bottom") {
      x = anchor.left + anchor.width / 2 - width / 2;
      y = side === "top" ? anchor.top - GAP - height : anchor.bottom + GAP;
    } else {
      x = side === "left" ? anchor.left - GAP - width : anchor.right + GAP;
      y = anchor.top + anchor.height / 2 - height / 2;
    }
    x = Math.min(Math.max(x, MARGIN), vw - width - MARGIN);
    y = Math.min(Math.max(y, MARGIN), vh - height - MARGIN);
    setPos({ x, y, side });
  }, [anchor, placement]);

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className={`tooltip${pos ? ` side-${pos.side}` : ""}`}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
