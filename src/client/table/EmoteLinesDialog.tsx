// "Your emote lines": rewrite any of the wheel's six lines, opened from the wheel's "Edit lines" (or E). Only the
// text changes; the slot's icon, colour, sound and reaction stay. Saved to this tab's memory (emoteLines.ts),
// nowhere else. Every line is cleaned (shared/emoteText.ts) the way the room will clean it, and shown by React as
// plain text, never as HTML. While it's open the table's keys stand down (shortcutsBlocked) and the wheel stays shut.

import { useEffect, useId, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { EMOTE_SLOTS, emoteLine } from "../../shared/companionKit";
import { cleanEmoteText, EMOTE_TEXT_MAX, EMOTE_TEXT_RAW_MAX, emoteTextLength, tidyEmoteText } from "../../shared/emoteText";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { closeEmoteLines, effectiveLine, setCustomLines, useEmoteLines } from "./emoteLines";
import { emoteTint } from "./emoteWheel";

/** Line breaks (and the spaces around them) in pasted text: they become one space. */
const BREAK = /[\r\n\u0085\u2028\u2029]/;
const BREAKS = /\s*[\r\n\u0085\u2028\u2029]+\s*/g;

export function EmoteLinesDialog() {
  const editing = useEmoteLines((s) => s.editing);
  return editing ? <Dialog /> : null;
}

function Dialog() {
  const companion = useStore((s) => s.view?.players.find((p) => p.id === s.view?.you)?.companion);
  const [values, setValues] = useState(() => EMOTE_SLOTS.map((_, i) => effectiveLine(useEmoteLines.getState().custom, companion, i) ?? ""));
  const titleId = useId();
  const baseId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const defaults = EMOTE_SLOTS.map((_, i) => emoteLine(companion, i) ?? "");
  const cleaned = values.map(cleanEmoteText);
  const valid = cleaned.every((c) => c !== null);
  const set = (i: number, value: string) => setValues((v) => v.map((old, j) => (j === i ? value : old)));
  const save = () => {
    if (!valid) return;
    setCustomLines(cleaned, companion);
    closeEmoteLines();
  };

  // Focus moves to the first line on open and back to whatever had it on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    inputs.current[0]?.focus();
    inputs.current[0]?.select();
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // Esc closes without saving (capture phase, so the table doesn't also clear its selection behind us).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeEmoteLines();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Tab cycles within the dialog instead of wandering into the table behind it.
  const trapTab = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button, input")].filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  // Pasted line breaks become spaces (a text input would just drop them, gluing the words together).
  const paste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!BREAK.test(text)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const flat = text.replace(BREAKS, " ");
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    set(i, el.value.slice(0, start) + flat + el.value.slice(end));
    requestAnimationFrame(() => el.setSelectionRange(start + flat.length, start + flat.length));
  };

  const resetAll = () => {
    setValues(defaults);
    inputs.current[0]?.focus();
  };

  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeEmoteLines()}>
      <div className="modal panel emote-lines" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapTab}>
        <header className="settings-head">
          <h2 id={titleId}>Your emote lines</h2>
          <button className="btn ghost small icon-only" onClick={closeEmoteLines} aria-label="Close" title="Close (Esc)">
            <Icon name="x" />
          </button>
        </header>
        <form
          className="emote-lines-body"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <ul className="emote-lines-list">
            {EMOTE_SLOTS.map((slot, i) => {
              const length = emoteTextLength(tidyEmoteText(values[i]));
              const error = cleaned[i] !== null ? null : length === 0 ? "A line can't be empty." : `Too long: keep it to ${EMOTE_TEXT_MAX} characters.`;
              const id = `${baseId}-${i}`;
              return (
                <li key={slot.id} className="emote-lines-row" style={{ "--tint": emoteTint(i) } as CSSProperties}>
                  <span className="emote-lines-badge" aria-hidden>
                    <Icon name={slot.icon} />
                  </span>
                  <label className="emote-lines-label" htmlFor={id}>
                    {slot.label}
                  </label>
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    id={id}
                    className="input"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={EMOTE_TEXT_RAW_MAX}
                    value={values[i]}
                    placeholder={defaults[i]}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
                    onChange={(e) => set(i, e.target.value)}
                    onPaste={(e) => paste(i, e)}
                  />
                  <span id={`${id}-count`} className={`emote-lines-count${length > EMOTE_TEXT_MAX ? " over" : ""}`} aria-label={`${length} of ${EMOTE_TEXT_MAX} characters`}>
                    {length}/{EMOTE_TEXT_MAX}
                  </span>
                  <button
                    type="button"
                    className="btn ghost small icon-only"
                    aria-label={`Reset ${slot.label} to its default`}
                    title="Back to the default"
                    disabled={values[i] === defaults[i]}
                    onClick={() => {
                      set(i, defaults[i]);
                      inputs.current[i]?.focus();
                    }}
                  >
                    <Icon name="flip" />
                  </button>
                  {error && (
                    <p id={`${id}-error`} className="emote-lines-error" role="alert">
                      {error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="faint settings-note">Only on this tab: lines reset when you close or reload it.</p>
          <div className="row">
            <button type="button" className="btn ghost" onClick={resetAll}>
              Reset to defaults
            </button>
            <div className="spacer" />
            <button type="button" className="btn" onClick={closeEmoteLines}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!valid}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
