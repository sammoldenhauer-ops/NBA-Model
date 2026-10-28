// Round 8: the Schedule, rest & rating section, tested end to end through the sheet.
//   cd web && npx tsx scripts/research8.ts
//
// Every combination of the section's settings is run through the real Model sheet on
// every historical game. Settings are picked on two seasons (margin error, excluding
// the last 15 days of the regular season, when rest/tanking decisions swamp the stats)
// and scored on the third, so the picking step itself is tested on held-out games.

import fs from "node:fs";
import path from "node:path";
import type { SheetModel } from "../lib/sheet";
import { addScheduleRating, type MarginParams } from "../lib/sheetTemplate";
import { CACHE, loadInputs, loadLabels, loadLines, runModel, type BacktestRow } from "./backtest-core";

const published = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = loadInputs();
const lines = loadLines();
const labels = [...new Set([...loadLabels(), "Rest Days", "SOS"])];
const SEASONS = [2024, 2025, 2026];

// Last regular-season date: the last date with 10+ games.
const regEnd = new Map<number, string>();
for (const d of days) if (d.games.length >= 10 && d.date > (regEnd.get(d.season) ?? "")) regEnd.set(d.season, d.date);
const phase = (r: BacktestRow) => {
  const end = regEnd.get(r.season)!;
  if (r.date > end) return "post";
  return (Date.parse(end) - Date.parse(r.date)) / 864e5 < 15 ? "late" : "reg";
};

type Row = BacktestRow & { phase: string };
const run = (m: SheetModel): Row[] => runModel(m, days, lines, labels).filter((r) => SEASONS.includes(r.season)).map((r) => ({ ...r, phase: phase(r) }));

const grid: MarginParams[] = [];
for (const homeCourt of [1.5, 2, 2.5]) for (const wStat of [0.2, 0.3, 0.4]) for (const wPlayer of [0.25, 0.35, 0.45])
  for (const wRating of [0.4, 0.6, 0.8]) for (const b2b of [1.5, 2, 2.5]) grid.push({ homeCourt, wStat, wPlayer, wRating, b2b, shrink: 10 });

// Per combination: margin errors by game, cached so reruns are instant.
const CACHE_FILE = path.join(CACHE, "research8-cache.json");
const inputsStamp = fs.statSync(path.join(CACHE, "inputs_2026.ndjson.gz")).mtimeMs;
let cache: { stamp: number; base: string; runs: Record<string, number[]> } = { stamp: inputsStamp, base: "", runs: {} };
const baseKey = JSON.stringify(published.cells).length + ":" + published.cells.B4;
if (fs.existsSync(CACHE_FILE)) {
  const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  if (c.stamp === inputsStamp && c.base === baseKey) cache = c;
}
cache.base = baseKey;

const baseRows = run(published);
const ids = baseRows.map((r) => r.game_id);
const margin = (r: BacktestRow) => r.proj_home - r.proj_away;
const t0 = Date.now();
grid.forEach((p, i) => {
  const key = JSON.stringify(p);
  if (cache.runs[key]) return;
  const m = JSON.parse(JSON.stringify(published)) as SheetModel;
  addScheduleRating(m, p);
  const rows = new Map(run(m).map((r) => [r.game_id, margin(r)]));
  cache.runs[key] = ids.map((id) => rows.get(id) ?? NaN);
  if (i % 20 === 0) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
    console.log(`  ${i + 1}/${grid.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
});
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));

const actual = baseRows.map((r) => r.actual_home - r.actual_away);
const book = baseRows.map((r) => (r.line_spread == null ? NaN : -r.line_spread));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const mae = (pred: number[], idx: number[]) => mean(idx.map((i) => Math.abs(actual[i] - pred[i])));
const idxOf = (f: (r: Row) => boolean) => baseRows.map((r, i) => (f(r) ? i : -1)).filter((i) => i >= 0);

// Leave one season out: pick on two seasons, predict the third.
const held = new Array<number>(baseRows.length).fill(NaN);
const picks: string[] = [];
for (const s of SEASONS) {
  const tr = idxOf((r) => r.season !== s && r.phase !== "late");
  let best = "", bestErr = Infinity;
  for (const p of grid) {
    const k = JSON.stringify(p), e = mae(cache.runs[k], tr);
    if (e < bestErr) [best, bestErr] = [k, e];
  }
  picks.push(`${s}: ${best}`);
  idxOf((r) => r.season === s).forEach((i) => (held[i] = cache.runs[best][i]));
}
let allBest = "", allErr = Infinity;
for (const p of grid) {
  const k = JSON.stringify(p), e = mae(cache.runs[k], idxOf((r) => r.phase !== "late"));
  if (e < allErr) [allBest, allErr] = [k, e];
}

function report(name: string, pred: number[]) {
  console.log(`\n${name}`);
  for (const [label, f] of [["Oct-Mar", (r: Row) => r.phase === "reg"], ["last 15 days", (r: Row) => r.phase === "late"], ["playoffs", (r: Row) => r.phase === "post"], ["all", () => true]] as const) {
    const idx = idxOf(f).filter((i) => Number.isFinite(book[i]) && Number.isFinite(pred[i]));
    const per = SEASONS.map((s) => mae(pred, idx.filter((i) => baseRows[i].season === s)).toFixed(2)).join(" ");
    // Following the model against the book at 3+ / 5+ point disagreements.
    const follow = (k: number) => {
      const xs = idx.filter((i) => Math.abs(pred[i] - book[i]) >= k && actual[i] !== book[i]);
      const hit = xs.filter((i) => Math.sign(pred[i] - book[i]) === Math.sign(actual[i] - book[i])).length;
      return `${((100 * hit) / xs.length).toFixed(1)}% of ${xs.length}`;
    };
    // Regression slope of result on prediction (1 = margins the right width).
    const mp = mean(idx.map((i) => pred[i])), ma = mean(idx.map((i) => actual[i]));
    const slope = idx.reduce((s, i) => s + (pred[i] - mp) * (actual[i] - ma), 0) / idx.reduce((s, i) => s + (pred[i] - mp) ** 2, 0);
    console.log(`  ${label.padEnd(13)} n=${String(idx.length).padStart(4)}  MAE ${mae(pred, idx).toFixed(3)} [${per}]  book ${mae(book, idx).toFixed(3)}  slope ${slope.toFixed(3)}  follow 3+ ${follow(3)}  5+ ${follow(5)}`);
  }
}
report("Current sheet", baseRows.map(margin));
report("Schedule section, settings picked on the other two seasons", held);
report(`Schedule section, best on all three seasons (in-sample) ${allBest}`, cache.runs[allBest]);
console.log("\nPicked per held-out season:\n  " + picks.join("\n  "));
