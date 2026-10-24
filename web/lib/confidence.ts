// Confidence scores for the Model sheet's projections, calibrated on backtests.
// Browser-safe (no imports). Three measures:
//   ats     P(the side the model favours vs the DraftKings spread covers)
//   ou      P(the model's over/under call vs the DraftKings total hits)
//   winner  P(the team the model projects to win wins outright)
// plus accuracy bands: how far the actual margin / total lands from the projection.

export type BacktestRow = {
  season: number;
  date: string;
  game_id: string;
  home: string;
  away: string;
  proj_home: number;
  proj_away: number;
  actual_home: number;
  actual_away: number;
  line_spread: number | null; // home spread (negative = home favoured)
  line_total: number | null;
  home_games: number; // current-season games played before this game
  away_games: number;
};

// ---- features ----------------------------------------------------------------

// Early season = projections lean on few games. 1 at 0 games, 0 from 30 games on.
export const earliness = (homeGames: number, awayGames: number) => Math.max(0, 1 - Math.min(homeGames, awayGames) / 30);

export const projMargin = (r: { proj_home: number; proj_away: number }) => r.proj_home - r.proj_away;
export const projTotal = (r: { proj_home: number; proj_away: number }) => r.proj_home + r.proj_away;
// Spread edge: model's home margin minus the market's (market margin = -home spread).
export const spreadEdge = (r: { proj_home: number; proj_away: number; line_spread: number | null }) =>
  r.line_spread == null ? null : projMargin(r) + r.line_spread;
export const totalEdge = (r: { proj_home: number; proj_away: number; line_total: number | null }) =>
  r.line_total == null ? null : projTotal(r) - r.line_total;

export type Measure = "ats" | "ou" | "winner";

// Feature vector and outcome (1 = the model's call was right) for one game, or null
// when the game doesn't count (no line, a push, a projected tie).
export function example(m: Measure, r: BacktestRow): { x: number[]; y: number } | null {
  const early = earliness(r.home_games, r.away_games);
  const actualMargin = r.actual_home - r.actual_away;
  if (m === "winner") {
    const pm = projMargin(r);
    if (pm === 0 || actualMargin === 0) return null;
    return { x: [Math.abs(pm), early], y: Math.sign(pm) === Math.sign(actualMargin) ? 1 : 0 };
  }
  if (m === "ats") {
    const e = spreadEdge(r);
    if (e == null || e === 0) return null;
    const cover = actualMargin + r.line_spread!; // > 0: home covered
    if (cover === 0) return null;
    return { x: [Math.abs(e), early], y: Math.sign(e) === Math.sign(cover) ? 1 : 0 };
  }
  const e = totalEdge(r);
  if (e == null || e === 0) return null;
  const over = r.actual_home + r.actual_away - r.line_total!;
  if (over === 0) return null;
  return { x: [Math.abs(e), early], y: Math.sign(e) === Math.sign(over) ? 1 : 0 };
}

// ---- logistic regression (Newton's method, small ridge) ------------------------

export type Logit = { coef: number[]; mean: number[]; sd: number[] }; // coef[0] = intercept

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function fitLogit(xs: number[][], ys: number[], ridge = 1): Logit {
  const k = xs[0]?.length ?? 0;
  const mean = Array.from({ length: k }, (_, j) => xs.reduce((s, x) => s + x[j], 0) / xs.length);
  const sd = Array.from({ length: k }, (_, j) => Math.sqrt(xs.reduce((s, x) => s + (x[j] - mean[j]) ** 2, 0) / xs.length) || 1);
  const Z = xs.map((x) => [1, ...x.map((v, j) => (v - mean[j]) / sd[j])]);
  let w = new Array(k + 1).fill(0);
  for (let it = 0; it < 50; it++) {
    const g = new Array(k + 1).fill(0);
    const H = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    Z.forEach((z, i) => {
      const p = sigmoid(z.reduce((s, v, j) => s + v * w[j], 0));
      for (let a = 0; a <= k; a++) {
        g[a] += (ys[i] - p) * z[a];
        for (let b = 0; b <= k; b++) H[a][b] += p * (1 - p) * z[a] * z[b];
      }
    });
    for (let a = 1; a <= k; a++) {
      g[a] -= ridge * w[a];
      H[a][a] += ridge;
    }
    const step = solve(H, g);
    w = w.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { coef: w, mean, sd };
}

export const predictLogit = (m: Logit, x: number[]) =>
  sigmoid(m.coef[0] + x.reduce((s, v, j) => s + m.coef[j + 1] * ((v - m.mean[j]) / m.sd[j]), 0));

// ---- accuracy bands ------------------------------------------------------------

export type Bands = { early: number[]; margin: number[][]; total: number[][] };
export const BAND_LEVELS = [0.5, 0.8];
const EARLY_BUCKETS = [1 / 3, 2 / 3]; // late (<1/3), mid, early (>=2/3)

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  return s[Math.floor(i)] + (s[Math.ceil(i)] - s[Math.floor(i)]) * (i - Math.floor(i));
};
const bucketOf = (e: number) => (e < EARLY_BUCKETS[0] ? 0 : e < EARLY_BUCKETS[1] ? 1 : 2);

