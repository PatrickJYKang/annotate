import { describe, it, expect } from "vitest";
import { parseTeamsheetCSV, parseTeamsheetPlainText } from "./teamsheetParser";

// ---------------------------------------------------------------------------
// parseTeamsheetCSV
// ---------------------------------------------------------------------------

describe("parseTeamsheetCSV", () => {
  it("parses a standard CSV with recognised headers", () => {
    const csv = `Number,Name,Position,Captain,Substitute
1,A. Goalkeeper,GK,yes,no
2,B. Defender,RB,,
10,C. Midfielder,CM,C,
11,D. Forward,LW,,yes`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(4);

    expect(players[0].number).toBe(1);
    expect(players[0].name).toBe("A. Goalkeeper");
    expect(players[0].position).toBe("GK");
    expect(players[0].isCaptain).toBe(true);
    expect(players[0].isSubstitute).toBeUndefined();

    expect(players[2].isCaptain).toBe(true); // "C" is truthy
    expect(players[3].isSubstitute).toBe(true);
  });

  it("handles alternative header aliases (#, Player, Pos)", () => {
    const csv = `#,Player,Pos
1,John Smith,GK
5,Jane Doe,CB`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(2);
    expect(players[0].number).toBe(1);
    expect(players[0].name).toBe("John Smith");
    expect(players[0].position).toBe("GK");
  });

  it("handles TSV (tab-separated)", () => {
    const tsv = `Shirt\tName\tPos
1\tKeeper One\tGK
4\tCentre Back\tCB`;
    const players = parseTeamsheetCSV(tsv);
    expect(players).toHaveLength(2);
    expect(players[0].number).toBe(1);
    expect(players[1].name).toBe("Centre Back");
  });

  it("handles semicolon-separated values", () => {
    const csv = `Number;Name;Position
7;Lucky Seven;RW`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(1);
    expect(players[0].number).toBe(7);
    expect(players[0].name).toBe("Lucky Seven");
  });

  it("falls back to number,name when headers are unrecognised", () => {
    const csv = `Col_A,Col_B
1,Some Player
2,Another Player`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(2);
    expect(players[0].number).toBe(1);
    expect(players[0].name).toBe("Some Player");
    expect(players[0].position).toBeNull();
  });

  it("returns empty array for single-line input (no data rows)", () => {
    expect(parseTeamsheetCSV("Name")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTeamsheetCSV("")).toEqual([]);
  });

  it("skips rows with no name value", () => {
    const csv = `Name,Number
Player One,1
,2
Player Three,3`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(2);
    expect(players[0].name).toBe("Player One");
    expect(players[1].name).toBe("Player Three");
  });

  it("handles extra whitespace in cells", () => {
    const csv = `Number , Name , Position
  7 ,  Padded Name  ,  CM `;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(1);
    expect(players[0].number).toBe(7);
    expect(players[0].name).toBe("Padded Name");
    expect(players[0].position).toBe("CM");
  });

  it("handles unicode names", () => {
    const csv = `#,Name,Pos
10,Müller Günther,AM
7,José María,RW
9,Ødegaard,CM`;
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(3);
    expect(players[0].name).toBe("Müller Günther");
    expect(players[1].name).toBe("José María");
    expect(players[2].name).toBe("Ødegaard");
  });

  it("handles Windows-style line endings (\\r\\n)", () => {
    const csv = "#,Name,Pos\r\n1,Player One,GK\r\n2,Player Two,CB\r\n";
    const players = parseTeamsheetCSV(csv);
    expect(players).toHaveLength(2);
  });

  it("every player gets a unique id", () => {
    const csv = `Name
A
B
C`;
    const players = parseTeamsheetCSV(csv);
    const ids = new Set(players.map((p) => p.id));
    expect(ids.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// parseTeamsheetPlainText
// ---------------------------------------------------------------------------

describe("parseTeamsheetPlainText", () => {
  it("parses '<number> <name>' format", () => {
    const text = `1 A. Goalkeeper
2 B. Defender
10 C. Midfielder`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(3);
    expect(players[0].number).toBe(1);
    expect(players[0].name).toBe("A. Goalkeeper");
    expect(players[2].number).toBe(10);
  });

  it("parses '<number>. <name>' format", () => {
    const text = `1. Keeper
2. Defender
3. Midfielder`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(3);
    expect(players[0].number).toBe(1);
    expect(players[0].name).toBe("Keeper");
  });

  it("parses '#<number> <name>' format", () => {
    const text = `#1 First Player
#22 Second Player`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
    expect(players[0].number).toBe(1);
    expect(players[1].number).toBe(22);
  });

  it("parses '<number> - <name>' format", () => {
    const text = `1 - Keeper
10 - Striker`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
    expect(players[0].name).toBe("Keeper");
    expect(players[1].number).toBe(10);
  });

  it("handles lines with no number (name only)", () => {
    const text = `John Smith
Jane Doe`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
    expect(players[0].number).toBeNull();
    expect(players[0].name).toBe("John Smith");
  });

  it("strips trailing (C) captain marker", () => {
    const text = `1 Captain Player (C)
2 Normal Player`;
    const players = parseTeamsheetPlainText(text);
    expect(players[0].name).toBe("Captain Player");
    expect(players[0].isCaptain).toBe(true);
    expect(players[1].isCaptain).toBeUndefined();
  });

  it("strips trailing position hint like (GK) or [CB]", () => {
    const text = `1 Some Keeper (GK)
2 Some Defender [CB]`;
    const players = parseTeamsheetPlainText(text);
    expect(players[0].name).toBe("Some Keeper");
    expect(players[0].position).toBe("GK");
    expect(players[1].name).toBe("Some Defender");
    expect(players[1].position).toBe("CB");
  });

  it("handles captain marker AND position hint together", () => {
    const text = `10 Leader (C)`;
    const players = parseTeamsheetPlainText(text);
    expect(players[0].name).toBe("Leader");
    expect(players[0].isCaptain).toBe(true);
  });

  it("returns empty array for empty string", () => {
    expect(parseTeamsheetPlainText("")).toEqual([]);
  });

  it("skips blank lines", () => {
    const text = `1 First

2 Second

`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
  });

  it("handles unicode names", () => {
    const text = `10 Müller
7 José García
9 Ødegaard`;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(3);
    expect(players[0].name).toBe("Müller");
    expect(players[1].name).toBe("José García");
  });

  it("handles extra whitespace", () => {
    const text = `  1   Padded Name  
  2.   Another Padded  `;
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
    expect(players[0].name).toBe("Padded Name");
    expect(players[1].name).toBe("Another Padded");
  });

  it("every player gets a unique id", () => {
    const text = `A
B
C`;
    const players = parseTeamsheetPlainText(text);
    const ids = new Set(players.map((p) => p.id));
    expect(ids.size).toBe(3);
  });

  it("handles Windows-style line endings", () => {
    const text = "1 Player One\r\n2 Player Two\r\n";
    const players = parseTeamsheetPlainText(text);
    expect(players).toHaveLength(2);
  });
});
