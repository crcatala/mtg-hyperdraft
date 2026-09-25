// Styled hover/focus tooltip. Wrap a single element that accepts pointer/focus handlers:
//
//   <Tooltip content="What this does" placement="left"><button>…</button></Tooltip>
//
// The bubble is portalled to <body> with fixed positioning, flips to the opposite side when there's
// no room, and stays inside the viewport. Keyboard focus shows it immediately; hover after a delay.

import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type Placement = "top" | "bottom" | "left" | "right";

const OPPOSITE: Record<Placement, Placement> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const GAP = 10;
const MARGIN = 8;

interface TargetProps {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
}

export function Tooltip({
  content,
  placement = "top",
  delay = 250,
  children,
}: {
  content: ReactNode;
  placement?: Placement;
  delay?: number;
  children: ReactElement<TargetProps>;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (el: HTMLElement, wait: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnchor(el.getBoundingClientRect()), wait);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setAnchor(null);
  };

  const own = children.props;
  const target = cloneElement(children, {
    onPointerEnter: (e) => {
      if (e.pointerType === "mouse") show(e.currentTarget, delay);
      own.onPointerEnter?.(e);
    },
    onPointerLeave: (e) => {
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