// |actual - projected| at each band level, separately for late / mid / early season.
export function fitBands(rows: BacktestRow[]): Bands {
  const m: number[][] = [[], [], []];
  const t: number[][] = [[], [], []];
  for (const r of rows) {
    const b = bucketOf(earliness(r.home_games, r.away_games));
    m[b].push(Math.abs(r.actual_home - r.actual_away - projMargin(r)));
    t[b].push(Math.abs(r.actual_home + r.actual_away - projTotal(r)));
  }
  const all = (xs: number[][]) => xs.flat();
  const q = (xs: number[], fallback: number[]) => BAND_LEVELS.map((l, i) => (xs.length >= 50 ? quantile(xs, l) : fallback[i]));
  const mAll = BAND_LEVELS.map((l) => quantile(all(m), l));
  const tAll = BAND_LEVELS.map((l) => quantile(all(t), l));
  return { early: EARLY_BUCKETS, margin: m.map((xs) => q(xs, mAll)), total: t.map((xs) => q(xs, tAll)) };
}

// ---- calibrated model --------------------------------------------------------

export type ConfidenceModel = {
  fitted_at: string;
  model_hash: string;
  seasons: number[];
  n: Record<Measure, number>;
  logit: Record<Measure, Logit>;
  // false = no out-of-sample skill (leave-one-season-out Brier no better than a flat
  // guess); that measure then reports its plain base rate.
  skill: Record<Measure, boolean>;
  bands: Bands;
};

// Replace a measure's model with its base rate when it showed no skill.
export function applySkill(cm: ConfidenceModel, measures: Validation[]): ConfidenceModel {
  const out: ConfidenceModel = JSON.parse(JSON.stringify(cm));
  out.skill = { ats: false, ou: false, winner: false };
  for (const v of measures) {
    const skilled = v.brier < v.brier_baseline - 0.0005;
    out.skill[v.measure] = skilled;
    if (!skilled) {
      const p = Math.min(0.99, Math.max(0.01, v.hit_rate));
      out.logit[v.measure] = { coef: [Math.log(p / (1 - p)), 0, 0], mean: [0, 0], sd: [1, 1] };
    }
  }
  return out;
}

export function fitConfidence(rows: BacktestRow[], meta: { model_hash: string; seasons: number[] }): ConfidenceModel {
  const logit = {} as Record<Measure, Logit>;
  const n = {} as Record<Measure, number>;
  for (const m of ["ats", "ou", "winner"] as Measure[]) {
    const ex = rows.map((r) => example(m, r)).filter((e): e is { x: number[]; y: number } => !!e);
    logit[m] = fitLogit(ex.map((e) => e.x), ex.map((e) => e.y));
    n[m] = ex.length;
  }
  return { fitted_at: new Date().toISOString(), ...meta, n, logit, skill: { ats: true, ou: true, winner: true }, bands: fitBands(rows) };
}

export type GameConfidence = {
  winner: { team: "home" | "away" | null; p: number | null; skill: boolean };
  ats: { side: "home" | "away" | null; edge: number | null; p: number | null; skill: boolean };
  ou: { side: "over" | "under" | null; edge: number | null; p: number | null; skill: boolean };
  margin_band: number[]; // +/- points at BAND_LEVELS
  total_band: number[];
};

export function scoreConfidence(
  cm: ConfidenceModel,
  g: { proj_home: number; proj_away: number; line_spread: number | null; line_total: number | null; home_games: number; away_games: number },
): GameConfidence {
  const early = earliness(g.home_games, g.away_games);
  const pm = projMargin(g);
  const se = spreadEdge(g);
  const te = totalEdge(g);
  const b = bucketOf(early);
  const sk = cm.skill ?? { ats: true, ou: true, winner: true };
  return {
    winner: pm === 0 ? { team: null, p: null, skill: sk.winner } : { team: pm > 0 ? "home" : "away", p: predictLogit(cm.logit.winner, [Math.abs(pm), early]), skill: sk.winner },
    ats: se == null || se === 0 ? { side: null, edge: se, p: null, skill: sk.ats } : { side: se > 0 ? "home" : "away", edge: se, p: predictLogit(cm.logit.ats, [Math.abs(se), early]), skill: sk.ats },
    ou: te == null || te === 0 ? { side: null, edge: te, p: null, skill: sk.ou } : { side: te > 0 ? "over" : "under", edge: te, p: predictLogit(cm.logit.ou, [Math.abs(te), early]), skill: sk.ou },
    margin_band: cm.bands.margin[b],
    total_band: cm.bands.total[b],
  };
}

