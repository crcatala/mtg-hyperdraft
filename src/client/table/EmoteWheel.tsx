// The emote wheel: a right-click on your own companion opens six wedges around the cursor (geometry in
// emoteWheel.ts, sending in companionEmote.ts). Pick with a click, by right-click-dragging onto a wedge and
// letting go, or with the keys (1-6, arrows + Enter); Esc, a click outside or another right-click closes it.
// While open it owns the keyboard, so the table's own keys (1-4 views, arrows pan) stand down. Under the ring,
// "Edit lines" (or E) opens the player's own lines for it (EmoteLinesDialog.tsx); the centre is kept for Home.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EMOTE_SLOTS } from "../../shared/companionKit";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { closeEmoteWheel, emoteCooldown, sendEmote, useEmoteWheel, type WheelState } from "./companionEmote";
import { effectiveLine, openEmoteLines, useEmoteLines } from "./emoteLines";
import { DRAG_PICK_PX, emoteTint, stepWedge, wedgeAt, wedgeCenter, wedgePath, WHEEL_R } from "./emoteWheel";

export function EmoteWheel() {
  const wheel = useEmoteWheel((s) => s.wheel);
  return wheel ? <Wheel wheel={wheel} /> : null;
}

function Wheel({ wheel }: { wheel: WheelState }) {
  const companion = useStore((s) => s.view?.players.find((p) => p.id === s.view?.you)?.companion);
  const lastEmote = useEmoteWheel((s) => s.lastEmote);
  const custom = useEmoteLines((s) => s.custom);
  const ref = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const editButton = useRef<HTMLButtonElement>(null);
  /** The wedge picked out by the keyboard or the pointer (its line shows under the wheel). */
  const [active, setActive] = useState<number | null>(null);
  const [cooling, setCooling] = useState(() => emoteCooldown() > 0);

  // Dimmed while the last emote cools down; lit again the moment it's over.
  useEffect(() => {
    const left = emoteCooldown();
    setCooling(left > 0);
    if (left <= 0) return;
    const t = setTimeout(() => setCooling(false), left);
    return () => clearTimeout(t);
  }, [lastEmote]);

  const pick = (i: number) => {
    if (emoteCooldown() > 0) return;
    closeEmoteWheel();
    sendEmote(i);
  };
  const edit = () => {
    closeEmoteWheel();
    openEmoteLines();
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Focus moves into the wheel (so a screen reader lands on it) and back where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    // The right button that opened it may still be down: letting go over a wedge (having dragged there) picks it.
    // Any press after opening disarms that, so a second right-click is just a close.
    let armed = true;
    const inside = (t: EventTarget | null) => !!ref.current && ref.current.contains(t as Node);
    const onDown = (e: PointerEvent) => {
      armed = false;
      if (e.button !== 2 && !inside(e.target)) closeEmoteWheel();
    };
    const onUp = (e: PointerEvent) => {
      if (!armed || e.button !== 2) return;
      armed = false;
      if (Math.hypot(e.clientX - wheel.from.x, e.clientY - wheel.from.y) < DRAG_PICK_PX) return;
      const i = wedgeAt(e.clientX - wheel.at.x, e.clientY - wheel.at.y);
      if (i !== null) pickRef.current(i);
    };
    // Another right-click anywhere closes it, with neither the browser's menu nor the table's.
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      closeEmoteWheel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Everything else stands down while the wheel is open (the table's 1-4 views, arrow panning, Tab pings).
      e.stopPropagation();
      const go = (i: number) => {
        setActive(i);
        buttons.current[i]?.focus({ preventScroll: true });
      };
      const onEdit = document.activeElement === editButton.current;
      // Tab walks the wedges and then "Edit lines" (after the last one); the arrows only walk the wedges.
      const toEdit = () => {
        setActive(null);
        editButton.current?.focus({ preventScroll: true });
      };
      if (/^[1-6]$/.test(e.key)) {
        e.preventDefault();
        pickRef.current(Number(e.key) - 1);
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        edit();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const last = e.shiftKey ? 0 : EMOTE_SLOTS.length - 1;
        if (onEdit) go(e.shiftKey ? EMOTE_SLOTS.length - 1 : 0);
        else if (activeRef.current === last || (e.shiftKey && activeRef.current === null)) toEdit();
        else go(stepWedge(activeRef.current, e.shiftKey ? -1 : 1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        go(stepWedge(onEdit ? null : activeRef.current, 1));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        go(stepWedge(onEdit ? null : activeRef.current, -1));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (onEdit) edit();
        else if (activeRef.current !== null) pickRef.current(activeRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeEmoteWheel();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", closeEmoteWheel);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", closeEmoteWheel);
    };
  }, [wheel]);

  const line = active !== null ? effectiveLine(custom, companion, active) : undefined;
  return (
    <div
      ref={ref}
      // "Edit lines" and the line show under the wheel, or over it when there's no room below.
      className={`emote-wheel${cooling ? " cooling" : ""}${wheel.at.y + WHEEL_R + 104 > window.innerHeight ? " flip" : ""}`}
      role="menu"
      aria-label="Emotes"
      tabIndex={-1}
      style={{ left: wheel.at.x - WHEEL_R, top: wheel.at.y - WHEEL_R, width: WHEEL_R * 2, height: WHEEL_R * 2 }}
    >
      {EMOTE_SLOTS.map((e, i) => {
        const c = wedgeCenter(i);
        return (
          <button
            key={e.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            className={`emote-wedge${active === i ? " active" : ""}`}
            role="menuitem"
            aria-label={`${e.label}: ${effectiveLine(custom, companion, i) ?? ""}`}
            aria-keyshortcuts={String(i + 1)}
            aria-disabled={cooling || undefined}
            tabIndex={-1}
            style={{ clipPath: `path("${wedgePath(i)}")`, "--tint": emoteTint(i) } as CSSProperties}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive((a) => (a === i ? null : a))}
            onClick={() => pick(i)}
          >
            <span className="emote-face" style={{ left: WHEEL_R + c.x, top: WHEEL_R + c.y }}>
              <Icon name={e.icon} />
              <span className="emote-label">{e.label}</span>
              <kbd>{i + 1}</kbd>
            </span>
          </button>
        );
      })}
      <div className="emote-under">
        <button
          ref={editButton}
          className="emote-edit"
          role="menuitem"
          aria-label="Customize emote lines"
          aria-haspopup="dialog"
          aria-keyshortcuts="E"
          tabIndex={-1}
          onClick={edit}
        >
          <Icon name="pencil" />
          Edit lines
          <kbd>E</kbd>
        </button>
        {line && (
          <div className="emote-line" aria-hidden>
            “{line}”
          </div>
        )}
      </div>
    </div>
  );
}
