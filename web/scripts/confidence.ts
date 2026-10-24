// Calibrate confidence scores and score every game on the site.
//   cd web && npx tsx scripts/confidence.ts
//
// 1. Runs the published Model sheet over every game: history from
//    ../pipeline/cache/inputs_<season>.ndjson.gz plus this season's slate files
//    (including today's unplayed games), with sportsbook lines.
// 2. Builds context features (scripts/features.ts) using only prior information.
// 3. Validates each confidence model leave-one-season-out on completed seasons;
//    a model that doesn't beat a flat guess reports its base rate instead.
// 4. Fits final models and writes
//      public/data/confidence.json        validation report (Confidence page)
//      public/data/confidence_games.json  per-game confidence for every slate game
//      public/data/backtest.csv           every scored game

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fitLogit, predictLogit, type Calibration, type GameConfidence, type Measure, type Validation } from "../lib/confidence";
import type { Slate } from "../lib/data";
import { scoreGame, slateSource, type SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, type InputDay } from "./backtest-core";
import { buildFeatures, type GameFeatures } from "./features";

const DATA = path.join("public", "data");
const modelText = fs.readFileSync("model.json", "utf8");
const model = JSON.parse(modelText) as SheetModel;
const model_hash = crypto.createHash("sha1").update(modelText.replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
const labels = loadLabels();
const lines = loadLines();

// ---- every game: cached history + this season's slate files ------------------------
const days: InputDay[] = loadInputs();
const known = new Set(days.flatMap((d) => d.games.map((g) => g.game_id)));
for (const f of fs.readdirSync(DATA).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
  const s = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")) as Slate;
  const games = s.games.filter((g) => !known.has(g.game_id));
  if (!games.length) continue;
  days.push({ ...s, games, season: s.season } as InputDay);
  // Slate lines (today's) take precedence over a missing cache entry.
  for (const g of games) if (g.line && !lines.has(g.game_id)) lines.set(g.game_id, { spread: g.line.home_spread, total: g.line.total });
}

const projections = new Map<string, { home: number; away: number }>();
for (const d of days) {
  for (const g of d.games) {
    const game = { ...g, tip_time: "", status: "", neutral: false,
      home: { ...g.home, name: g.home.abbr, color: null, logo: null }, away: { ...g.away, name: g.away.abbr, color: null, logo: null } };
    const r = scoreGame(model, slateSource(d, game), labels);
    if (r.home_score != null && r.away_score != null) projections.set(g.game_id, { home: r.home_score, away: r.away_score });
  }
}
const all = buildFeatures(days, lines, projections);
const current = Math.max(...all.map((g) => g.season));
const done = all.filter((g) => g.finalHome != null && g.finalAway != null && g.projHome != null);
// Calibrate on completed seasons; this season joins once it has 300+ finished games.
const fitGames = done.filter((g) => g.season < current || done.filter((x) => x.season === current).length >= 300);
const seasons = [...new Set(fitGames.map((g) => g.season))].sort();

// ---- the three models ---------------------------------------------------------------
const edge = (g: GameFeatures) => (g.projHome! - g.projAway!) + g.spread!;
const tEdge = (g: GameFeatures) => g.projHome! + g.projAway! - g.total!;
type Spec = {
  measure: Measure;
  title: string;
  features: string[];
  usable: (g: GameFeatures) => boolean;
  x: (g: GameFeatures) => number[];
  y: (g: GameFeatures) => number | null; // 1 = home covers / over / home wins
};
const specs: Spec[] = [
  {
    measure: "ats", title: "Against the spread",
    features: ["sheet edge vs the line", "recent cover margin (last 10)", "record vs point differential"],
    usable: (g) => g.spread != null && g.projHome != null,
    x: (g) => [edge(g), g.cover10, g.recordLuck],
    y: (g) => { const c = g.finalHome! - g.finalAway! + g.spread!; return c === 0 ? null : c > 0 ? 1 : 0; },
  },
  {
    measure: "ou", title: "Over / under",
    features: ["3P% luck, made (both teams)", "3P% luck, allowed (both teams)"],
    usable: (g) => g.total != null,
    x: (g) => [g.shot3made, g.shot3allowed],
    y: (g) => { const o = g.finalHome! + g.finalAway! - g.total!; return o === 0 ? null : o > 0 ? 1 : 0; },
  },
  {
    measure: "winner", title: "Winner",
    features: ["market spread", "record vs point differential"],
    usable: (g) => g.spread != null,
    x: (g) => [-g.spread!, g.recordLuck],
    y: (g) => { const m = g.finalHome! - g.finalAway!; return m === 0 ? null : m > 0 ? 1 : 0; },
  },
];
// Winner fallback when there's no line yet: the sheet's projected margin.
const winnerNoLine: Spec = { ...specs[2], features: ["sheet projected margin"], usable: (g) => g.projHome != null, x: (g) => [g.projHome! - g.projAway!] };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function validate(spec: Spec): Validation {
  const preds: { p: number; y: number; season: number; base: number }[] = [];
  for (const s of seasons) {
    const tr = fitGames.filter((g) => g.season !== s && spec.usable(g) && spec.y(g) != null);
    const te = fitGames.filter((g) => g.season === s && spec.usable(g) && spec.y(g) != null);
    if (tr.length < 200 || !te.length) continue;
    const m = fitLogit(tr.map(spec.x), tr.map((g) => spec.y(g)!));
    const base = mean(tr.map((g) => spec.y(g)!));
    for (const g of te) preds.push({ p: predictLogit(m, spec.x(g)), y: spec.y(g)!, season: s, base });
  }
  const brier = mean(preds.map((q) => (q.p - q.y) ** 2));
  const brier0 = mean(preds.map((q) => (q.base - q.y) ** 2));
  // Score the side the model picks: confidence = max(p, 1 - p).
  const picks = preds.map((q) => ({ conf: Math.max(q.p, 1 - q.p), hit: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, season: q.season }));
  const sorted = [...picks].sort((a, b) => b.conf - a.conf);
  const bins = [0.5, 0.52, 0.54, 0.56, 0.6, 0.65, 0.7, 0.8, 0.9, 1.01];
  const calibration: Calibration[] = [];
  for (let i = 0; i < bins.length - 1; i++) {
    const xs = picks.filter((q) => q.conf >= bins[i] && q.conf < bins[i + 1]);
    if (xs.length >= 10) calibration.push({
      bin: `${Math.round(bins[i] * 100)}–${Math.min(100, Math.round(bins[i + 1] * 100))}%`,
      n: xs.length, predicted: mean(xs.map((q) => q.conf)), actual: mean(xs.map((q) => q.hit)),
    });
  }
  return {
    measure: spec.measure, title: spec.title, features: spec.features,
    n: picks.length, hit_rate: mean(picks.map((q) => q.hit)),
    per_season: seasons.map((s) => { const xs = picks.filter((q) => q.season === s); return { season: s, n: xs.length, hit_rate: mean(xs.map((q) => q.hit)) }; }),
    brier, brier_baseline: brier0, skill: brier < brier0 - 0.0002,
    calibration,
    top: [0.05, 0.1, 0.2, 0.3, 0.5].map((share) => { const xs = sorted.slice(0, Math.round(sorted.length * share)); return { share, n: xs.length, hit_rate: mean(xs.map((q) => q.hit)) }; }),
    thresholds: [0.52, 0.54, 0.56, 0.58, 0.6, 0.65, 0.7, 0.8].map((min) => { const xs = picks.filter((q) => q.conf >= min); return { min, n: xs.length, hit_rate: xs.length ? mean(xs.map((q) => q.hit)) : NaN }; }),
  };
}

const validation = specs.map(validate);
const finals = new Map<Measure | "winnerNoLine", { m: ReturnType<typeof fitLogit>; base: number; skill: boolean }>();
for (const spec of [...specs, winnerNoLine]) {
  const tr = fitGames.filter((g) => spec.usable(g) && spec.y(g) != null);
  const key = spec === winnerNoLine ? "winnerNoLine" : spec.measure;
  const v = spec === winnerNoLine ? validate(spec) : validation.find((x) => x.measure === spec.measure)!;
  finals.set(key, { m: fitLogit(tr.map(spec.x), tr.map((g) => spec.y(g)!)), base: v.hit_rate, skill: v.skill });
}

// ---- accuracy bands (sheet projection vs result), by stage of season -----------------
const quant = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i)); };
const stage = (g: GameFeatures) => { const n = Math.min(g.homeGames, g.awayGames); return n < 10 ? 0 : n < 20 ? 1 : 2; };
const bands = [0, 1, 2].map((st) => {
  const xs = fitGames.filter((g) => stage(g) === st);
  const me = xs.map((g) => Math.abs(g.finalHome! - g.finalAway! - (g.projHome! - g.projAway!)));
  const te = xs.map((g) => Math.abs(g.finalHome! + g.finalAway! - (g.projHome! + g.projAway!)));
  return { margin: [quant(me, 0.5), quant(me, 0.8)], total: [quant(te, 0.5), quant(te, 0.8)] };
});

