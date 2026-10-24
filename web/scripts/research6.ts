// Round 6: do Sam's situational records (tracking) predict future games?
import fs from "node:fs";
import { fitLogit, predictLogit } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";
import { buildFeatures } from "./features";

const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = loadInputs(), lines = loadLines();
const proj = new Map(runModel(model, days, lines, loadLabels()).map((r) => [r.game_id, { home: r.proj_home, away: r.proj_away }]));
const D = buildFeatures(days, lines, proj).filter((g) => g.season >= 2024 && g.season <= 2026 && g.spread != null && g.total != null && g.projHome != null && g.finalHome != null);
type G = (typeof D)[number];
const seasons = [2024, 2025, 2026];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const am = (g: G) => g.finalHome! - g.finalAway!;
const pm = (g: G) => g.projHome! - g.projAway!;
function prob(name: string, x: (g: G) => number[], y: (g: G) => number | null, only?: (g: G) => boolean) {
  const preds: { p: number; y: number; base: number; s: number }[] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s && y(g) != null), te = D.filter((g) => g.season === s && y(g) != null && (!only || only(g)));
    const m = fitLogit(tr.map(x), tr.map((g) => y(g)!)), b0 = mean(tr.map((g) => y(g)!));
    for (const g of te) preds.push({ p: predictLogit(m, x(g)), y: y(g)!, base: b0, s });
  }
  const pick = preds.map((q) => ({ c: Math.max(q.p, 1 - q.p), h: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, s: q.s })).sort((a, b) => b.c - a.c);
  const top = (f: number) => pct(mean(pick.slice(0, Math.round(pick.length * f)).map((q) => q.h)));
  console.log(`  ${name.padEnd(58)} skill ${((mean(preds.map((q) => (q.base - q.y) ** 2)) - mean(preds.map((q) => (q.p - q.y) ** 2))) * 1e4).toFixed(1).padStart(6)}bp  hit ${pct(mean(pick.map((q) => q.h)))} [${seasons.map((s) => pct(mean(pick.filter((q) => q.s === s).map((q) => q.h)))).join(" ")}]  top10 ${top(0.1)}  top5 ${top(0.05)}  n=${pick.length}`);
}
const cover = (g: G) => (am(g) + g.spread! === 0 ? null : am(g) + g.spread! > 0 ? 1 : 0);
const win = (g: G) => (am(g) === 0 ? null : am(g) > 0 ? 1 : 0);
console.log("AGAINST THE SPREAD");
prob("current (sheet edge, cover10, record luck)", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("situational cover rate vs book only", (g) => [g.sitCover], cover);
prob("situational cover rate vs model only", (g) => [g.sitCoverModel], cover);
prob("current + situational (book)", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck, g.sitCover], cover);
prob("current + situational (book + model)", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck, g.sitCover, g.sitCoverModel], cover);
prob("current + situational, only games with 10+ games of history", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck, g.sitCover], cover, (g) => g.sitN >= 10);
console.log("WINNER");
prob("current (market spread, record luck)", (g) => [-g.spread!, g.recordLuck], win);
prob("current + situational win rate", (g) => [-g.spread!, g.recordLuck, g.sitWin], win);
console.log("Raw check: when a team's situational cover rate vs book was 60%+ (10+ games), how often did it cover next time?");
for (const [lo, hi] of [[0, 0.4], [0.4, 0.6], [0.6, 1.01]]) {
  const xs = D.filter((g) => g.sitN >= 10 && cover(g) != null).map((g) => ({ v: g.sitCover, c: cover(g)! }));
  const hits = xs.filter((x) => x.v >= lo - 0.5 && x.v < hi - 0.5);
  console.log(`  home-minus-away situational edge ${(lo - 0.5).toFixed(1)}..${(hi - 0.5).toFixed(1)}: home covered ${pct(mean(hits.map((x) => x.c)))} of ${hits.length}`);
}
