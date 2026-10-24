// Backtest the published Model sheet and calibrate confidence scores.
//   cd web && npx tsx scripts/backtest.ts
// Inputs:  ../pipeline/cache/inputs_<season>.ndjson.gz  (point-in-time stats per game date)
//          ../pipeline/cache/lines.csv                  (sportsbook lines via ESPN)
//          model.json, public/data/stats/stats.json
// Outputs: public/data/confidence.json   (calibrated model + validation report)
//          public/data/backtest.csv      (every game: projection, line, result)

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applySkill, fitConfidence, validate, type BacktestRow } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";

const modelText = fs.readFileSync("model.json", "utf8");
const model = JSON.parse(modelText) as SheetModel;
const model_hash = crypto.createHash("sha1").update(modelText.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
const rows = runModel(model, loadInputs(), loadLines(), loadLabels());

// Calibrate on completed seasons; the current season joins the fit once it has
// enough games (its games always appear in the CSV).
const seasons = [...new Set(rows.map((r) => r.season))].sort();
const current = Math.max(...seasons);
const fitRows = rows.filter((r) => r.season !== current).length && rows.filter((r) => r.season === current).length < 300
  ? rows.filter((r) => r.season !== current)
  : rows;
const report = validate(fitRows);
const cm = applySkill(fitConfidence(fitRows, { model_hash, seasons: [...new Set(fitRows.map((r) => r.season))] }), report.measures);

fs.writeFileSync(path.join("public", "data", "confidence.json"),
  JSON.stringify({ generated_at: new Date().toISOString(), model: cm, validation: report.measures, accuracy: report.accuracy }, null, 1) + "\n");

const csvCols: (keyof BacktestRow)[] = ["season", "date", "game_id", "away", "home", "proj_away", "proj_home", "actual_away", "actual_home", "line_spread", "line_total", "away_games", "home_games"];
fs.writeFileSync(path.join("public", "data", "backtest.csv"),
  [csvCols.join(","), ...rows.map((r) => csvCols.map((c) => r[c] ?? "").join(","))].join("\n") + "\n");

console.log(`Model ${model_hash}: ${rows.length} games (${fitRows.length} used to fit); skill: ${JSON.stringify(cm.skill)}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
for (const v of report.measures) {
  console.log(`\n${v.measure.toUpperCase()}: n=${v.n} hit ${pct(v.hit_rate)}  Brier ${v.brier.toFixed(4)} vs baseline ${v.brier_baseline.toFixed(4)}`);
  for (const c of v.calibration) console.log(`   predicted ${c.bin.padEnd(12)} n=${String(c.n).padStart(5)}  avg pred ${pct(c.predicted)}  actual ${pct(c.actual)}`);
  for (const b of v.by_edge) console.log(`   edge ${b.bucket.padEnd(7)} n=${String(b.n).padStart(5)}  hit ${isNaN(b.hit_rate) ? "—" : pct(b.hit_rate)}`);
}
console.log("\nAccuracy:", Object.fromEntries(Object.entries(report.accuracy).map(([k, v]) => [k, Math.round(v * 100) / 100])));
