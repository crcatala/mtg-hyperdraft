import { describe, expect, it } from "vitest";
import { cleanEmoteText, EMOTE_TEXT_MAX, emoteTextLength, tidyEmoteText } from "../src/shared/emoteText";

describe("cleanEmoteText (a player's own emote line, cleaned the same by client and room)", () => {
  it("squeezes every run of whitespace, line breaks, tabs and Unicode spaces into one space, trimmed", () => {
    expect(cleanEmoteText("  Get   wrecked  ")).toBe("Get wrecked");
    expect(cleanEmoteText("line one\r\nline two\n\n\tthree")).toBe("line one line two three");
    expect(cleanEmoteText("a b c　d e f g\u0085h\vi\fj")).toBe("a b c d e f g h i j");
  });

  it("strips control characters and the invisible ones that hide or reorder text", () => {
    expect(cleanEmoteText("a\u0000b\u0007c\u001Bd\u007Fe\u0090f")).toBe("abcdef");
    // Zero-width spaces and joiners, LRM/RLM, bidi embeddings and overrides, isolates, word joiner, BOM, soft hyphen.
    for (const ch of ["​", "‌", "‍", "‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁠", "⁦", "⁧", "⁨", "⁩", "﻿", "­", "؜"]) {
      expect(cleanEmoteText(`ab${ch}cd`), `U+${ch.codePointAt(0)!.toString(16)}`).toBe("abcd");
    }
    // Tag characters (invisible "ASCII smuggling") and lone surrogates too.
    expect(cleanEmoteText("hi\u{E0041}\u{E0042}")).toBe("hi");
    expect(cleanEmoteText("a\uD800b\uDFFFc")).toBe("abc");
    // An override can't flip what follows: "gnp.exe" stays in reading order.
    expect(cleanEmoteText("photo‮gnp.exe")).toBe("photognp.exe");
  });

  it("keeps emoji whole: joined sequences, skin tones, variation selectors and accents", () => {
    for (const s of ["👨‍👩‍👧", "❤️‍🔥", "👍🏽", "🏳️‍🌈", "é", "GG 🐸"]) expect(cleanEmoteText(s)).toBe(s);
    // A joiner with no emoji on both sides is just hidden padding.
    expect(cleanEmoteText("👍‍")).toBe("👍");
    expect(cleanEmoteText("a‍👍")).toBe("a👍");
  });

  it("is null when nothing is left, or when the cleaned line is longer than EMOTE_TEXT_MAX", () => {
    for (const s of ["", " ", "\n\t\r", "​‮﻿", "\u0000"]) expect(cleanEmoteText(s)).toBeNull();
    expect(EMOTE_TEXT_MAX).toBe(60);
    expect(cleanEmoteText("x".repeat(EMOTE_TEXT_MAX))).toBe("x".repeat(EMOTE_TEXT_MAX));
    expect(cleanEmoteText("x".repeat(EMOTE_TEXT_MAX + 1))).toBeNull();
    // The limit is on the cleaned line: padding around it doesn't count, and an emoji counts once.
    expect(cleanEmoteText(`   ${"x".repeat(EMOTE_TEXT_MAX)}\n\n`)).toBe("x".repeat(EMOTE_TEXT_MAX));
    expect(cleanEmoteText("🐸".repeat(EMOTE_TEXT_MAX))).toBe("🐸".repeat(EMOTE_TEXT_MAX));
    expect(emoteTextLength("🐸🐸")).toBe(2);
  });

  it("leaves markup exactly as typed: no escaping (React escapes it when it renders)", () => {
    expect(cleanEmoteText("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
    expect(cleanEmoteText('<script>alert("hi")</script> &amp; \'q\'')).toBe('<script>alert("hi")</script> &amp; \'q\'');
  });

  it("tidyEmoteText is the same cleaning without the verdict (what the editor's counter measures)", () => {
    expect(tidyEmoteText("  ​hi \n there ")).toBe("hi there");
    expect(tidyEmoteText(" \n ")).toBe("");
    expect(tidyEmoteText("x".repeat(80))).toHaveLength(80);
  });
});
