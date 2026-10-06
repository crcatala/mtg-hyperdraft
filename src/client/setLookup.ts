// Live validation for the lobby's "draft a whole set" field. With the set catalog loaded, codes and
// names are checked locally; a code the catalog doesn't know (or every code, if the catalog couldn't
// load) is checked on Scryfall after the host stops typing, and the answer is remembered for the session.

import { useEffect, useState } from "react";
import { normalizeSetCode } from "../shared/importParser";
import { checkSet, setProblem, type ScryfallSet, type SetCheck } from "../shared/setSource";
import { searchSets } from "./setCatalog";

export type SetLookup =
  | { state: "idle" }
  /** Text that matches set names (counting other products): pick one from the list. */
  | { state: "choose"; count: number }
  | { state: "checking"; code: string }
  | { state: "ok"; code: string; set: ScryfallSet }
  /** `retry`: Scryfall couldn't be reached, so importing may still work. */
  | { state: "bad"; message: string; retry?: boolean };

/** A code to check on Scryfall. */
type Ask = { code: string };

export const DEBOUNCE_MS = 350;
const FORMAT_HINT = "Set codes are 3–6 letters or numbers, like WTH or MH3.";
const settled = new Map<string, SetCheck>();

/** Without the catalog: still typing, malformed, or a code to look up. */
export function readSetInput(input: string): Ask | Extract<SetLookup, { state: "idle" | "bad" }> {
  const raw = input.trim().replace(/^(?:set|e):\s*/i, "");
  if (!raw) return { state: "idle" };
  const code = normalizeSetCode(raw);
  if (code) return { code };
  if (/^[a-z0-9]{1,2}$/i.test(raw)) return { state: "idle" }; // Still typing.
  return { state: "bad", message: FORMAT_HINT };
}

/** With the catalog: known codes are answered here; an unknown one may be newer than the cached list. */
export function lookupInCatalog(input: string, catalog: ScryfallSet[]): Ask | SetLookup {
  if (!input.trim()) return { state: "idle" };
  const read = readSetInput(input);
  if ("code" in read) {
    const set = catalog.find((s) => s.code === read.code);
    if (set) {
      const problem = setProblem(set);
      return problem ? { state: "bad", message: problem } : { state: "ok", code: read.code, set };
    }
  }
  const count = searchSets(catalog, input, true).length;
  if (count > 0) return { state: "choose", count };
  if ("code" in read) return read;
  return { state: "bad", message: `No set matches "${input.trim()}".` };
}

function toLookup(code: string, check: SetCheck): SetLookup {
  return check.ok ? { state: "ok", code, set: check.set } : { state: "bad", message: check.message, retry: check.retry };
}

export function useSetLookup(input: string, catalog: ScryfallSet[] | null): SetLookup {
  const pre = catalog ? lookupInCatalog(input, catalog) : readSetInput(input);
  const code = "state" in pre ? null : pre.code;
  const [result, setResult] = useState<{ code: string; check: SetCheck } | null>(null);

  useEffect(() => {
    if (!code || settled.has(code)) return;
    let live = true;
    // Each keystroke restarts the wait, so only the code the host settles on reaches Scryfall.
    const timer = setTimeout(() => {
      void checkSet(code, (url, init) => fetch(url, init)).then((check) => {
        if (check.ok || !check.retry) settled.set(code, check);
        if (live) setResult({ code, check });
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [code]);

  if ("state" in pre) return pre;
  const known = settled.get(pre.code) ?? (result?.code === pre.code ? result.check : undefined);
  return known ? toLookup(pre.code, known) : { state: "checking", code: pre.code };
}
