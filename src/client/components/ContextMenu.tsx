// Right-click menu rendered at the cursor, clamped to the viewport. Esc or any outside click closes it.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icon";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const close = useStore((s) => s.closeMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 8),
      y: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, close]);

  if (!menu) return null;
  // If any item has an icon, every item gets an icon-width slot so the labels line up.
  const iconColumn = menu.items.some((item) => item.icon);
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.title &&
        (menu.onTitle ? (
          <button
            className="ctx-title ctx-title-btn"
            title={menu.onTitle.label}
            onClick={() => {
              close();
              menu.onTitle?.onSelect();
            }}
          >
            <span>{menu.title}</span>
            <Icon name="zoom-in" />
          </button>
        ) : (
          <div className="ctx-title">{menu.title}</div>
        ))}
      {menu.items.map((item, i) =>
        item.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onSelect?.();
            }}
          >
            {iconColumn && <span className="ctx-icon">{item.icon && <Icon name={item.icon} />}</span>}
            {item.label}
            {item.hint && <span className="hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
