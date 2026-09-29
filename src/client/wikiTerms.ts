// Short explanations of mechanics and types from the community MTG Wiki (mtg.wiki, CC BY-NC-SA),
// fetched when a player hovers or taps a term in the rules help and kept for the session. One
// MediaWiki API request per term gives the article's plain-text opening and the reminder text
// from its infobox (the one-line explanation Wizards prints on cards).

export interface TermInfo {
  /** The wiki's page title, after redirects ("Tribal" → "Kindred"). */
  title: string;
  /** Reminder text; may hold symbols ({T}), placeholders ([cost]) and line breaks. */
  reminder?: string;
  summary?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://mtg.wiki/api.php";
const SUMMARY_MAX = 340;

/** Wiki markup in infobox values → plain text, keeping mana symbols as {T}, {2}... */
export function cleanWikitext(s: string): string {
  let t = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n");
  // Mana templates ({{T}}, {{2}}, {{W/U}}) become symbols, then other templates unwrap from the
  // inside out, so {{nowrap|{{1}}.}} ends up as "{1}.". Unknown templates are dropped.
  t = t.replace(/\{\{\s*([WUBRGCXYZSTQE0-9/P½∞]+)\s*\}\}/gi, (_, sym: string) => `{${sym.toUpperCase()}}`);
  for (let i = 0; i < 5 && t.includes("{{"); i++) {
    t = t.replace(/\{\{((?:[^{}]|\{[^{}]*\})*)\}\}/g, (_, body: string) => {
      const [name, ...args] = body.split("|").map((p) => p.trim());
      return name.toLowerCase() === "nowrap" || name.toLowerCase() === "nil" ? args.join("|") : "";
    });
  }
  t = t
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&");
  return t
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** The `reminder` field of the page's infobox, if it has one. */
export function reminderFromWikitext(wikitext: string): string | undefined {
  const m = wikitext.match(/\|\s*reminder\s*=([\s\S]*?)(?=\n\s*\||\n\s*\}\}|$)/m);
  let value = m?.[1] ?? "";
  // A value on the infobox's last line runs into its closing braces.
  const count = (re: RegExp) => (value.match(re) ?? []).length;
  while (value.trimEnd().endsWith("}}") && count(/\}\}/g) > count(/\{\{/g)) value = value.trimEnd().slice(0, -2);
  const text = cleanWikitext(value);
  return text || undefined;
}

function firstParagraph(text: string): string {
  return (
    text
      .split("\n")
      .map((p) => p.trim())
      .find(Boolean) ?? ""
  );
}

/** Cut at the last full sentence that fits. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/**
 * The article's opening paragraph. Openings that only say where a mechanic debuted ("Ward is an
 * evergreen keyword introduced in Strixhaven.") get the Description section's first paragraph too.
 */
export function summaryFromExtract(extract: string): string | undefined {
  const [intro, ...rest] = extract.split(/\n*^==+\s*(.+?)\s*==+\s*$\n*/m);
  let text = firstParagraph(intro);
  if (text.length < 200) {
    const at = rest.findIndex((part, i) => i % 2 === 0 && /^description$/i.test(part));
    const more = at >= 0 ? firstParagraph(rest[at + 1] ?? "") : "";
    if (more) text = text ? `${text}\n${more}` : more;
  }
  // Plain-text extracts drop inline symbols, leaving gaps ("with the  or  symbol").
  text = text.replace(/[ \t]{2,}/g, " ").replace(/ ([,.;:])/g, "$1");
  return text ? clip(text, SUMMARY_MAX) : undefined;
}

export function termInfoUrl(term: string): string {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts|revisions",
    explaintext: "1",
    exsectionformat: "wiki",
    exchars: "1600",
    rvprop: "content",
    rvslots: "main",
    rvsection: "0",
    redirects: "1",
    titles: term,
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  return `${API}?${params}`;
}

interface ApiPage {
  title: string;
  missing?: boolean;
  extract?: string;
  revisions?: { slots?: { main?: { content?: string } } }[];
}

const loaded = new Map<string, TermInfo | null>();
const pending = new Map<string, Promise<TermInfo | null>>();

/** Info fetched this session: a TermInfo, null if the wiki has no page, undefined if not fetched. */
export function cachedTermInfo(term: string): TermInfo | null | undefined {
  return loaded.get(term);
}

export function fetchTermInfo(term: string, fetchFn: FetchLike = (url, init) => fetch(url, init)): Promise<TermInfo | null> {
  if (loaded.has(term)) return Promise.resolve(loaded.get(term)!);
  let p = pending.get(term);
  if (!p) {
    p = (async () => {
      const res = await fetchFn(termInfoUrl(term), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`MTG Wiki lookup failed (${res.status})`);
      const body = (await res.json()) as { query?: { pages?: ApiPage[] } };
      const page = body.query?.pages?.[0];
      let info: TermInfo | null = null;
      if (page && !page.missing) {
        const wikitext = page.revisions?.[0]?.slots?.main?.content ?? "";
        info = { title: page.title, reminder: reminderFromWikitext(wikitext), summary: summaryFromExtract(page.extract ?? "") };
      }
      loaded.set(term, info);
      return info;
    })().finally(() => pending.delete(term));
    pending.set(term, p);
  }
  return p;
}

/** Test hook: forget everything fetched so far. */
export function clearTermInfoCache(): void {
  loaded.clear();
  pending.clear();
}
