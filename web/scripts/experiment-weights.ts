// Compare window-weight schemes on the same historical games.
//   cd web && npx tsx scripts/experiment-weights.ts
import fs from "node:fs";
import type { BacktestRow } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";

const base = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;

// Weight cells: plain numbers in column D, four in a row (YTD, L3, H/A, Prior).
const weightRows = Object.keys(base.cells)
  .filter((a) => /^D\d+$/.test(a) && /^\d+(\.\d+)?$/.test(base.cells[a].trim()))
  .map((a) => Number(a.slice(1)))
  .sort((x, y) => x - y);
const starts = weightRows.filter((r) => !weightRows.includes(r - 1));

function withWeights(w: (string | number)[], renormalize = false): SheetModel {
  const m: SheetModel = JSON.parse(JSON.stringify(base));
  for (const s of starts) for (let i = 0; i < 4; i++) m.cells[`D${s + i}`] = String(w[i]);
  if (renormalize) {
    for (const [a, f] of Object.entries(m.cells)) {
      const mm = /^=SUMPRODUCT\((\$D\$\d+:\$D\$\d+),([A-Z]+\d+:[A-Z]+\d+)\)\/100$/.exec(f);
      if (mm) m.cells[a] = `=SUMPRODUCT(${mm[1]},${mm[2]})/SUMPRODUCT(${mm[1]},ISNUMBER(${mm[2]}))`;
    }
  }
  return m;
}

// Prior-season share shrinks as games are played: k / (k + n), n = avg games of the two teams.
const n = "AVERAGE([Home YTD Games],[Away YTD Games])";
const dyn = (k: number, split = [0.6, 0.15, 0.25]) => [
  ...split.map((x) => `=${100 * x}*(1-${k}/(${k}+${n}))`),
  `=100*${k}/(${k}+${n})`,
];

const variants: [string, SheetModel][] = [
  ["current sheet (10/0/0/90)", base],
  ["original sheet 40/25/30/5", withWeights([40, 25, 30, 5])],
  ["40/25/30/5 + skip missing", withWeights([40, 25, 30, 5], true)],
  ["60/15/20/5 + skip missing", withWeights([60, 15, 20, 5], true)],
  ["dynamic k=10 + skip missing", withWeights(dyn(10), true)],
  ["dynamic k=20 + skip missing", withWeights(dyn(20), true)],
  ["dynamic k=20, YTD-heavy", withWeights(dyn(20, [0.8, 0.1, 0.1]), true)],
];

const days = loadInputs();
const lines = loadLines();
const labels = loadLabels();
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function summarize(rows: BacktestRow[]) {
  const margin = (r: BacktestRow) => r.proj_home - r.proj_away;
  const actual = (r: BacktestRow) => r.actual_home - r.actual_away;
  const wl = rows.filter((r) => r.line_spread != null && r.line_total != null);
  const ats = wl.map((r) => { const e = margin(r) + r.line_spread!; const c = actual(r) + r.line_spread!; return e && c ? (Math.sign(e) === Math.sign(c) ? 1 : 0) : null; }).filter((x): x is 0 | 1 => x != null);
  const ou = wl.map((r) => { const e = r.proj_home + r.proj_away - r.line_total!; const o = r.actual_home + r.actual_away - r.line_total!; return e && o ? (Math.sign(e) === Math.sign(o) ? 1 : 0) : null; }).filter((x): x is 0 | 1 => x != null);
  const win = rows.filter((r) => margin(r) !== 0).map((r) => (Math.sign(margin(r)) === Math.sign(actual(r)) ? 1 : 0));
  const part = (months: string[]) => mean(rows.filter((r) => months.includes(r.date.slice(5, 7))).map((r) => Math.abs(actual(r) - margin(r))));
  return {
    marginMAE: mean(rows.map((r) => Math.abs(actual(r) - margin(r)))),
    totalMAE: mean(rows.map((r) => Math.abs(r.actual_home + r.actual_away - r.proj_home - r.proj_away))),
    early: part(["10", "11", "12"]), mid: part(["01", "02"]), late: part(["03", "04", "05", "06"]),
    ats: mean(ats), ou: mean(ou), win: mean(win), n: rows.length,
  };
}

console.log("variant".padEnd(30), "marginMAE  Oct-Dec  Jan-Feb  Mar-Jun  totalMAE   winner   ATS     O/U");
for (const [name, m] of variants) {
  const s = summarize(runModel(m, days, lines, labels).filter((r) => r.season < 2027));
  console.log(name.padEnd(30), s.marginMAE.toFixed(2).padStart(9), s.early.toFixed(2).padStart(8), s.mid.toFixed(2).padStart(8), s.late.toFixed(2).padStart(8), s.totalMAE.toFixed(2).padStart(9), pct(s.win).padStart(8), pct(s.ats).padStart(7), pct(s.ou).padStart(7));
}
const wl = runModel(base, days, lines, labels).filter((r) => r.season < 2027 && r.line_spread != null && r.line_total != null);
console.log("market (closing line)".padEnd(30), mean(wl.map((r) => Math.abs(r.actual_home - r.actual_away + r.line_spread!))).toFixed(2).padStart(9), " ".repeat(27), mean(wl.map((r) => Math.abs(r.actual_home + r.actual_away - r.line_total!))).toFixed(2).padStart(9));
