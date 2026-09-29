// Rules help beside the zoomed card: its mechanics and types as MTG Wiki links, and the card's
// official rulings, fetched from Scryfall only when the player asks for them.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { CardData } from "../../shared/types";
import { cardHelpTerms, rulesLookupUrl } from "../cardHelp";
import { cachedRulings, fetchRulings, hasRulingsLookup, type Ruling } from "../rulings";
import { Icon } from "./Icon";
import { SymbolText } from "./Mana";

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function TermLinks({ title, terms }: { title: string; terms: string[] }) {
  if (terms.length === 0) return null;
  return (
    <section className="card-help-section">
      <h4>{title}</h4>
      <ul className="card-help-terms">
        {terms.map((t) => (
          <li key={t}>
            <a href={rulesLookupUrl(t)} target="_blank" rel="noopener noreferrer" title={`Look up ${t} on the MTG Wiki (new tab)`}>
              {t}
              <Icon name="external" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

type RulingsState = { status: "idle" | "loading" | "error" } | { status: "done"; rulings: Ruling[] };

function Rulings({ card }: { card: CardData }) {
  const [state, setState] = useState<RulingsState>(() => {
    const cached = cachedRulings(card);
    return cached ? { status: "done", rulings: cached } : { status: "idle" };
  });
  const load = () => {
    setState({ status: "loading" });
    fetchRulings(card).then(
      (rulings) => setState({ status: "done", rulings }),
      () => setState({ status: "error" }),
    );
  };

  if (state.status === "done") {
    return (
      <section className="card-help-section">
        <h4>Rulings ({state.rulings.length})</h4>
        {state.rulings.length === 0 ? (
          <p className="faint">No official rulings for this card.</p>
        ) : (
          <ol className="card-rulings">
            {state.rulings.map((r, i) => (
              <li key={i}>
                <p>
                  <SymbolText text={r.comment} />
                </p>
                <span className="faint">
                  {formatDate(r.publishedAt)}
                  {r.source === "scryfall" && " · Scryfall note"}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="card-help-note faint">Rulings via Scryfall.</p>
      </section>
    );
  }
  return (
    <section className="card-help-section">
      <button className="btn small card-rulings-btn" onClick={load} disabled={state.status === "loading"}>
        <Icon name="book" />
        {state.status === "loading" ? "Loading rulings…" : "View detailed rulings"}
      </button>
      <p className="card-help-note faint">
        {state.status === "error" ? "Couldn't load rulings from Scryfall. Try again in a moment." : "Official rulings for this card, loaded from Scryfall."}
      </p>
    </section>
  );
}

export function CardHelp({ card, face, style, onHide }: { card: CardData; face: number; style?: CSSProperties; onHide: () => void }) {
  const { mechanics, types } = cardHelpTerms(card, face);
  return (
    <aside className="card-help" style={style} aria-label="Rules help">
      <button className="card-help-hide" onClick={onHide} aria-label="Hide rules help" title="Hide rules help">
        <Icon name="chevron-up" />
      </button>
      <div className="card-help-body">
        <TermLinks title="Mechanics" terms={mechanics} />
        <TermLinks title="Types" terms={types} />
        {(mechanics.length > 0 || types.length > 0) && <p className="card-help-note faint">Links open the community MTG Wiki in a new tab.</p>}
        {hasRulingsLookup(card) && <Rulings key={card.oracleId} card={card} />}
      </div>
    </aside>
  );
}

const HINT_MS = 6000;

/**
 * One-time pointer to where the rules help went after hiding it: a hand-drawn arrow up to the
 * button and a note. Fades by itself (hovering holds it), or dismiss it with ×.
 */
export function RulesHelpHint({ anchor, onDone }: { anchor: HTMLElement | null; onDone: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow the button while showing: it moves when the title changes or the window resizes.
  useLayoutEffect(() => {
    if (!anchor) return;
    let raf = 0;
    const measure = () => {
      const r = anchor.getBoundingClientRect();
      setRect((prev) => (prev && prev.left === r.left && prev.bottom === r.bottom && prev.width === r.width ? prev : r));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);

  const leave = useCallback(() => setLeaving(true), []);
  const hold = () => clearTimeout(timer.current);
  const release = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(leave, ms);
  };
  useEffect(() => {
    release(HINT_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, 350);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  if (!rect) return null;
  const W = window.innerWidth;
  const note = (
    <>
      <p>Rules help is tucked up here. Click it to bring it back any time.</p>
      <button className="rules-hint-close" onClick={leave} aria-label="Dismiss tip" title="Dismiss">
        <Icon name="x" />
      </button>
    </>
  );
  // Beside the button when there's room (clear of the card and the close button), else below it.
  const sideW = 290;
  if (rect.right + 58 + sideW + 80 <= W) {
    const y = rect.top + rect.height / 2;
    return (
      <div className={`rules-hint${leaving ? " leaving" : ""}`} onPointerEnter={hold} onPointerLeave={() => release(2500)}>
        <svg className="rules-hint-arrow" style={{ left: rect.right + 2, top: y - 20 }} width="58" height="40" viewBox="0 0 58 40" aria-hidden>
          <path pathLength={1} d="M55 29C45 34 31 34 21 27.5 15 23.5 10 21 5 20" />
          <path pathLength={1} className="head" d="M12.5 13 4.4 19.8 12.8 25" />
        </svg>
        <div className="rules-hint-anchor" style={{ left: rect.right + 60, top: y + 12 }}>
          <div className="rules-hint-note" role="status" style={{ width: sideW }}>
            {note}
          </div>
        </div>
      </div>
    );
  }
  const x = rect.left + rect.width / 2;
  const belowW = Math.min(250, W - 32);
  // Arrow and note trail off to the right, unless that would run off screen.
  const flip = x + belowW + 20 > W;
  const top = rect.bottom + 6;
  const left = Math.max(16, Math.min(W - belowW - 16, flip ? x - belowW + 10 : x + 12));
  return (
    <div className={`rules-hint${leaving ? " leaving" : ""}`} onPointerEnter={hold} onPointerLeave={() => release(2500)}>
      <svg className={`rules-hint-arrow${flip ? " flip" : ""}`} style={{ left: flip ? x - 60 : x - 12, top }} width="72" height="48" viewBox="0 0 72 48" aria-hidden>
        <path pathLength={1} d="M60 46C57 34 47 29 36 26.5 24 24 16 19.5 13 5" />
        <path pathLength={1} className="head" d="M6.5 12.5 12.6 4.2 19.8 11" />
      </svg>
      <div className="rules-hint-anchor" style={{ left, top: top + 46 }}>
        <div className="rules-hint-note below" role="status" style={{ width: belowW }}>
          {note}
        </div>
      </div>
    </div>
  );
}
