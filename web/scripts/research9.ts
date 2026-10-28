// Round 9: late-season motivation. The Motivation section (tanking penalty for teams
// seeded 11+ with 65+ games) tested end to end through the sheet.
//   cd web && npx tsx scripts/research9.ts
//
// The penalty is picked on two seasons (margin error, all games) and scored on the third.
// Reported against closing lines (lines.csv) and opening lines (open_lines.csv, from
// pipeline/open_lines.py), by part of the season.

import fs from "node:fs";
import path from "node:path";
import type { SheetModel } from "../lib/sheet";
import { scoreGame, slateSource } from "../lib/sheet";
import { addMotivation } from "../lib/sheetTemplate";
import { CACHE, loadInputs, loadLabels, loadLines, runModel, type BacktestRow } from "./backtest-core";

const published = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = loadInputs();
const lines = loadLines();
const labels = [...new Set([...loadLabels(), "Rest Days", "SOS", "Conference Seed"])];
const SEASONS = [2024, 2025, 2026];
const PENALTIES = [0, 3, 4, 4.5, 5, 6, 7];

const open = new Map<string, number>();
const [head, ...body] = fs.readFileSync(path.join(CACHE, "open_lines.csv"), "utf8").trim().split(/\r?\n/);
const oc = head.split(",");
for (const l of body) {
  const v = l.split(",");
  const s = v[oc.indexOf("spread_open")];
  if (s !== "") open.set(v[oc.indexOf("game_id")], -Number(s));
}

const regEnd = new Map<number, string>();
for (const d of days) if (d.games.length >= 10 && d.date > (regEnd.get(d.season) ?? "")) regEnd.set(d.season, d.date);
const phase = (r: BacktestRow) => {
  const end = regEnd.get(r.season)!;
  if (r.date > end) return "post";
  return (Date.parse(end) - Date.parse(r.date)) / 864e5 < 15 ? "late" : "reg";
};

// Which side (if any) the sheet flags as tanking, from the Motivation rows.
const withSection = (tank: number) => {
  const m = JSON.parse(JSON.stringify(published)) as SheetModel;
  return { m, row: addMotivation(m, { tank, seedFrom: 11, minGames: 65 }) };
};
const flagRow = withSection(0).row - 4;
const flags = new Map<string, number>(); // +1 home tanking, -1 away
{
  const { m } = withSection(0);
  for (const d of days) for (const g of d.games) {
    const game = { ...g, tip_time: "", status: "", neutral: false, home: { ...g.home, name: g.home.abbr, color: null, logo: null }, away: { ...g.away, name: g.away.abbr, color: null, logo: null } };
    const r = scoreGame(m, slateSource(d, game), labels);
    flags.set(g.game_id, Number(r.get(`B${flagRow}`).value ?? 0) - Number(r.get(`C${flagRow}`).value ?? 0));
  }
}

const runs = new Map<number, BacktestRow[]>();
for (const p of PENALTIES) runs.set(p, runModel(withSection(p).m, days, lines, labels).filter((r) => SEASONS.includes(r.season)));
const base = runs.get(0)!;
const actual = base.map((r) => r.actual_home - r.actual_away);
const close = base.map((r) => (r.line_spread == null ? NaN : -r.line_spread));
const opening = base.map((r) => open.get(r.game_id) ?? NaN);
const ph = base.map(phase);
const pred = (p: number) => runs.get(p)!.map((r) => r.proj_home - r.proj_away);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const mae = (q: number[], idx: number[]) => mean(idx.map((i) => Math.abs(actual[i] - q[i])));
const idxOf = (f: (i: number) => boolean) => base.map((_, i) => i).filter(f);

const held = new Array<number>(base.length).fill(NaN);
const picks: string[] = [];
for (const s of SEASONS) {
  const tr = idxOf((i) => base[i].season !== s);
  const best = PENALTIES.reduce((a, b) => (mae(pred(b), tr) < mae(pred(a), tr) ? b : a));
  picks.push(`${s}: ${best}`);
  const q = pred(best);
  idxOf((i) => base[i].season === s).forEach((i) => (held[i] = q[i]));
}

const follow = (q: number[], line: number[], idx: number[], k: number) => {
  const xs = idx.filter((i) => Number.isFinite(line[i]) && Math.abs(q[i] - line[i]) >= k && actual[i] !== line[i]);
  const hit = xs.filter((i) => Math.sign(q[i] - line[i]) === Math.sign(actual[i] - line[i])).length;
  return `${((100 * hit) / xs.length).toFixed(1)}% of ${xs.length}`;
};
function report(name: string, q: number[]) {
  console.log(`\n${name}`);
  for (const [label, f] of [["Oct-Mar", (i: number) => ph[i] === "reg"], ["last 15 days", (i: number) => ph[i] === "late"], ["playoffs", (i: number) => ph[i] === "post"], ["all", () => true]] as const) {
    const idx = idxOf(f).filter((i) => Number.isFinite(close[i]));
    const per = SEASONS.map((s) => mae(q, idx.filter((i) => base[i].season === s)).toFixed(2)).join(" ");
    console.log(`  ${label.padEnd(13)} n=${String(idx.length).padStart(4)}  MAE ${mae(q, idx).toFixed(3)} [${per}]  close ${mae(close, idx).toFixed(3)}` +
      `  | vs close 3+ ${follow(q, close, idx, 3)}  5+ ${follow(q, close, idx, 5)} | vs open 3+ ${follow(q, opening, idx, 3)}  5+ ${follow(q, opening, idx, 5)}`);
  }
}
report("Sheet without Motivation", pred(0));
report("Motivation, penalty picked on the other two seasons", held);
console.log("\nPicked per held-out season: " + picks.join(", "));

// Betting against the flagged team (one team flagged), per season.
console.log("\nBet against the tanking team (one side flagged):");
for (const [name, line] of [["closing", close], ["opening", opening]] as const) {
  const out = SEASONS.map((s) => {
    const xs = idxOf((i) => base[i].season === s && Math.abs(flags.get(base[i].game_id) ?? 0) === 1 && Number.isFinite(line[i]) && actual[i] !== line[i]);
    const won = xs.filter((i) => Math.sign(actual[i] - line[i]) === -(flags.get(base[i].game_id) ?? 0)).length;
    return { s, won, n: xs.length };
  });
  const W = out.reduce((a, o) => a + o.won, 0), N = out.reduce((a, o) => a + o.n, 0);
  console.log(`  vs ${name}: ${((100 * W) / N).toFixed(1)}% of ${N}  [${out.map((o) => `${o.s}: ${((100 * o.won) / o.n).toFixed(0)}% of ${o.n}`).join(", ")}]`);
}
