import { beforeEach, describe, expect, it } from "vitest";
import { cachedTermInfo, cleanWikitext, clearTermInfoCache, fetchTermInfo, reminderFromWikitext, summaryFromExtract, termInfoUrl } from "../src/client/wikiTerms";

const WARD_WIKITEXT = `{{Infobox keyword
| type = Triggered
| last = {{nil|Evergreen}}
| reminder = Whenever this [permanent] becomes the target of a spell or ability an opponent controls, counter it unless that player pays [cost].
| storm_ref = <ref>{{EzTumblr|https://example.com|title=Storm Scale}}</ref>
| icon = MTGSymbols-Ward.png
}}
'''Ward''' is an [[evergreen]] [[triggered ability|triggered]] [[keyword ability]].`;

describe("wiki markup", () => {
  it("turns mana templates into symbols and unwraps nested templates", () => {
    expect(cleanWikitext("This creature can attack and {{T}} as soon as it comes under your control.")).toBe("This creature can attack and {T} as soon as it comes under your control.");
    expect(cleanWikitext("Each card you exile pays for {{nowrap|{{1}}.}}")).toBe("Each card you exile pays for {1}.");
    expect(cleanWikitext("Pay {{W/U}} or {{2}}")).toBe("Pay {W/U} or {2}");
  });

  it("keeps link labels, drops italics, refs, comments and unknown templates", () => {
    expect(cleanWikitext("An [[Aura]] with [[enchant creature|enchant]].<ref>{{Cite|x}}</ref><!-- note -->{{Unknown|y}}")).toBe("An Aura with enchant.");
    expect(cleanWikitext("Whenever a land enters, …<br>''Landfall'' — If you had a land enter this turn, …")).toBe("Whenever a land enters, …\nLandfall — If you had a land enter this turn, …");
  });

  it("reads the infobox reminder, if there is one", () => {
    expect(reminderFromWikitext(WARD_WIKITEXT)).toBe("Whenever this [permanent] becomes the target of a spell or ability an opponent controls, counter it unless that player pays [cost].");
    expect(reminderFromWikitext("{{Infobox action\n| first = Dominaria\n| noreminder = yes\n}}\n'''Double''' is a keyword action.")).toBeUndefined();
    expect(reminderFromWikitext("{{Infobox keyword\n| reminder = This creature can't be blocked.}}\n'''Unblockable''' is an [[ability]].")).toBe("This creature can't be blocked.");
    expect(reminderFromWikitext("{{Infobox keyword\n| reminder = Pay {{1}} to untap {{T}}}}\nMore text.")).toBe("Pay {1} to untap {T}");
  });
});

describe("wiki summary", () => {
  it("adds the Description when the opening only says where a mechanic debuted", () => {
    const extract = "Ward is an evergreen keyword introduced in Strixhaven.\n\n\n== Description ==\nWhenever a permanent with ward becomes the target of a spell an opponent controls, counter it unless they pay.\nMore detail.\n\n== History ==\nOld.";
    expect(summaryFromExtract(extract)).toBe("Ward is an evergreen keyword introduced in Strixhaven.\nWhenever a permanent with ward becomes the target of a spell an opponent controls, counter it unless they pay.");
  });

  it("uses a substantial opening on its own, trimmed to whole sentences", () => {
    const long = `${"Flying is an evasion ability that stops creatures without flying or reach from blocking. ".repeat(8).trim()}\n\n== Rules ==\nIgnored.`;
    const s = summaryFromExtract(long)!;
    expect(s.length).toBeLessThanOrEqual(340);
    expect(s.endsWith("blocking.")).toBe(true);
    expect(s).not.toContain("Ignored");
  });

  it("closes the gaps left by symbols the plain text dropped", () => {
    expect(summaryFromExtract("Creatures with haste can use abilities with the  or  symbol in the cost , even the turn they arrive and so on and so forth for a while longer than two hundred characters to skip the Description.")).toBe(
      "Creatures with haste can use abilities with the or symbol in the cost, even the turn they arrive and so on and so forth for a while longer than two hundred characters to skip the Description.",
    );
    expect(summaryFromExtract("")).toBeUndefined();
  });
});

describe("fetchTermInfo", () => {
  beforeEach(() => clearTermInfoCache());

  const page = (title: string, extra: object) => new Response(JSON.stringify({ query: { pages: [{ title, ...extra }] } }));

  it("asks the MTG Wiki API for the extract and the infobox in one CORS request", () => {
    const url = new URL(termInfoUrl("First strike"));
    expect(url.origin + url.pathname).toBe("https://mtg.wiki/api.php");
    expect(url.searchParams.get("titles")).toBe("First strike");
    expect(url.searchParams.get("prop")).toBe("extracts|revisions");
    expect(url.searchParams.get("rvsection")).toBe("0");
    expect(url.searchParams.get("origin")).toBe("*");
  });

  it("follows redirects, fetches each term once and caches it", async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      return page("Kindred", { extract: "Kindred is a card type that lets noncreature spells have creature types, so they count for tribal synergies.", revisions: [{ slots: { main: { content: "{{Infobox type}}" } } }] });
    };
    const [a, b] = await Promise.all([fetchTermInfo("Tribal", fetchFn), fetchTermInfo("Tribal", fetchFn)]);
    expect(a).toEqual({ title: "Kindred", reminder: undefined, summary: "Kindred is a card type that lets noncreature spells have creature types, so they count for tribal synergies." });
    expect(b).toBe(a);
    expect(await fetchTermInfo("Tribal", fetchFn)).toBe(a);
    expect(urls).toHaveLength(1);
  });

  it("remembers that a term has no page, but retries after a failure", async () => {
    expect(await fetchTermInfo("Battle Cannon", async () => page("Battle Cannon", { missing: true }))).toBeNull();
    expect(cachedTermInfo("Battle Cannon")).toBeNull();

    await expect(fetchTermInfo("Ward", async () => new Response("down", { status: 502 }))).rejects.toThrow("502");
    expect(cachedTermInfo("Ward")).toBeUndefined();
    const info = await fetchTermInfo("Ward", async () => page("Ward", { extract: "Ward is a keyword.", revisions: [{ slots: { main: { content: WARD_WIKITEXT } } }] }));
    expect(info?.reminder).toContain("[cost]");
  });
});
