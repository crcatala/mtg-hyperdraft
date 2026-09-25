// A button with an attached caret that opens a small menu of related actions. The two halves are
// separate buttons (each can be disabled on its own); menu items can carry a Tooltip description.
// The menu is portalled with fixed positioning so parent overflow can't clip it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "./Tooltip";

export interface SplitItem {
  label: ReactNode;
  /** Shown in a tooltip when the item is hovered or focused. */
  description?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function SplitButton({
  children,
  onClick,
  disabled,
  className = "",
  mainClassName = "",
  items,
  menuLabel = "More options",
  menuDisabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Button style classes shared by both halves, e.g. "primary". */
  className?: string;
  /** Extra classes for the main half only. */
  mainClassName?: string;
  items: SplitItem[];
  menuLabel?: string;
  menuDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (menuDisabled) setOpen(false);
  }, [menuDisabled]);

  return (
    <div ref={wrap} className={`split-btn${open ? " open" : ""}`}>
      <button className={`btn ${className} split-main ${mainClassName}`} disabled={disabled} onClick={onClick}>
        {children}
      </button>
      <button
        ref={caret}
        className={`btn ${className} split-caret`}
        disabled={menuDisabled}
        aria-label={menuLabel}
        title={open ? undefined : menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && wrap.current && (
        <Menu
          anchor={wrap.current}
          label={menuLabel}
          items={items}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) caret.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function Menu({ anchor, label, items, onClose }: { anchor: HTMLElement; label: string; items: SplitItem[]; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // Right-aligned under the button; above it if there's no room below.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const h = ref.current?.getBoundingClientRect().height ?? 0;
    const below = a.bottom + 6 + h <= window.innerHeight - 8;
    setPos({ top: below ? a.bottom + 6 : Math.max(8, a.top - 6 - h), right: Math.max(8, window.innerWidth - a.right) });
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose(true);
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    const onResize = () => onClose(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu split-menu"
      role="menu"
      aria-label={label}
      style={pos ? { top: pos.top, right: pos.right } : { top: -9999, right: 0, visibility: "hidden" }}
    >
      {items.map((item, i) => {
        const button = (
          <button
            key={i}
            role="menuitem"
            className={`ctx-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose(false);
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        );
        return item.description ? (
          <Tooltip key={i} content={item.description} placement="left">
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>,
    document.body,
  );
}
