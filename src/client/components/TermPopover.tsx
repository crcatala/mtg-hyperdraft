// A mechanic or type in the rules help: a link to its MTG Wiki page that also explains the term in
// place. Hovering (or keyboard focus) opens a popover with the wiki's reminder text and summary,
// fetched on first open and cached. On touch screens the first tap opens the popover instead of
// following the link; the popover has its own link through to the wiki. The popover lives at the
// end of the page, so Tab is steered into it from its chip and back out to the chip's neighbour.

import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { rulesLookupUrl } from "../cardHelp";
import { cachedTermInfo, fetchTermInfo, type TermInfo } from "../wikiTerms";
import { Icon } from "./Icon";
import { ManaSymbol } from "./Mana";

const OPEN_DELAY = 300;
const CLOSE_DELAY = 300;
const GAP = 10;
const MARGIN = 8;

// One popover at a time: opening one closes whichever was open.
let current: { hide: () => void; dismiss: () => void } | null = null;

/** Closes the open popover, if there is one, putting focus back on its chip. Lets Escape close
 *  the popover before whatever it sits over. */
export function dismissTermPopover(): boolean {
  if (!current) return false;
  current.dismiss();
  return true;
}

const focusables = (el: HTMLElement | null) => Array.from(el?.querySelectorAll<HTMLElement>("a[href], button") ?? []);

type Status = { state: "loading" } | { state: "error" } | { state: "done"; info: TermInfo | null };

function initialStatus(term: string): Status {
  const cached = cachedTermInfo(term);
  return cached === undefined ? { state: "loading" } : { state: "done", info: cached };
}

export function TermChip({ term }: { term: string }) {
  const chipRef = useRef<HTMLAnchorElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerType = useRef("mouse");
  const id = useId();

  const hide = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    setOpen(false);
    if (current?.hide === hide) current = null;
  }, []);
  // Focus goes back to the chip first; refocusing it would otherwise reopen the popover.
  const dismiss = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) chipRef.current?.focus();
    hide();
  }, [hide]);
  const show = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    if (current && current.hide !== hide) current.hide();
    current = { hide, dismiss };
    setOpen(true);
  }, [hide, dismiss]);
  const hideSoon = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(hide, CLOSE_DELAY);
  };
  const keepOpen = () => clearTimeout(closeTimer.current);

  useEffect(() => hide, [hide]);

  // Tap or click elsewhere closes it; so does scrolling anything but the popover (it's fixed), or
  // resizing the window, which moves the chip out from under it.
  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Node && (chipRef.current?.contains(t) || popRef.current?.contains(t));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) hide();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) hide();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, hide, dismiss]);

  // Tabbing off either end of the popover goes back to where it hangs from: Shift+Tab to the chip,
  // Tab onward from the chip (focusing it without stopping the Tab moves focus to its neighbour).
  const tabOut = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const all = focusables(popRef.current);
    const atEdge = e.shiftKey ? e.target === all[0] || e.target === popRef.current : e.target === all[all.length - 1];
    if (atEdge) {
      if (e.shiftKey) e.preventDefault();
      chipRef.current?.focus();
    }
  };

  return (
    <>
      <a
        ref={chipRef}
        href={rulesLookupUrl(term)}
        target="_blank"
        rel="noopener noreferrer"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerDown={(e) => {
          pointerType.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          pointerType.current = e.pointerType;
          if (e.pointerType !== "mouse") return;
          keepOpen();
          if (!open) openTimer.current = setTimeout(show, OPEN_DELAY);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") hideSoon();
        }}
        onClick={(e) => {
          // Touch has no hover: the first tap explains, a second tap (or the popover's link) opens the wiki.
          if (pointerType.current !== "mouse" && !open) {
            e.preventDefault();
            show();
          }
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) show();
        }}
        onBlur={(e) => {
          if (!popRef.current?.contains(e.relatedTarget as Node | null)) hide();
        }}
        onKeyDown={(e) => {
          if (!open || e.key !== "Tab" || e.shiftKey) return;
          const first = focusables(popRef.current)[0];
          if (!first) return;
          e.preventDefault();
          first.focus();
        }}
      >
        {term}
        <Icon name="external" />
      </a>
      {open && chipRef.current && (
        <Popover id={id} term={term} anchor={chipRef.current} popRef={popRef} onEnter={keepOpen} onLeave={hideSoon} onKeyDown={tabOut} onBlur={(e) => !chipRef.current?.contains(e.relatedTarget as Node | null) && !popRef.current?.contains(e.relatedTarget as Node | null) && hide()} />
      )}
    </>
  );
}

