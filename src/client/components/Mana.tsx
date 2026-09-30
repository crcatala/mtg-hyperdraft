// Renders MTG symbols ({W}, {2}, {T}, {U/B}, {G/P}) with the open-source Mana font.

import { Fragment } from "react";

function symbolClass(sym: string): string {
  const s = sym.toLowerCase().replace("/", "");
  if (s === "t") return "ms-tap";
  if (s === "q") return "ms-untap";
  if (s === "∞") return "ms-infinity";
  if (s === "½") return "ms-1-2";
  return `ms-${s}`;
}

export function ManaSymbol({ sym, shadow }: { sym: string; shadow?: boolean }) {
  return <i className={`ms ${symbolClass(sym)} ms-cost${shadow ? " ms-shadow" : ""}`} aria-label={`{${sym}}`} />;
}

export function ManaCost({ cost, shadow }: { cost: string; shadow?: boolean }) {
  const parts = [...cost.matchAll(/\{([^}]+)\}|(\s*\/\/\s*)/g)];
  return (
    <span className="mana-cost">
      {parts.map((m, i) => (m[1] ? <ManaSymbol key={i} sym={m[1]} shadow={shadow} /> : <span key={i} className="mana-split">//</span>))}
    </span>
  );
}

/** Oracle text with inline symbols and paragraph breaks. Reminder text is italicised. */
export function RulesText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((para, i) => (
        <p key={i}>
          {para.split(/(\{[^}]+\}|\([^)]*\))/g).map((chunk, j) => {
            const sym = chunk.match(/^\{([^}]+)\}$/);
            if (sym) return <ManaSymbol key={j} sym={sym[1]} />;
            if (/^\(.*\)$/.test(chunk)) return <em key={j}>{chunk}</em>;
            return <Fragment key={j}>{chunk}</Fragment>;
          })}
        </p>
      ))}
    </>
  );
}

/** One line of prose with inline symbols, without the reminder-text styling of `RulesText`. */
export function SymbolText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{[^}]+\})/g).map((chunk, i) => {
        const sym = chunk.match(/^\{([^}]+)\}$/);
        return sym ? <ManaSymbol key={i} sym={sym[1]} /> : <Fragment key={i}>{chunk}</Fragment>;
      })}
    </>
  );
}
