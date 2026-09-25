// Parses the text a host pastes into "Import cube" into lookup entries.
// Supported: CubeCobra URL/ID, one-name-per-line, "4 Name", "4x Name", Arena "1 Name (SET) 123",
// bracket printings "Name [set-123]", and CubeCobra's CSV export.

export interface ImportEntry {
  name: string;
  count: number;
  set?: string;
  collectorNumber?: string;
  /** Scryfall printing id (CubeCobra JSON gives these directly). */
  id?: string;
  elo?: number;
  foil?: boolean;
}

export type ImportSource =
  | { kind: "cubecobra"; id: string }
  | { kind: "list"; entries: ImportEntry[]; warnings: string[] };

const CUBECOBRA_URL = /cubecobra\.com\/(?:cube\/[a-z]+|c)\/([A-Za-z0-9_-]+)/i;
const CUBECOBRA_PREFIX = /^cubecobra:\s*([A-Za-z0-9_-]+)$/i;

export function parseImport(text: string): ImportSource {
  const trimmed = text.trim();
  const url = trimmed.match(CUBECOBRA_URL);
  if (url && !trimmed.includes("\n")) return { kind: "cubecobra", id: url[1] };
  const prefixed = trimmed.match(CUBECOBRA_PREFIX);
  if (prefixed) return { kind: "cubecobra", id: prefixed[1] };

  const lines = trimmed.split(/\r?\n/);
  if (lines.length > 0 && looksLikeCsvHeader(lines[0])) return parseCsv(lines);
  return parseList(lines);
}

/** "Delver of Secrets // Insectile Aberration" → "Delver of Secrets" (Scryfall collection lookup matches face names only). */
export function frontFaceName(name: string): string {
  const idx = name.indexOf(" // ");
  return (idx >= 0 ? name.slice(0, idx) : name).trim();
}

const SKIP_SECTIONS = new Set(["sideboard", "maybeboard", "maybe", "considering", "tokens"]);
const KEEP_SECTIONS = new Set(["deck", "mainboard", "main", "commander", "companion", "cube"]);

function parseList(lines: string[]): ImportSource {
  const entries: ImportEntry[] = [];
  const warnings: string[] = [];
  let skipping = false;
  let skippedSection = "";
  let skippedCount = 0;

  for (const raw of lines) {
    let line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const header = line.replace(/:$/, "").toLowerCase();
    if (SKIP_SECTIONS.has(header)) {
      skipping = true;
      skippedSection = header;
      continue;
    }
    if (KEEP_SECTIONS.has(header)) {
      skipping = false;
      continue;
    }
    if (header === "about" || /^name\s/i.test(line)) continue; // Arena deck "About / Name X" preamble

    if (/^SB:\s*/i.test(line)) {
      skippedCount++;
      continue;
    }
    if (skipping) {
      skippedCount++;
      continue;
    }

    const entry = parseLine(line);
    if (entry) entries.push(entry);
    else warnings.push(`Could not read line: "${raw.trim()}"`);
  }

  if (skippedCount > 0) {
    warnings.push(`Skipped ${skippedCount} card(s) from ${skippedSection || "sideboard"} sections.`);
  }
  return { kind: "list", entries: mergeDuplicates(entries), warnings };
}

export function parseLine(line: string): ImportEntry | null {
  let rest = line.trim();
  let count = 1;
  const countMatch = rest.match(/^(\d+)\s*x?\s+(.+)$/i);
  if (countMatch) {
    count = Math.max(1, parseInt(countMatch[1], 10));
    rest = countMatch[2];
  }

  let foil = false;
  if (/\s\*F\*$/i.test(rest)) {
    foil = true;
    rest = rest.replace(/\s\*F\*$/i, "");
  }

  let set: string | undefined;
  let collectorNumber: string | undefined;

  // Arena / MTGA: "Lightning Bolt (M10) 146"
  const arena = rest.match(/^(.+?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†-]+))?$/);
  // Bracket printings: "Jackknight [ust-11]", "Lightning Bolt [M10]", "Bolt [m10:146]"
  const bracket = rest.match(/^(.+?)\s+\[([A-Za-z0-9]{2,6})(?:[-:]([A-Za-z0-9★†-]+))?\]$/);
  const printing = arena ?? bracket;
  if (printing) {
    rest = printing[1];
    set = printing[2].toLowerCase();
    collectorNumber = printing[3];
  }

  const name = frontFaceName(rest);
  if (!name) return null;
  return { name, count, set, collectorNumber, ...(foil ? { foil } : {}) };
}

function mergeDuplicates(entries: ImportEntry[]): ImportEntry[] {
  const byKey = new Map<string, ImportEntry>();
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}|${e.set ?? ""}|${e.collectorNumber ?? ""}|${e.id ?? ""}`;
    const existing = byKey.get(key);
    if (existing) existing.count += e.count;
    else byKey.set(key, { ...e });
  }
  return [...byKey.values()];
}

// --- CSV (CubeCobra export) ------------------------------------------------------------------

function looksLikeCsvHeader(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes(",") && /(^|,)\s*"?name"?\s*(,|$)/.test(lower);
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(lines: string[]): ImportSource {
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const nameCol = col("name");
  const setCol = col("set");
  const cnCol = col("collector number");
  const maybeCol = col("maybeboard");
  const entries: ImportEntry[] = [];
  const warnings: string[] = [];
  let maybe = 0;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    if (maybeCol >= 0 && cells[maybeCol]?.toLowerCase() === "true") {
      maybe++;
      continue;
    }
    const name = frontFaceName(cells[nameCol] ?? "");
    if (!name) continue;
    entries.push({
      name,
      count: 1,
      set: setCol >= 0 && cells[setCol] ? cells[setCol].toLowerCase() : undefined,
      collectorNumber: cnCol >= 0 && cells[cnCol] ? cells[cnCol] : undefined,
    });
  }
  if (maybe > 0) warnings.push(`Skipped ${maybe} maybeboard card(s).`);
  return { kind: "list", entries: mergeDuplicates(entries), warnings };
}
