// Live validation for the lobby's "draft a whole set" field: checks the code on Scryfall as the
// host types (debounced), and remembers answers for the rest of the session.

import { useEffect, useState } from "react";
import { normalizeSetCode } from "../shared/importParser";
import { checkSet, type ScryfallSet, type SetCheck } from "../shared/setSource";

export type SetLookup =
  | { state: "idle" }
  | { state: "checking"; code: string }
  | { state: "ok"; code: string; set: ScryfallSet }
  /** `retry`: Scryfall couldn't be reached, so importing may still work. */
  | { state: "bad"; message: string; retry?: boolean };

const DEBOUNCE_MS = 350;
const FORMAT_HINT = "Set codes are 3–6 letters or numbers, like WTH or MH3.";
const settled = new Map<string, SetCheck>();

/** What the typed text says before asking Scryfall: still typing, malformed, or a code to look up. */
export function readSetInput(input: string): { code: string } | Extract<SetLookup, { state: "idle" | "bad" }> {
  const raw = input.trim().replace(/^(?:set|e):\s*/i, "");
  if (!raw) return { state: "idle" };
  const code = normalizeSetCode(raw);
  if (code) return { code };
  if (/^[a-z0-9]{1,2}$/i.test(raw)) return { state: "idle" }; // Still typing.
  return { state: "bad", message: FORMAT_HINT };
}

function toLookup(code: string, check: SetCheck): SetLookup {
  return check.ok ? { state: "ok", code, set: check.set } : { state: "bad", message: check.message, retry: check.retry };
}

export function useSetLookup(input: string): SetLookup {
  const read = readSetInput(input);
  const code = "state" in read ? null : read.code;
  const [result, setResult] = useState<{ code: string; check: SetCheck } | null>(null);

  useEffect(() => {
    if (!code || settled.has(code)) return;
    let live = true;
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

  if ("state" in read) return read;
  const known = settled.get(read.code) ?? (result?.code === read.code ? result.check : undefined);
  return known ? toLookup(read.code, known) : { state: "checking", code: read.code };
}
