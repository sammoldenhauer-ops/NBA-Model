// Find the best window weights for each stage of the season, by backtest.
//   cd web && npx tsx scripts/tune-weights.ts          report only
//   cd web && npx tsx scripts/tune-weights.ts --write  also update model.json + weights report
//
// For every stage (avg games played by the two teams), every YTD/L3/H/A/Prior
// combination (step 10, then step 5 around the best) is scored on all historical
// games at that stage: mean |margin error| + mean |total error|, using the Model
// sheet's own formulas. Validation is leave-one-season-out: weights picked on two
// seasons are scored on the third.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BacktestRow } from "./backtest-core";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";
import { prepareSchedule, setSchedule, stageOf, STAGES, type Weights } from "./weights-schedule";

const write = process.argv.includes("--write");
const published = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const base = prepareSchedule(published, STAGES.map(() => [10, 0, 0, 90] as Weights));

const days = loadInputs();
const lines = loadLines();
const labels = loadLabels();

const err = (r: BacktestRow) =>
  Math.abs(r.actual_home - r.actual_away - (r.proj_home - r.proj_away)) +
  Math.abs(r.actual_home + r.actual_away - (r.proj_home + r.proj_away));
const avgGames = (r: BacktestRow) => (r.home_games + r.away_games) / 2;

// errors[combo][stage][season] = { sum, n }
type Acc = Map<number, { sum: number; n: number }>[];
const results = new Map<string, Acc>();
// Evaluated combinations are cached per base sheet, so re-running the selection is instant.
const CACHE_FILE = path.join("..", "pipeline", "cache", "tune-cache.json");
const baseHash = crypto.createHash("sha1").update(JSON.stringify(base) + JSON.stringify(days.map((d) => [d.date, d.games.length]))).digest("hex");
type Cached = { hash: string; results: Record<string, [number, number, number, number][]> }; // [stage, season, sum, n]
if (fs.existsSync(CACHE_FILE)) {
  const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as Cached;
  if (c.hash === baseHash) {
    for (const [k, list] of Object.entries(c.results)) {
      const acc: Acc = STAGES.map(() => new Map());
      for (const [st, season, sum, n] of list) acc[st].set(season, { sum, n });
      results.set(k, acc);
    }
    console.log(`Loaded ${results.size} cached combinations`);
  }
}
const saveCache = () => {
  const out: Cached = { hash: baseHash, results: {} };
  for (const [k, acc] of results) out.results[k] = acc.flatMap((m, st) => [...m.entries()].map(([season, a]) => [st, season, a.sum, a.n] as [number, number, number, number]));
  fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
};
const seasons = [...new Set(days.map((d) => d.season))].filter((s) => s < Math.max(...days.map((d) => d.season))).sort();
const histDays = days.filter((d) => seasons.includes(d.season));

function score(w: Weights) {
  const key = w.join("/");
  if (results.has(key)) return results.get(key)!;
  const m: SheetModel = JSON.parse(JSON.stringify(base));
  setSchedule(m, STAGES.map(() => w));
  const acc: Acc = STAGES.map(() => new Map());
  for (const r of runModel(m, histDays, lines, labels)) {
    const s = acc[stageOf(avgGames(r))];
    const a = s.get(r.season) ?? { sum: 0, n: 0 };
    a.sum += err(r);
    a.n++;
    s.set(r.season, a);
  }
  results.set(key, acc);
  return acc;
}

const combos = (step: number): Weights[] => {
  const out: Weights[] = [];
  for (let a = 0; a <= 100; a += step) for (let b = 0; a + b <= 100; b += step) for (let c = 0; a + b + c <= 100; c += step) out.push([a, b, c, 100 - a - b - c]);
  return out;
};

const meanErr = (acc: Acc, stage: number, use: number[]) => {
  let sum = 0, n = 0;
  for (const s of use) {
    const a = acc[stage].get(s);
    if (a) { sum += a.sum; n += a.n; }
  }
  return n ? sum / n : Infinity;
};

