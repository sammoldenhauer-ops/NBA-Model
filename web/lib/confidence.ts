// Confidence scores: types shared by the site and the calibration script
// (web/scripts/confidence.ts), plus the small amount of math both need.
// Browser-safe (no imports).

export type Measure = "ats" | "ou" | "winner";

// Per-game output, written by the script to public/data/confidence_games.json.
export type GameConfidence = {
  winner: { team: "home" | "away" | null; p: number | null; skill: boolean };
  ats: { side: "home" | "away" | null; edge: number | null; p: number | null; skill: boolean; rule?: string };
  ou: { side: "over" | "under" | null; edge: number | null; p: number | null; skill: boolean };
  margin_band: number[]; // +/- points, 50% and 80% of past games
  total_band: number[];
};

export type Calibration = { bin: string; n: number; predicted: number; actual: number };

// Leave-one-season-out report for one measure.
export type Validation = {
  measure: Measure;
  title: string;
  features: string[];
  n: number;
  hit_rate: number;
  per_season: { season: number; n: number; hit_rate: number }[];
  brier: number;
  brier_baseline: number;
  skill: boolean;
  calibration: Calibration[];
  top: { share: number; n: number; hit_rate: number }[]; // most confident x% of picks
  thresholds: { min: number; n: number; hit_rate: number }[];
};

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

export function fitLogit(xs: number[][], ys: number[], ridge = 5): Logit {
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

export const earliness = (homeGames: number, awayGames: number) => Math.max(0, 1 - Math.min(homeGames, awayGames) / 30);