// ---- score every slate game -----------------------------------------------------------
const slateIds = new Set<string>();
for (const f of fs.readdirSync(DATA).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  for (const g of (JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")) as Slate).games) slateIds.add(g.game_id);
}
const prob = (key: Measure | "winnerNoLine", x: number[]) => {
  const f = finals.get(key)!;
  return f.skill ? predictLogit(f.m, x) : null;
};
const perGame: Record<string, GameConfidence> = {};
for (const g of all.filter((x) => slateIds.has(x.game_id))) {
  const hasProj = g.projHome != null;
  const b = bands[stage(g)];
  // ATS / O-U: p = P(home covers) / P(over); the pick is the likelier side.
  const atsP = g.spread != null && hasProj ? prob("ats", specs[0].x(g)) : null;
  const ouP = g.total != null ? prob("ou", specs[1].x(g)) : null;
  const winP = g.spread != null ? prob("winner", specs[2].x(g)) : hasProj ? prob("winnerNoLine", winnerNoLine.x(g)) : null;
  const atsSkill = finals.get("ats")!.skill, ouSkill = finals.get("ou")!.skill, winSkill = finals.get(g.spread != null ? "winner" : "winnerNoLine")!.skill;
  perGame[g.game_id] = {
    ats: {
      side: atsP == null ? (g.spread != null && hasProj && edge(g) !== 0 ? (edge(g) > 0 ? "home" : "away") : null) : atsP >= 0.5 ? "home" : "away",
      edge: g.spread != null && hasProj ? edge(g) : null,
      p: atsP == null ? (g.spread != null && hasProj ? finals.get("ats")!.base : null) : Math.max(atsP, 1 - atsP),
      skill: atsSkill,
    },
    ou: {
      side: ouP == null ? (g.total != null && hasProj && tEdge(g) !== 0 ? (tEdge(g) > 0 ? "over" : "under") : null) : ouP >= 0.5 ? "over" : "under",
      edge: g.total != null && hasProj ? tEdge(g) : null,
      p: ouP == null ? (g.total != null ? finals.get("ou")!.base : null) : Math.max(ouP, 1 - ouP),
      skill: ouSkill,
    },
    winner: winP == null ? { team: null, p: null, skill: winSkill } : { team: winP >= 0.5 ? "home" : "away", p: Math.max(winP, 1 - winP), skill: winSkill },
    margin_band: b.margin,
    total_band: b.total,
  };
}

// ---- write ---------------------------------------------------------------------------
const withLine = fitGames.filter((g) => g.spread != null && g.total != null);
const accuracy = {
  games: withLine.length,
  margin_mae: mean(withLine.map((g) => Math.abs(g.finalHome! - g.finalAway! - (g.projHome! - g.projAway!)))),
  margin_bias: mean(withLine.map((g) => g.finalHome! - g.finalAway! - (g.projHome! - g.projAway!))),
  total_mae: mean(withLine.map((g) => Math.abs(g.finalHome! + g.finalAway! - (g.projHome! + g.projAway!)))),
  total_bias: mean(withLine.map((g) => g.finalHome! + g.finalAway! - (g.projHome! + g.projAway!))),
  market_margin_mae: mean(withLine.map((g) => Math.abs(g.finalHome! - g.finalAway! + g.spread!))),
  market_total_mae: mean(withLine.map((g) => Math.abs(g.finalHome! + g.finalAway! - g.total!))),
};
fs.writeFileSync(path.join(DATA, "confidence.json"), JSON.stringify({ generated_at: new Date().toISOString(), model_hash, seasons, validation, accuracy, bands }, null, 1) + "\n");
fs.writeFileSync(path.join(DATA, "confidence_games.json"), JSON.stringify({ model_hash, games: perGame }) + "\n");
const cols: (keyof GameFeatures)[] = ["season", "date", "game_id", "away", "home", "projAway", "projHome", "finalAway", "finalHome", "spread", "total", "awayGames", "homeGames", "cover10", "recordLuck", "shot3made", "shot3allowed"];
fs.writeFileSync(path.join(DATA, "backtest.csv"), [cols.join(","), ...done.map((g) => cols.map((c) => g[c] ?? "").join(","))].join("\n") + "\n");

// Results tracking: one row per team per finished game, model spread vs result.
const trackRows: (string | number | null)[][] = [];
for (const g of done) {
  const m = g.projHome! - g.projAway!;
  trackRows.push([g.season, g.date, g.home, g.away, 1, -m, g.spread, g.finalHome, g.finalAway]);
  trackRows.push([g.season, g.date, g.away, g.home, 0, m, g.spread == null ? null : -g.spread, g.finalAway, g.finalHome]);
}
fs.writeFileSync(path.join(DATA, "tracking.json"), JSON.stringify({
  generated_at: new Date().toISOString(), model_hash,
  columns: ["season", "date", "team", "opp", "home", "spread", "line", "pts", "oppPts"], rows: trackRows,
}) + "\n");

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
console.log(`Model ${model_hash}: ${done.length} finished games scored, ${fitGames.length} used to calibrate (${seasons.join(", ")}); ${Object.keys(perGame).length} slate games written.`);
for (const v of validation) {
  console.log(`\n${v.title}: hit ${pct(v.hit_rate)} [${v.per_season.map((s) => pct(s.hit_rate)).join(" ")}]  Brier ${v.brier.toFixed(4)} vs flat ${v.brier_baseline.toFixed(4)}  skill=${v.skill}`);
  console.log("  most confident: " + v.top.map((t) => `${t.share * 100}% ${pct(t.hit_rate)} (${t.n})`).join("  "));
  console.log("  at least:       " + v.thresholds.filter((t) => t.n).map((t) => `${t.min * 100}% ${pct(t.hit_rate)} (${t.n})`).join("  "));
  console.log("  calibration:    " + v.calibration.map((c) => `${c.bin}: said ${pct(c.predicted)} hit ${pct(c.actual)} (${c.n})`).join("  "));
}