function Popover({
  id,
  term,
  anchor,
  popRef,
  onEnter,
  onLeave,
  onKeyDown,
  onBlur,
}: {
  id: string;
  term: string;
  anchor: HTMLElement;
  popRef: RefObject<HTMLDivElement | null>;
  onEnter: () => void;
  onLeave: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onBlur: (e: FocusEvent) => void;
}) {
  const [status, setStatus] = useState<Status>(() => initialStatus(term));
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(() => {
    setStatus({ state: "loading" });
    fetchTermInfo(term).then(
      (info) => setStatus({ state: "done", info }),
      () => setStatus({ state: "error" }),
    );
  }, [term]);
  useEffect(() => {
    if (status.state === "loading") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside the rules panel, so every chip stays reachable: to its right if there's room, else
  // its left (over the card's edge), level with the chip. Where the panel spans the screen
  // (phones), below or above the chip. Re-measured as content loads; beside the panel it hangs
  // from the chip's top, so growing doesn't move it.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const panel = anchor.closest(".card-help")?.getBoundingClientRect() ?? a;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x: number;
    let y: number;
    if (panel.right + GAP + width <= vw - MARGIN) {
      x = panel.right + GAP;
      y = a.top - 12;
    } else if (panel.left - GAP - width >= MARGIN) {
      x = panel.left - GAP - width;
      y = a.top - 12;
    } else {
      x = a.left + a.width / 2 - width / 2;
      y = a.bottom + GAP + height <= vh - MARGIN ? a.bottom + GAP : a.top - GAP - height;
    }
    x = Math.min(Math.max(x, MARGIN), vw - width - MARGIN);
    y = Math.min(Math.max(y, MARGIN), vh - height - MARGIN);
    setPos((p) => (p && p.x === x && p.y === y ? p : { x, y }));
  }, [anchor, popRef, status]);

  const info = status.state === "done" ? status.info : null;
  return createPortal(
    <div
      ref={popRef}
      id={id}
      role="dialog"
      tabIndex={-1}
      aria-label={`${term}, from the MTG Wiki`}
      className="term-pop"
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999, visibility: "hidden" }}
      onPointerEnter={onEnter}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <header className="term-pop-head">
        <b>{info?.title ?? term}</b>
        {info && info.title.toLowerCase() !== term.toLowerCase() && <span className="faint">for “{term}”</span>}
      </header>
      {status.state === "loading" && (
        <div className="term-pop-skeleton" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      )}
      {status.state === "error" && (
        <p className="term-pop-empty faint">
          Couldn't reach the MTG Wiki.{" "}
          {/* The button goes once the retry starts; focus waits on the popover rather than being lost. */}
          <button
            className="link-btn"
            onClick={() => {
              popRef.current?.focus();
              load();
            }}
          >
            Try again
          </button>
        </p>
      )}
      {status.state === "done" && !info && <p className="term-pop-empty faint">The MTG Wiki has no page for this name. It may be a flavor name for an ability the card spells out in full.</p>}
      {info?.reminder && (
        <div className="term-pop-reminder">
          <ReminderText text={info.reminder} />
        </div>
      )}
      {info?.summary && (
        <div className="term-pop-summary">
          {info.summary.split("\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      <footer className="term-pop-foot">
        <a href={rulesLookupUrl(term)} target="_blank" rel="noopener noreferrer">
          {status.state === "done" && !info ? "Search the MTG Wiki" : "Read more on MTG Wiki"}
          <Icon name="external" />
        </a>
        <a className="faint" href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer" title="MTG Wiki text is licensed CC BY-NC-SA 4.0">
          CC BY-NC-SA
        </a>
      </footer>
    </div>,
    document.body,
  );
}

/** Reminder text: mana symbols as symbols, placeholders like [cost] set apart. */
function ReminderText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <p key={i}>
          {line.split(/(\{[^}]+\}|\[[^\]]+\])/g).map((chunk, j) => {
            const sym = chunk.match(/^\{([^}]+)\}$/);
            if (sym) return <ManaSymbol key={j} sym={sym[1]} />;
            if (/^\[.*\]$/.test(chunk)) return <span key={j} className="term-pop-ph">{chunk.slice(1, -1)}</span>;
            return <Fragment key={j}>{chunk}</Fragment>;
          })}
        </p>
      ))}
    </>
  );
}
