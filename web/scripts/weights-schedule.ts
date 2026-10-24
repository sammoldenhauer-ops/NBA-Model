// Weight schedule in the Model sheet: window weights that change with how many games
// the two teams have played. Adds (once) a table at O7:S17 and points every section's
// Weight cells at it:
//   O3 "Avg games played"   O4 =AVERAGE([Home YTD Games],[Away YTD Games])
//   O7..S7 header           O8:S17 rows: games-played lower bound | YTD | L3 | H/A | Prior
//   D cells                 =VLOOKUP($O$4,$O$8:$S$17,<2..5>,TRUE)
// Weighted rows divide by the weights of the windows that have data, so a team with
// no away games yet isn't dragged toward zero.

import type { SheetModel } from "../lib/sheet";

export const STAGES = [0, 1, 3, 6, 10, 15, 20, 30, 45, 60]; // avg games played (lower bound)
export const SCHEDULE_FIRST_ROW = 8;
export type Weights = [number, number, number, number]; // YTD, L3, H/A, Prior

const LOOKUP = `$O$${SCHEDULE_FIRST_ROW}:$S$${SCHEDULE_FIRST_ROW + STAGES.length - 1}`;

// Weight cells: column D rows that hold a weight (a number or a schedule lookup).
export function weightBlocks(m: SheetModel): number[] {
  const rows = Object.keys(m.cells)
    .filter((a) => /^D\d+$/.test(a) && (/^\d+(\.\d+)?$/.test(m.cells[a].trim()) || m.cells[a].includes("VLOOKUP")))
    .map((a) => Number(a.slice(1)))
    .sort((x, y) => x - y);
  return rows.filter((r) => !rows.includes(r - 1));
}

export function prepareSchedule(input: SheetModel, initial: Weights[]): SheetModel {
  const m: SheetModel = JSON.parse(JSON.stringify(input));
  m.cols = Math.max(m.cols, 20);
  m.widths = { ...m.widths, O: m.widths.O ?? 120 };
  m.cells.O3 = "Avg games played";
  m.cells.O4 = "=AVERAGE([Home YTD Games],[Away YTD Games])";
  m.formats.O4 = "dec1";
  ["Games played ≥", "YTD", "L3", "H/A", "Prior"].forEach((h, i) => (m.cells[`${"OPQRS"[i]}7`] = h));
  if (!m.cells[`O${SCHEDULE_FIRST_ROW}`]) setSchedule(m, initial);
  for (const s of weightBlocks(m)) {
    for (let i = 0; i < 4; i++) {
      m.cells[`D${s + i}`] = `=VLOOKUP($O$4,${LOOKUP},${i + 2},TRUE)`;
      m.formats[`D${s + i}`] = "int";
    }
  }
  // Weighted = SUMPRODUCT(weights, values) / (sum of weights for windows with data).
  for (const [a, f] of Object.entries(m.cells)) {
    const mm = /^=SUMPRODUCT\((\$D\$\d+:\$D\$\d+),([A-Z]+\d+:[A-Z]+\d+)\)\/100$/.exec(f);
    if (mm) m.cells[a] = `=SUMPRODUCT(${mm[1]},${mm[2]})/SUMPRODUCT(${mm[1]},ISNUMBER(${mm[2]}))`;
  }
  return m;
}

export function setSchedule(m: SheetModel, table: Weights[]) {
  STAGES.forEach((g, i) => {
    const r = SCHEDULE_FIRST_ROW + i;
    m.cells[`O${r}`] = String(g);
    table[i].forEach((w, j) => {
      m.cells[`${"PQRS"[j]}${r}`] = String(w);
      m.formats[`${"PQRS"[j]}${r}`] = "int";
    });
  });
}

export const stageOf = (avgGames: number) => {
  let s = 0;
  STAGES.forEach((g, i) => (avgGames >= g ? (s = i) : null));
  return s;
};