const t0 = Date.now();
const coarse = combos(10);
coarse.forEach((w, i) => {
  score(w);
  if (i % 40 === 0) console.log(`coarse ${i}/${coarse.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
});

// Refine: step-5 neighbours of the best few coarse combos for each stage.
const neighbours = (w: Weights): Weights[] => {
  const out: Weights[] = [];
  for (const d of [[5, -5, 0, 0], [-5, 5, 0, 0], [5, 0, -5, 0], [-5, 0, 5, 0], [5, 0, 0, -5], [-5, 0, 0, 5], [0, 5, -5, 0], [0, -5, 5, 0], [0, 5, 0, -5], [0, -5, 0, 5], [0, 0, 5, -5], [0, 0, -5, 5]]) {
    const x = w.map((v, i) => v + d[i]) as Weights;
    if (x.every((v) => v >= 0)) out.push(x);
  }
  return out;
};
const ranked = (stage: number, use: number[]) =>
  [...results.entries()].map(([k, acc]) => ({ w: k.split("/").map(Number) as Weights, e: meanErr(acc, stage, use) })).sort((a, b) => a.e - b.e);
const refine = new Set<string>();
STAGES.forEach((_, st) => ranked(st, seasons).slice(0, 3).forEach(({ w }) => neighbours(w).forEach((x) => refine.add(x.join("/")))));
[...refine].forEach((k, i) => {
  score(k.split("/").map(Number) as Weights);
  if (i % 40 === 0) console.log(`refine ${i}/${refine.size}`);
});

saveCache();

// ---- selection ------------------------------------------------------------------
// Each stage's pick must also hold up at the neighbouring stages (half weight), which
// keeps the schedule from chasing noise in small stages. The opening stages keep the
// 10/0/0/90 starting point unless something beats it.
const current: Weights = [10, 0, 0, 90];
const smoothErr = (acc: Acc, st: number, use: number[]) => {
  let sum = 0, n = 0;
  for (const [s2, wt] of [[st - 1, 0.5], [st, 1], [st + 1, 0.5]] as [number, number][]) {
    if (s2 < 0 || s2 >= STAGES.length) continue;
    for (const season of use) {
      const a = acc[s2].get(season);
      if (a) { sum += wt * a.sum; n += wt * a.n; }
    }
  }
  return n ? sum / n : Infinity;
};
const best = (stage: number, use: number[]) => {
  const list = [...results.entries()]
    .map(([k, acc]) => ({ w: k.split("/").map(Number) as Weights, e: smoothErr(acc, stage, use) }))
    .sort((a, b) => a.e - b.e);
  return list[0];
};

// ---- validation: leave one season out ------------------------------------------
const fixedBest = (use: number[]) =>
  [...results.entries()]
    .map(([k, acc]) => {
      let sum = 0, n = 0;
      STAGES.forEach((_, st) => use.forEach((s) => { const a = acc[st].get(s); if (a) { sum += a.sum; n += a.n; } }));
      return { w: k.split("/").map(Number) as Weights, e: sum / n };
    })
    .sort((a, b) => a.e - b.e)[0].w;

type StageRow = { stage: string; games: number; scheduled: number; fixed: number; current: number };
const validation: StageRow[] = STAGES.map((g, st) => ({ stage: `${g}${STAGES[st + 1] ? `–${STAGES[st + 1] - 0.5}` : "+"}`, games: 0, scheduled: 0, fixed: 0, current: 0 }));
for (const held of seasons) {
  const train = seasons.filter((s) => s !== held);
  const fw = fixedBest(train);
  STAGES.forEach((_, st) => {
    const a = results.get(best(st, train).w.join("/"))![st].get(held);
    if (!a) return;
    const f = results.get(fw.join("/"))![st].get(held)!;
    const c = results.get(current.join("/"))![st].get(held)!;
    const v = validation[st];
    v.games += a.n;
    v.scheduled += a.sum;
    v.fixed += f.sum;
    v.current += c.sum;
  });
}

// ---- final schedule: fit on all seasons ------------------------------------------
const schedule = STAGES.map((_, st) => best(st, seasons).w);
const fixedAll = fixedBest(seasons);

const fmt = (x: number) => x.toFixed(2).padStart(7);
console.log(`\nSearched ${results.size} weight combinations in ${Math.round((Date.now() - t0) / 1000)}s on ${seasons.join(", ")}.`);
console.log("Error = mean |margin miss| + mean |total miss| (points), held-out seasons only:\n");
console.log("avg games  ~week   games   schedule   best-fixed  10/0/0/90   chosen weights (YTD/L3/H/A/Prior)");
let tot = { g: 0, s: 0, f: 0, c: 0 };
validation.forEach((v, st) => {
  tot = { g: tot.g + v.games, s: tot.s + v.scheduled, f: tot.f + v.fixed, c: tot.c + v.current };
  const wk = `wk ${Math.floor(STAGES[st] / 3.5) + 1}`;
  console.log(`${v.stage.padEnd(9)}  ${wk.padEnd(6)} ${String(v.games).padStart(6)}  ${fmt(v.scheduled / v.games)}    ${fmt(v.fixed / v.games)}   ${fmt(v.current / v.games)}    ${schedule[st].join("/")}`);
});
console.log(`${"all".padEnd(9)}  ${"".padEnd(6)} ${String(tot.g).padStart(6)}  ${fmt(tot.s / tot.g)}    ${fmt(tot.f / tot.g)}   ${fmt(tot.c / tot.g)}`);
console.log(`\nBest single fixed weights (all seasons): ${fixedAll.join("/")}`);

if (write) {
  const tuned = prepareSchedule(published, schedule);
  setSchedule(tuned, schedule);
  fs.writeFileSync("model.json", JSON.stringify(tuned, null, 1) + "\n");
  fs.writeFileSync(path.join("public", "data", "weights.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    seasons,
    objective: "mean |margin error| + mean |total error|, leave-one-season-out",
    stages: STAGES.map((g, st) => ({
      min_games: g,
      weights: { ytd: schedule[st][0], l3: schedule[st][1], ha: schedule[st][2], prior: schedule[st][3] },
      holdout_games: validation[st].games,
      holdout_error: { schedule: validation[st].scheduled / validation[st].games, best_fixed: validation[st].fixed / validation[st].games, current: validation[st].current / validation[st].games },
    })),
    overall: { games: tot.g, schedule: tot.s / tot.g, best_fixed: tot.f / tot.g, current: tot.c / tot.g, best_fixed_weights: fixedAll },
  }, null, 1) + "\n");
  console.log("\nWrote model.json (weight schedule) and public/data/weights.json");
}
