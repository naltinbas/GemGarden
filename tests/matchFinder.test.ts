import { describe, expect, it } from "vitest";
import { findMatches, hasMatchAt, matchesTouching } from "../src/board/MatchFinder";
import { keys, parseBoard, pos } from "./helpers";

const FILLER = ["a c v j p a", "c v j p a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c v j p a"];

function withRow(row: number, line: string): string[] {
  const rows = [...FILLER];
  rows[row] = line;
  return rows;
}

describe("findMatches straight runs", () => {
  it("finds a horizontal 3", () => {
    const board = parseBoard(withRow(2, "r r r a c v"));
    const groups = findMatches(board);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ orientation: "horizontal", length: 3, containsIntersection: false, color: "ruby" });
    expect(keys(groups[0].cells)).toEqual(["2,0", "2,1", "2,2"]);
    expect(groups[0].intersection).toBeUndefined();
  });

  it("finds a horizontal 4 and 5", () => {
    expect(findMatches(parseBoard(withRow(0, "c r r r r a")))[0]).toMatchObject({ length: 4, orientation: "horizontal" });
    const five = findMatches(parseBoard(withRow(5, "j j j j j p")));
    expect(five).toHaveLength(1);
    expect(five[0]).toMatchObject({ length: 5, orientation: "horizontal", color: "jade" });
    expect(keys(five[0].cells)).toEqual(["5,0", "5,1", "5,2", "5,3", "5,4"]);
  });

  it("finds vertical 3, 4 and 5", () => {
    const three = parseBoard(["r a c v", "r c v j", "r v j p", "a j p a"]);
    const g3 = findMatches(three);
    expect(g3).toHaveLength(1);
    expect(g3[0]).toMatchObject({ orientation: "vertical", length: 3, color: "ruby" });
    expect(keys(g3[0].cells)).toEqual(["0,0", "1,0", "2,0"]);

    const four = parseBoard(["a p c v", "c p v j", "v p j a", "j p a c", "a c v j"]);
    expect(findMatches(four)[0]).toMatchObject({ orientation: "vertical", length: 4, color: "pearl" });

    const five = parseBoard(["a c v", "c v v", "v j v", "j p v", "p a v", "a c j"]);
    const g5 = findMatches(five);
    expect(g5).toHaveLength(1);
    expect(g5[0]).toMatchObject({ orientation: "vertical", length: 5, color: "violet" });
    expect(keys(g5[0].cells)).toEqual(["0,2", "1,2", "2,2", "3,2", "4,2"]);
  });

  it("does not report two-in-a-row or a board without runs", () => {
    expect(findMatches(parseBoard(FILLER))).toEqual([]);
    expect(findMatches(parseBoard(withRow(1, "r r a c v j")))).toEqual([]);
  });

  it("ignores runs broken by holes and empty cells", () => {
    expect(findMatches(parseBoard(withRow(3, "r r # r r j")))).toEqual([]);
    expect(findMatches(parseBoard(withRow(3, "r r . r r j")))).toEqual([]);
  });
});

