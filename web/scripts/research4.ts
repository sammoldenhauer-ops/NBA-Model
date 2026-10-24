// Injury method in the full Model sheet: 0 off, 1 value x scale, 2 Sam's BPM/2.
import fs from "node:fs";
import { fitLogit, predictLogit } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";
import { buildFeatures } from "./features";

const base = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const methodCell = Object.entries(base.cells).find(([, v]) => v === "Method")![0].replace("A", "B");
const scaleCell = Object.entries(base.cells).find(([, v]) => v === "Scale (method 1)")![0].replace("A", "B");
const days = loadInputs(), lines = loadLines(), labels = loadLabels();
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const seasons = [2024, 2025, 2026];

for (const [name, method, scale] of [["off", "0", "0.6"], ["value x 0.6 (tested)", "1", "0.6"], ["value x 0.8", "1", "0.8"], ["value x 0.4", "1", "0.4"], ["Sam: BPM/2 each way", "2", "0.6"]] as const) {
  const m: SheetModel = JSON.parse(JSON.stringify(base));
  m.cells[methodCell] = method;
  m.cells[scaleCell] = scale;
  const rows = runModel(m, days, lines, labels).filter((r) => r.season >= 2024 && r.season <= 2026);
  const proj = new Map(rows.map((r) => [r.game_id, { home: r.proj_home, away: r.proj_away }]));
  const F = buildFeatures(days, lines, proj).filter((g) => seasons.includes(g.season) && g.spread != null && g.total != null && g.projHome != null && g.finalHome != null);
  const am = (g: (typeof F)[number]) => g.finalHome! - g.finalAway!;
  const at = (g: (typeof F)[number]) => g.finalHome! + g.finalAway!;
  const pmg = (g: (typeof F)[number]) => g.projHome! - g.projAway!;
  const prob = (x: (g: (typeof F)[number]) => number[], y: (g: (typeof F)[number]) => number | null) => {
    const preds: { p: number; y: number; base: number }[] = [];
    for (const s of seasons) {
      const tr = F.filter((g) => g.season !== s && y(g) != null), te = F.filter((g) => g.season === s && y(g) != null);
      const lm = fitLogit(tr.map(x), tr.map((g) => y(g)!)), b0 = mean(tr.map((g) => y(g)!));
      for (const g of te) preds.push({ p: predictLogit(lm, x(g)), y: y(g)!, base: b0 });
    }
    const pick = preds.map((q) => ({ c: Math.max(q.p, 1 - q.p), h: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0 })).sort((a, b) => b.c - a.c);
    return `skill ${((mean(preds.map((q) => (q.base - q.y) ** 2)) - mean(preds.map((q) => (q.p - q.y) ** 2))) * 1e4).toFixed(1)}bp hit ${pct(mean(pick.map((q) => q.h)))} top10 ${pct(mean(pick.slice(0, Math.round(pick.length / 10)).map((q) => q.h)))}`;
  };
  const ats = prob((g) => [pmg(g) + g.spread!, g.cover10, g.recordLuck], (g) => (am(g) + g.spread! === 0 ? null : am(g) + g.spread! > 0 ? 1 : 0));
  const sheetWin = mean(F.filter((g) => pmg(g) !== 0 && am(g) !== 0).map((g) => (Math.sign(pmg(g)) === Math.sign(am(g)) ? 1 : 0)));
  console.log(`${name.padEnd(22)} margin miss ${mean(F.map((g) => Math.abs(am(g) - pmg(g)))).toFixed(3)}  total miss ${mean(F.map((g) => Math.abs(at(g) - g.projHome! - g.projAway!))).toFixed(3)}  sheet picks winner ${pct(sheetWin)}  | ATS ${ats}`);
}
