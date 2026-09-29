// Rules help beside the zoomed card: its mechanics and types as MTG Wiki links, and the card's
// official rulings, fetched from Scryfall only when the player asks for them.

import { useState, type CSSProperties } from "react";
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

export function CardHelp({ card, face, style }: { card: CardData; face: number; style?: CSSProperties }) {
  const { mechanics, types } = cardHelpTerms(card, face);
  return (
    <aside className="card-help" style={style} aria-label="Rules help">
      <TermLinks title="Mechanics" terms={mechanics} />
      <TermLinks title="Types" terms={types} />
      {(mechanics.length > 0 || types.length > 0) && <p className="card-help-note faint">Links open the community MTG Wiki in a new tab.</p>}
      {hasRulingsLookup(card) && <Rulings key={card.oracleId} card={card} />}
    </aside>
  );
}