// ---- validation (leave one season out) -----------------------------------------

export type Calibration = { bin: string; n: number; predicted: number; actual: number };
export type Validation = {
  measure: Measure;
  n: number;
  hit_rate: number;
  brier: number;
  brier_baseline: number; // always predicting the training hit rate
  calibration: Calibration[];
  by_edge: { bucket: string; n: number; hit_rate: number }[];
};

const EDGE_BUCKETS: Record<Measure, number[]> = { ats: [0, 2, 4, 6, 9, 1e9], ou: [0, 3, 6, 9, 12, 1e9], winner: [0, 3, 6, 9, 12, 1e9] };

export function validate(rows: BacktestRow[]): { measures: Validation[]; accuracy: Record<string, number> } {
  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  const measures: Validation[] = [];
  for (const m of ["ats", "ou", "winner"] as Measure[]) {
    const preds: { p: number; base: number; y: number; edge: number }[] = [];
    for (const s of seasons) {
      const train = rows.filter((r) => r.season !== s).map((r) => example(m, r)).filter((e): e is { x: number[]; y: number } => !!e);
      const test = rows.filter((r) => r.season === s).map((r) => example(m, r)).filter((e): e is { x: number[]; y: number } => !!e);
      if (train.length < 100 || !test.length) continue;
      const model = fitLogit(train.map((e) => e.x), train.map((e) => e.y));
      const base = train.reduce((s2, e) => s2 + e.y, 0) / train.length;
      for (const e of test) preds.push({ p: predictLogit(model, e.x), base, y: e.y, edge: e.x[0] });
    }
    if (!preds.length) continue;
    const bins = [0, 0.45, 0.5, 0.525, 0.55, 0.6, 0.7, 0.8, 1.01];
    const calibration: Calibration[] = [];
    for (let i = 0; i < bins.length - 1; i++) {
      const xs = preds.filter((p) => p.p >= bins[i] && p.p < bins[i + 1]);
      if (xs.length) calibration.push({
        bin: `${Math.round(bins[i] * 1000) / 10}–${Math.min(100, Math.round(bins[i + 1] * 1000) / 10)}%`,
        n: xs.length,
        predicted: xs.reduce((s, p) => s + p.p, 0) / xs.length,
        actual: xs.reduce((s, p) => s + p.y, 0) / xs.length,
      });
    }
    const eb = EDGE_BUCKETS[m];
    const by_edge = eb.slice(0, -1).map((lo, i) => {
      const xs = preds.filter((p) => p.edge >= lo && p.edge < eb[i + 1]);
      return { bucket: eb[i + 1] > 1e8 ? `${lo}+` : `${lo}–${eb[i + 1]}`, n: xs.length, hit_rate: xs.length ? xs.reduce((s, p) => s + p.y, 0) / xs.length : NaN };
    });
    measures.push({
      measure: m,
      n: preds.length,
      hit_rate: preds.reduce((s, p) => s + p.y, 0) / preds.length,
      brier: preds.reduce((s, p) => s + (p.p - p.y) ** 2, 0) / preds.length,
      brier_baseline: preds.reduce((s, p) => s + (p.base - p.y) ** 2, 0) / preds.length,
      calibration,
      by_edge,
    });
  }
  const me = rows.map((r) => r.actual_home - r.actual_away - projMargin(r));
  const te = rows.map((r) => r.actual_home + r.actual_away - projTotal(r));
  const withLine = rows.filter((r) => r.line_spread != null && r.line_total != null);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const accuracy = {
    games: rows.length,
    margin_mae: mean(me.map(Math.abs)),
    margin_bias: mean(me),
    total_mae: mean(te.map(Math.abs)),
    total_bias: mean(te),
    // The market, on the same games, for comparison.
    market_margin_mae: mean(withLine.map((r) => Math.abs(r.actual_home - r.actual_away + r.line_spread!))),
    market_total_mae: mean(withLine.map((r) => Math.abs(r.actual_home + r.actual_away - r.line_total!))),
    model_margin_mae_same_games: mean(withLine.map((r) => Math.abs(r.actual_home - r.actual_away - projMargin(r)))),
    model_total_mae_same_games: mean(withLine.map((r) => Math.abs(r.actual_home + r.actual_away - projTotal(r)))),
  };
  return { measures, accuracy };
}
