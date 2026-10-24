// Research harness for the confidence scores. Every experiment is scored
// leave-one-season-out: fit on two seasons, score the third, repeat.
//   cd web && npx tsx scripts/research.ts
import fs from "node:fs";
import { fitLogit, predictLogit, earliness } from "../lib/confidence";
import type { BacktestRow } from "./backtest-core";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel, type InputDay } from "./backtest-core";

const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = loadInputs();
const rows = runModel(model, days, loadLines(), loadLabels()).filter((r) => r.season < 2027 && r.line_spread != null && r.line_total != null);

// ---- context features --------------------------------------------------------
const rest = new Map<string, { h: number; a: number; h3: number; a3: number }>();
{
  const last = new Map<string, string[]>(); // team -> previous game dates (this season)
  const sorted = [...days].sort((x, y) => x.date.localeCompare(y.date));
  let season = 0;
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  for (const d of sorted as InputDay[]) {
    if (d.season !== season) { last.clear(); season = d.season; }
    for (const g of d.games) {
      const r = (id: string) => { const p = last.get(id); return p?.length ? Math.min(4, dayDiff(d.date, p[p.length - 1])) : 4; };
      const in4 = (id: string) => (last.get(id) ?? []).filter((x) => dayDiff(d.date, x) <= 3).length; // games in previous 3 days
      rest.set(g.game_id, { h: r(g.home.id), a: r(g.away.id), h3: in4(g.home.id), a3: in4(g.away.id) });
    }
    for (const g of d.games) for (const id of [g.home.id, g.away.id]) last.set(id, [...(last.get(id) ?? []), d.date]);
  }
}

type F = BacktestRow & { pm: number; pt: number; s: number; T: number; am: number; at: number; early: number; rh: number; ra: number; b2bh: number; b2ba: number; month: number };
const data: F[] = rows.map((r) => {
  const x = rest.get(r.game_id)!;
  return {
    ...r, pm: r.proj_home - r.proj_away, pt: r.proj_home + r.proj_away, s: r.line_spread!, T: r.line_total!,
    am: r.actual_home - r.actual_away, at: r.actual_home + r.actual_away, early: earliness(r.home_games, r.away_games),
    rh: x.h, ra: x.a, b2bh: x.h === 1 ? 1 : 0, b2ba: x.a === 1 ? 1 : 0, month: Number(r.date.slice(5, 7)),
  };
});
const seasons = [...new Set(data.map((d) => d.season))].sort();
console.log(`${data.length} games with lines, seasons ${seasons.join(", ")}`);

// ---- helpers ---------------------------------------------------------------------
function ols(X: number[][], y: number[]): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  X.forEach((x, i) => { for (let p = 0; p < k; p++) { b[p] += x[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += x[p] * x[q]; } });
  for (let p = 1; p < k; p++) A[p][p] += 1e-6;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < k; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row, i) => row[k] / row[i]);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

// Regression: out-of-sample MAE per held-out season.
function regress(name: string, feats: (d: F) => number[], target: (d: F) => number) {
  const errs: number[] = [];
  const per: string[] = [];
  for (const s of seasons) {
    const tr = data.filter((d) => d.season !== s), te = data.filter((d) => d.season === s);
    const w = ols(tr.map((d) => [1, ...feats(d)]), tr.map(target));
    const e = te.map((d) => Math.abs(target(d) - [1, ...feats(d)].reduce((acc, v, i) => acc + v * w[i], 0)));
    errs.push(...e);
    per.push(mean(e).toFixed(2));
  }
  const all = ols(data.map((d) => [1, ...feats(d)]), data.map(target));
  console.log(`  ${name.padEnd(44)} MAE ${mean(errs).toFixed(3)}  [${per.join(" ")}]  coef ${all.map((c) => c.toFixed(3)).join(", ")}`);
  return mean(errs);
}

// Probability: out-of-sample Brier, log loss, hit rate of the favoured side, and
// hit rate when the probability for the chosen side is >= thresholds.
function classify(name: string, feats: (d: F) => number[], y: (d: F) => number | null, thresholds = [0.55, 0.6, 0.65, 0.7]) {
  const preds: { p: number; y: number; season: number; base: number }[] = [];
  for (const s of seasons) {
    const tr = data.filter((d) => d.season !== s && y(d) != null), te = data.filter((d) => d.season === s && y(d) != null);
    const m = fitLogit(tr.map(feats), tr.map((d) => y(d)!));
    const base = mean(tr.map((d) => y(d)!));
    for (const d of te) preds.push({ p: predictLogit(m, feats(d)), y: y(d)!, season: s, base });
  }
  const brier = mean(preds.map((q) => (q.p - q.y) ** 2));
  const brier0 = mean(preds.map((q) => (q.base - q.y) ** 2));
  const ll = -mean(preds.map((q) => q.y * Math.log(Math.max(1e-9, q.p)) + (1 - q.y) * Math.log(Math.max(1e-9, 1 - q.p))));
  const pick = preds.map((q) => ({ conf: Math.max(q.p, 1 - q.p), hit: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, season: q.season }));
  const bySeason = seasons.map((s) => pct(mean(pick.filter((q) => q.season === s).map((q) => q.hit)))).join(" ");
  const th = thresholds.map((t) => { const xs = pick.filter((q) => q.conf >= t); return `≥${t * 100}%: ${xs.length ? `${pct(mean(xs.map((q) => q.hit)))} (${xs.length})` : "—"}`; }).join("  ");
  console.log(`  ${name.padEnd(44)} Brier ${brier.toFixed(4)} (flat ${brier0.toFixed(4)}, skill ${((brier0 - brier) * 1e4).toFixed(1)}bp)  logloss ${ll.toFixed(4)}  hit ${pct(mean(pick.map((q) => q.hit)))} [${bySeason}]  ${th}`);
  return { brier, brier0 };
}