describe("findMatches shapes", () => {
  it("merges a T into one mixed group with the intersection", () => {
    const board = parseBoard(["r r r j p a", "c r v p a c", "v r p a c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.orientation).toBe("mixed");
    expect(g.containsIntersection).toBe(true);
    expect(g.intersection).toEqual(pos(0, 1));
    expect(g.length).toBe(3);
    expect(keys(g.cells)).toEqual(["0,0", "0,1", "0,2", "1,1", "2,1"]);
  });

  it("merges an L into one group", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "r j p a c v", "r p a c v j", "r r r v j p", "a c v j p a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].orientation).toBe("mixed");
    expect(groups[0].intersection).toEqual(pos(4, 0));
    expect(keys(groups[0].cells)).toEqual(["2,0", "3,0", "4,0", "4,1", "4,2"]);
  });

  it("merges a plus (3 across 3) with the centre as intersection", () => {
    const board = parseBoard(["a c v j p a", "c v j p a c", "v j r a c v", "j r r r v j", "p a r v j p", "a c v j p a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].intersection).toEqual(pos(3, 2));
    expect(groups[0].length).toBe(3);
    expect(keys(groups[0].cells)).toEqual(["2,2", "3,1", "3,2", "3,3", "4,2"]);
  });

  it("merges a large cross (5 across 5) and reports length 5", () => {
    const board = parseBoard(["a c r j p a", "c v r p a c", "r r r r r v", "j p r c v j", "p a r v j p", "a c v j p a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(1);
    expect(groups[0].length).toBe(5);
    expect(groups[0].orientation).toBe("mixed");
    expect(groups[0].intersection).toEqual(pos(2, 2));
    expect(groups[0].cells).toHaveLength(9);
    // Longest run comes first (horizontal wins ties) so a caller can take its middle cell.
    expect(groups[0].cells.slice(0, 5)).toEqual([pos(2, 0), pos(2, 1), pos(2, 2), pos(2, 3), pos(2, 4)]);
  });

  it("keeps two separate same-colored runs as two groups", () => {
    const board = parseBoard(["r r r j p a", "c v j p a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c r r r a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(2);
    expect(keys(groups[0].cells)).toEqual(["0,0", "0,1", "0,2"]);
    expect(keys(groups[1].cells)).toEqual(["5,2", "5,3", "5,4"]);
  });

  it("does not merge touching runs of different colors", () => {
    const board = parseBoard(["r r r a p a", "c v j a a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c v j p a"]);
    const groups = findMatches(board);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.orientation !== "mixed")).toBe(true);
  });

  it("never duplicates a cell across or inside groups", () => {
    const board = parseBoard(["r r r r a c", "r v j p a c", "r j p a c v", "r r r r v j", "p a c v j p", "a c v j p a"]);
    const groups = findMatches(board);
    const all = groups.flatMap((g) => g.cells).map((c) => `${c.row},${c.col}`);
    expect(new Set(all).size).toBe(all.length);
    expect(groups).toHaveLength(1);
    expect(groups[0].length).toBe(4);
    expect(all).toHaveLength(10);
  });
});

describe("findMatches and blockers", () => {
  it("matches through a glass vine", () => {
    const groups = findMatches(parseBoard(withRow(1, "r rV r a c v")));
    expect(groups).toHaveLength(1);
    expect(keys(groups[0].cells)).toEqual(["1,0", "1,1", "1,2"]);
  });

  it("does not match a locked bud, mist, seed or prism", () => {
    expect(findMatches(parseBoard(withRow(1, "r rB r a c v")))).toEqual([]);
    expect(findMatches(parseBoard(withRow(1, "r rM r a c v")))).toEqual([]);
    expect(findMatches(parseBoard(withRow(1, "r S r a c v")))).toEqual([]);
    expect(findMatches(parseBoard(withRow(1, "r @ r a c v")))).toEqual([]);
    expect(findMatches(parseBoard(withRow(1, "S S S a c v")))).toEqual([]);
  });

  it("includes special gems of the right color in a run", () => {
    const groups = findMatches(parseBoard(withRow(1, "r r* r a c v")));
    expect(groups).toHaveLength(1);
    expect(groups[0].cells).toHaveLength(3);
  });
});

describe("hasMatchAt and matchesTouching", () => {
  const board = parseBoard(["r r r j p a", "c v j p a c", "v j p a c v", "j p a c v j", "p a c v j p", "a c r r r a"]);

  it("hasMatchAt reports cells inside a run only", () => {
    expect(hasMatchAt(board, pos(0, 0))).toBe(true);
    expect(hasMatchAt(board, pos(0, 1))).toBe(true);
    expect(hasMatchAt(board, pos(0, 2))).toBe(true);
    expect(hasMatchAt(board, pos(0, 3))).toBe(false);
    expect(hasMatchAt(board, pos(1, 0))).toBe(false);
    expect(hasMatchAt(board, pos(5, 3))).toBe(true);
    expect(hasMatchAt(board, pos(-1, 0))).toBe(false);
  });

  it("hasMatchAt respects bud, mist and vine", () => {
    expect(hasMatchAt(parseBoard(withRow(0, "r rB r a c v")), pos(0, 0))).toBe(false);
    expect(hasMatchAt(parseBoard(withRow(0, "r rM r a c v")), pos(0, 2))).toBe(false);
    expect(hasMatchAt(parseBoard(withRow(0, "r rV r a c v")), pos(0, 2))).toBe(true);
    expect(hasMatchAt(parseBoard(withRow(0, "r rB r a c v")), pos(0, 1))).toBe(false);
  });

  it("matchesTouching filters groups by the given cells", () => {
    expect(matchesTouching(board, [pos(0, 1)])).toHaveLength(1);
    expect(keys(matchesTouching(board, [pos(0, 1)])[0].cells)).toEqual(["0,0", "0,1", "0,2"]);
    expect(matchesTouching(board, [pos(2, 2)])).toEqual([]);
    expect(matchesTouching(board, [pos(0, 2), pos(5, 2)])).toHaveLength(2);
  });

  it("leaves the board untouched", () => {
    const before = board.toString();
    findMatches(board);
    hasMatchAt(board, pos(0, 0));
    matchesTouching(board, [pos(0, 0)]);
    expect(board.toString()).toBe(before);
  });
});
