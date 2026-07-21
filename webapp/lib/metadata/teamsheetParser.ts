import type { PlayerEntry } from "../types/metadata";

function generateId(): string {
  return (globalThis.crypto && "randomUUID" in globalThis.crypto)
    ? (globalThis.crypto as any).randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Header alias maps — flexible matching for CSV/TSV column headers
// ---------------------------------------------------------------------------

const NUMBER_ALIASES = new Set(["number", "#", "shirt", "shirtnumber", "no", "no."]);
const NAME_ALIASES = new Set(["name", "player", "playername"]);
const POSITION_ALIASES = new Set(["position", "pos", "role"]);
const CAPTAIN_ALIASES = new Set(["captain", "capt", "c"]);
const SUBSTITUTE_ALIASES = new Set(["substitute", "sub", "bench"]);

function normaliseHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9#]/g, "");
}

type ColumnRole = "number" | "name" | "position" | "captain" | "substitute" | null;

function classifyHeader(raw: string): ColumnRole {
  const h = normaliseHeader(raw);
  if (NUMBER_ALIASES.has(h)) return "number";
  if (NAME_ALIASES.has(h)) return "name";
  if (POSITION_ALIASES.has(h)) return "position";
  if (CAPTAIN_ALIASES.has(h)) return "captain";
  if (SUBSTITUTE_ALIASES.has(h)) return "substitute";
  return null;
}

// ---------------------------------------------------------------------------
// Boolean-ish value detection
// ---------------------------------------------------------------------------

const TRUTHY = new Set(["yes", "true", "1", "y", "c", "x", "✓"]);

function isTruthy(val: string): boolean {
  return TRUTHY.has(val.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

function detectDelimiter(firstLine: string): string {
  if (firstLine.includes("\t")) return "\t";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  if (semiCount > commaCount) return ";";
  return ",";
}

// ---------------------------------------------------------------------------
// parseTeamsheetCSV
// ---------------------------------------------------------------------------

export function parseTeamsheetCSV(text: string): PlayerEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // need header + at least one row

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter);
  let mapping: ColumnRole[] = headers.map(classifyHeader);

  // Must have at least a name column
  if (!mapping.includes("name")) {
    // Fallback: if there are exactly 2+ columns and none matched, assume
    // first is number, second is name.
    if (headers.length >= 2 && mapping.every((m) => m === null)) {
      mapping = mapping.slice();
      mapping[0] = "number" as ColumnRole;
      mapping[1] = "name" as ColumnRole;
    } else {
      return [];
    }
  }

  const players: PlayerEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(delimiter);
    let name = "";
    let number: number | null = null;
    let position: string | null = null;
    let isCaptain = false;
    let isSubstitute = false;

    for (let c = 0; c < cells.length; c++) {
      const role = mapping[c] ?? null;
      const val = cells[c].trim();
      if (!val) continue;

      switch (role) {
        case "name":
          name = val;
          break;
        case "number": {
          const n = parseInt(val, 10);
          if (!isNaN(n)) number = n;
          break;
        }
        case "position":
          position = val;
          break;
        case "captain":
          isCaptain = isTruthy(val);
          break;
        case "substitute":
          isSubstitute = isTruthy(val);
          break;
      }
    }

    if (!name) continue; // skip rows without a name

    const entry: PlayerEntry = {
      id: generateId(),
      number,
      name,
      position,
    };
    if (isCaptain) entry.isCaptain = true;
    if (isSubstitute) entry.isSubstitute = true;
    players.push(entry);
  }

  return players;
}

// ---------------------------------------------------------------------------
// parseTeamsheetPlainText
// ---------------------------------------------------------------------------

// Matches lines like:
//   1 John Smith
//   1. John Smith
//   #1 John Smith
//   1 - John Smith
//   John Smith          (no number)
const LINE_WITH_NUMBER =
  /^#?\s*(\d{1,3})\s*[.\-–—)]\s*(.+)$/;
const LINE_NUMBER_SPACE =
  /^#?\s*(\d{1,3})\s+(.+)$/;

export function parseTeamsheetPlainText(text: string): PlayerEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const players: PlayerEntry[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    let number: number | null = null;
    let name = "";

    // Try number-with-separator first, then number-with-space
    const m1 = line.match(LINE_WITH_NUMBER);
    if (m1) {
      number = parseInt(m1[1], 10);
      name = m1[2].trim();
    } else {
      const m2 = line.match(LINE_NUMBER_SPACE);
      if (m2) {
        number = parseInt(m2[1], 10);
        name = m2[2].trim();
      } else {
        // No number detected — treat entire line as name
        name = line;
      }
    }

    if (!name) continue;

    // Strip trailing captain marker like "(C)" or "(c)"
    let isCaptain = false;
    const captainMatch = name.match(/\s*\(c\)\s*$/i);
    if (captainMatch) {
      isCaptain = true;
      name = name.slice(0, -captainMatch[0].length).trim();
    }

    // Strip trailing position hint like "(GK)" or "[CB]"
    let position: string | null = null;
    const posMatch = name.match(/\s*[(\[](GK|CB|LB|RB|LWB|RWB|DM|CDM|CM|AM|CAM|LM|RM|LW|RW|CF|ST|FW)[)\]]\s*$/i);
    if (posMatch) {
      position = posMatch[1].toUpperCase();
      name = name.slice(0, -posMatch[0].length).trim();
    }

    const entry: PlayerEntry = {
      id: generateId(),
      number,
      name,
      position,
    };
    if (isCaptain) entry.isCaptain = true;
    players.push(entry);
  }

  return players;
}