// ---- 1. Projections: can the margin / total be made more accurate? ---------------------
console.log("\n1. MARGIN projection (target: actual home margin)");
regress("sheet margin as is (no fit)", () => [], (d) => d.am - d.pm);
regress("+ constant (home court) ", () => [], (d) => d.am - d.pm); // same as above, printed for clarity of the intercept
regress("fit: a + b*sheet", (d) => [d.pm], (d) => d.am);
regress("fit: + rest days, back-to-backs", (d) => [d.pm, d.b2bh, d.b2ba, d.rh - d.ra], (d) => d.am);
regress("fit: + early-season x sheet", (d) => [d.pm, d.pm * d.early, d.b2bh, d.b2ba], (d) => d.am);
regress("market only (-spread)", (d) => [-d.s], (d) => d.am);
regress("blend: sheet + market", (d) => [d.pm, -d.s], (d) => d.am);
regress("blend + rest", (d) => [d.pm, -d.s, d.b2bh, d.b2ba, d.rh - d.ra], (d) => d.am);
console.log(`  (market as is: MAE ${mean(data.map((d) => Math.abs(d.am + d.s))).toFixed(3)}, sheet as is: ${mean(data.map((d) => Math.abs(d.am - d.pm))).toFixed(3)})`);

console.log("\n1b. TOTAL projection (target: actual total)");
regress("fit: a + b*sheet", (d) => [d.pt], (d) => d.at);
regress("fit: + back-to-backs, early", (d) => [d.pt, d.b2bh + d.b2ba, d.early], (d) => d.at);
regress("market only", (d) => [d.T], (d) => d.at);
regress("blend: sheet + market", (d) => [d.pt, d.T], (d) => d.at);
regress("blend + back-to-backs + early", (d) => [d.pt, d.T, d.b2bh + d.b2ba, d.early], (d) => d.at);
console.log(`  (market as is: MAE ${mean(data.map((d) => Math.abs(d.at - d.T))).toFixed(3)}, sheet as is: ${mean(data.map((d) => Math.abs(d.at - d.pt))).toFixed(3)})`);

// ---- 2. Win probability -------------------------------------------------------------
const homeWin = (d: F) => (d.am === 0 ? null : d.am > 0 ? 1 : 0);
console.log("\n2. WIN PROBABILITY (target: home team wins)");
classify("sheet margin", (d) => [d.pm], homeWin);
classify("sheet margin + early", (d) => [d.pm, d.pm * d.early], homeWin);
classify("market spread only", (d) => [-d.s], homeWin);
classify("sheet + market", (d) => [d.pm, -d.s], homeWin);
classify("sheet + market + rest", (d) => [d.pm, -d.s, d.b2bh, d.b2ba, d.rh - d.ra], homeWin);
classify("sheet + market + rest + early", (d) => [d.pm, -d.s, d.b2bh, d.b2ba, d.rh - d.ra, d.pm * d.early], homeWin);

// ---- 3. Against the spread ---------------------------------------------------------------
const homeCover = (d: F) => (d.am + d.s === 0 ? null : d.am + d.s > 0 ? 1 : 0);
console.log("\n3. AGAINST THE SPREAD (target: home team covers)");
classify("edge (sheet margin + spread)", (d) => [d.pm + d.s], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("sheet margin, spread separately", (d) => [d.pm, d.s], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("edge + early x edge", (d) => [d.pm + d.s, (d.pm + d.s) * d.early], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("rest / back-to-backs only", (d) => [d.b2bh, d.b2ba, d.rh - d.ra], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("edge + rest", (d) => [d.pm + d.s, d.b2bh, d.b2ba, d.rh - d.ra], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("spread size (fav/dog effects) only", (d) => [d.s, Math.abs(d.s)], homeCover, [0.52, 0.54, 0.56, 0.58]);
classify("everything", (d) => [d.pm + d.s, d.s, Math.abs(d.s), d.b2bh, d.b2ba, d.rh - d.ra, d.early, (d.pm + d.s) * d.early, d.T], homeCover, [0.52, 0.54, 0.56, 0.58]);

// ---- 4. Over / under -------------------------------------------------------------------
const over = (d: F) => (d.at === d.T ? null : d.at > d.T ? 1 : 0);
console.log("\n4. OVER / UNDER (target: game goes over)");
classify("total edge (sheet - line)", (d) => [d.pt - d.T], over, [0.52, 0.54, 0.56, 0.58]);
classify("sheet total, line separately", (d) => [d.pt, d.T], over, [0.52, 0.54, 0.56, 0.58]);
classify("edge + early x edge", (d) => [d.pt - d.T, (d.pt - d.T) * d.early], over, [0.52, 0.54, 0.56, 0.58]);
classify("back-to-backs + rest only", (d) => [d.b2bh + d.b2ba, d.rh + d.ra], over, [0.52, 0.54, 0.56, 0.58]);
classify("line size + month only", (d) => [d.T, d.month >= 3 && d.month <= 6 ? 1 : 0], over, [0.52, 0.54, 0.56, 0.58]);
classify("everything", (d) => [d.pt - d.T, (d.pt - d.T) * d.early, d.T, d.b2bh + d.b2ba, d.rh + d.ra, d.early, d.month >= 4 && d.month <= 6 ? 1 : 0], over, [0.52, 0.54, 0.56, 0.58]);
