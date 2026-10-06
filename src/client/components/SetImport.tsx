// The lobby's "draft a whole set" field: type a set code or search sets by name, pick from the list,
// and see right away whether the set can be drafted.

import { useEffect, useId, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { readSetInput, useSetLookup, type SetLookup } from "../setLookup";
import { searchSets, setTypeLabel, useSetCatalog } from "../setCatalog";
import { setLabel, type ScryfallSet } from "../../shared/setSource";

const MAX_SHOWN = 50;

export function SetImport({ running, onImport }: { running: boolean; onImport: (code: string) => void }) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  /** The set list loads the first time the field is used, not for every lobby visit. */
  const [used, setUsed] = useState(false);
  const [includeOther, setIncludeOther] = useState(false);
  const [active, setActive] = useState(-1);
  const catalog = useSetCatalog(used);
  const lookup = useSetLookup(input, catalog);
  const results = useMemo(() => (catalog ? searchSets(catalog, input, includeOther) : []), [catalog, input, includeOther]);
  const shown = results.slice(0, MAX_SHOWN);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const listOpen = open && used;

  const typed = readSetInput(input);
  // A verified code, or one Scryfall couldn't be asked about (the import itself will check again).
  const target = lookup.state === "ok" ? lookup.code : lookup.state === "bad" && lookup.retry && "code" in typed ? typed.code : null;

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (set: ScryfallSet) => {
    setInput(set.code.toUpperCase());
    setOpen(false);
    setActive(-1);
  };
  const submit = () => {
    if (!running && target) onImport(target);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (listOpen && active >= 0 && shown[active]) choose(shown[active]);
      else submit();
    } else if (e.key === "Escape" && listOpen) {
      e.stopPropagation();
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="set-import">
      <div className="set-import-head">
        <label className="label" htmlFor={`${listId}-input`}>
          Or draft a whole set — name or set code
        </label>
        <a className="faint small-print" href="https://scryfall.com/sets" target="_blank" rel="noreferrer">
          All sets on Scryfall <Icon name="external" />
        </a>
      </div>
      <div className="row">
        <input
          id={`${listId}-input`}
          className="input set-search-input"
          placeholder="Duskmourn, MH3, WTH…"
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
          aria-invalid={lookup.state === "bad" && !lookup.retry}
          aria-describedby={`${listId}-status`}
          value={input}
          onFocus={() => {
            setUsed(true);
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setInput(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          disabled={running}
        />
        <button className="btn" disabled={running || !target} onClick={submit}>
          Import set
        </button>
      </div>
      {listOpen && (
        // Clicks in the list mustn't blur the input (that would close the list before the click lands).
        <div className="set-picker" onMouseDown={(e) => e.preventDefault()}>
          {catalog ? (
            <ul id={`${listId}-list`} role="listbox" aria-label="Sets" className="set-list">
              {shown.map((set, i) => (
                <li
                  key={set.code}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`set-option${i === active ? " active" : ""}`}
                  onClick={() => choose(set)}
                  onMouseEnter={() => setActive(i)}
                >
                  <SetIcon set={set} />
                  <span className="set-option-name">{set.name}</span>
                  <span className="set-option-meta">
                    {upcoming(set) ? "Upcoming" : set.released_at?.slice(0, 4)} · {setTypeLabel(set.set_type)}
                  </span>
                  <span className="set-option-code">{set.code.toUpperCase()}</span>
                </li>
              ))}
              {shown.length === 0 && (
                <li className="set-option-empty faint small-print">
                  {lookup.state === "choose" || lookup.state === "ok" ? "Only precons and other products match: include them below." : "No sets match."}
                </li>
              )}
            </ul>
          ) : (
            <p className="set-option-empty faint small-print">
              <span className="spinner" /> Loading the set list…
            </p>
          )}
          <div className="set-list-foot faint small-print">
            <label className="set-other">
              <input type="checkbox" checked={includeOther} onChange={(e) => setIncludeOther(e.target.checked)} /> Include precons, Secret Lairs and other
              products
            </label>
            {results.length > MAX_SHOWN && (
              <span>
                {MAX_SHOWN} of {results.length}, keep typing
              </span>
            )}
          </div>
        </div>
      )}
      <p id={`${listId}-status`} className="set-check" aria-live="polite">
        <SetLookupStatus lookup={lookup} />
      </p>
    </div>
  );
}

function SetIcon({ set }: { set: ScryfallSet }) {
  return set.icon_svg_uri ? <span className="set-icon" aria-hidden style={{ "--icon": `url("${set.icon_svg_uri}")` } as React.CSSProperties} /> : null;
}

function SetLookupStatus({ lookup }: { lookup: SetLookup }) {
  switch (lookup.state) {
    case "idle":
      return <span className="faint small-print">Every card from one set's boosters, one copy each: no alternate art, promos or basics.</span>;
    case "choose":
      return (
<span className="faint small-print">Pick a set from the list.</span>
      );
    case "checking":
      return (
        <span className="faint small-print">
          <span className="spinner" /> Checking {lookup.code.toUpperCase()} on Scryfall…
        </span>
      );
    case "bad":
      return (
        <span className={`pill ${lookup.retry ? "warn" : "bad"}`}>
          <Icon name={lookup.retry ? "offline" : "x"} /> {lookup.message}
        </span>
      );
    case "ok": {
      const { set } = lookup;
      const soon = upcoming(set);
      return (
        <span className={`pill ${soon ? "warn" : "ok"}`}>
          {set.icon_svg_uri ? <SetIcon set={set} /> : <Icon name="check" />}
          {setLabel(set)}
          {set.released_at && (
            <span className="set-date">
              {" "}
              · {soon ? "releases " : ""}
              {releaseDate(set.released_at)}
            </span>
          )}
          {soon && " · card list may be incomplete"}
        </span>
      );
    }
  }
}

function upcoming(set: ScryfallSet): boolean {
  return !!set.released_at && set.released_at > new Date().toISOString().slice(0, 10);
}

/** "2024-08-02" → "Aug 2024". */
function releaseDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
