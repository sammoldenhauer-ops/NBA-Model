// Round 5: official pregame injury reports vs actual absences, and a player-based
// team-strength projection (rating x minutes), alone and blended with the sheet.
//   cd web && npx tsx scripts/research5.ts
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fitLogit, predictLogit } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { CACHE, loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";
import { buildFeatures } from "./features";

type I = Record<string, number>;
const inj = new Map<string, I>();
for (const f of fs.readdirSync(CACHE).filter((x) => /^injuries_\d+\.csv\.gz$/.test(x))) {
  const [head, ...rows] = zlib.gunzipSync(fs.readFileSync(path.join(CACHE, f))).toString("utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.replace(/"/g, ""));
  for (const line of rows) {
    const v = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, ""));
    const o: I = {};
    cols.forEach((c, i) => (o[c] = v[i] === "TRUE" ? 1 : v[i] === "FALSE" ? 0 : v[i] === "NA" || v[i] === "" ? NaN : Number(v[i])));
    inj.set(`${v[cols.indexOf("game_id")]}|${v[cols.indexOf("team_id")]}`, o);
  }
}

// Sheet WITHOUT its own injury adjustment, so each injury variant is added once.
const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const methodCell = Object.entries(model.cells).find(([, v]) => v === "Method")![0].replace("A", "B");
model.cells[methodCell] = "0";
const days = loadInputs(), lines = loadLines();
const rows = runModel(model, days, lines, loadLabels());
const proj = new Map(rows.map((r) => [r.game_id, { home: r.proj_home, away: r.proj_away }]));
const poss = new Map<string, number>();
for (const d of days) for (const g of d.games) {
  const p = (d.teams[g.home.id]?.YTD.stats["Poss./Game"] ?? d.teams[g.home.id]?.Prior.stats["Poss./Game"] ?? 100) as number;
  const q = (d.teams[g.away.id]?.YTD.stats["Poss./Game"] ?? d.teams[g.away.id]?.Prior.stats["Poss./Game"] ?? 100) as number;
  poss.set(g.game_id, (p + q) / 2);
}
const D = buildFeatures(days, lines, proj)
  .filter((g) => g.season >= 2024 && g.season <= 2026 && g.spread != null && g.total != null && g.projHome != null && g.finalHome != null)
  .map((g) => ({ ...g, h: inj.get(`${g.game_id}|${g.homeId}`), a: inj.get(`${g.game_id}|${g.awayId}`), pace: poss.get(g.game_id)! / 100 }))
  .filter((g) => g.h && g.a);
type G = (typeof D)[number];
const seasons = [2024, 2025, 2026];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pm = (g: G) => g.projHome! - g.projAway!;
const am = (g: G) => g.finalHome! - g.finalAway!;
const z = (x: number) => (Number.isFinite(x) ? x : 0);
console.log(`${D.length} games; with a pregame report for both teams: ${D.filter((g) => g.h!.rep_found && g.a!.rep_found).length}`);

// OLS with intercept, leave-one-season-out; returns held-out MAE and mean coefficients.
function fit(name: string, X: (g: G) => number[], y: (g: G) => number, base?: (g: G) => number) {
  const errs: number[] = [];
  const coefs: number[][] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s), te = D.filter((g) => g.season === s);
    const A = tr.map((g) => [1, ...X(g)]), b = tr.map((g) => y(g) - (base ? base(g) : 0));
    const k = A[0].length;
    const M = Array.from({ length: k }, (_, i) => [...Array.from({ length: k }, (_, j) => A.reduce((s2, r) => s2 + r[i] * r[j], 0) + (i === j && i > 0 ? 1e-6 : 0)), A.reduce((s2, r, n) => s2 + r[i] * b[n], 0)]);
    for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < k; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; } }
    const w = M.map((r, i) => r[k] / r[i]);
    coefs.push(w);
    errs.push(...te.map((g) => Math.abs(y(g) - (base ? base(g) : 0) - [1, ...X(g)].reduce((s2, v, i) => s2 + v * w[i], 0))));
  }
  const avgW = coefs[0].map((_, i) => mean(coefs.map((c) => c[i])));
  console.log(`  ${name.padEnd(62)} MAE ${mean(errs).toFixed(3)}   coef ${avgW.map((c) => c.toFixed(2)).join(", ")}`);
}

const vAct = (g: G) => -g.h!.vorp + g.a!.vorp;
const vRep = (g: G) => -g.h!.rep_vorp + g.a!.rep_vorp;
const vQ = (g: G) => -g.h!.rep_q_vorp + g.a!.rep_q_vorp;
const sRep = (g: G) => (z(g.h!.strength_rep) - z(g.a!.strength_rep)) * g.pace;
const sAct = (g: G) => (z(g.h!.strength) - z(g.a!.strength)) * g.pace;
const dRep = (g: G) => (z(g.h!.strength_rep - g.h!.base_strength) - z(g.a!.strength_rep - g.a!.base_strength)) * g.pace;

console.log("\n1. INJURIES ON TOP OF THE SHEET (target: actual margin; sheet margin as a fixed base)");
fit("sheet + home court only", () => [], am, pm);
fit("+ actual absences (lookahead: includes late scratches)", (g) => [vAct(g)], am, pm);
fit("+ pregame report: Out/Doubtful", (g) => [vRep(g)], am, pm);
fit("+ pregame report: Out/Doubtful + Questionable", (g) => [vRep(g), vQ(g)], am, pm);

console.log("\n2. DOES THE CLOSING LINE PRICE THE PREGAME REPORT? (target: actual margin - market margin)");
fit("report Out/Doubtful value", (g) => [vRep(g)], (g) => am(g) + g.spread!);
fit("report Questionable value", (g) => [vQ(g)], (g) => am(g) + g.spread!);
fit("actual absences beyond the report (late news)", (g) => [vAct(g) - vRep(g)], (g) => am(g) + g.spread!);

console.log("\n3. PLAYER-BASED TEAM STRENGTH (rating x projected minutes, report availability)");
fit("player strength alone (+ home court)", (g) => [sRep(g)], am);
fit("sheet alone (fit scale + home court)", (g) => [pm(g)], am);
fit("sheet + player strength (blend)", (g) => [pm(g), sRep(g)], am);
fit("sheet + player strength + report injuries", (g) => [pm(g), sRep(g), vRep(g)], am);
fit("sheet + lineup change vs season (report)", (g) => [pm(g), dRep(g)], am);
fit("market alone", (g) => [-g.spread!], am);
fit("market + player strength", (g) => [-g.spread!, sRep(g)], am);
fit("(lookahead) sheet + strength with actual lineups", (g) => [pm(g), sAct(g)], am);

console.log("\n4. CONFIDENCE (leave one season out)");
function prob(name: string, x: (g: G) => number[], y: (g: G) => number | null) {
  const preds: { p: number; y: number; base: number; s: number }[] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s && y(g) != null), te = D.filter((g) => g.season === s && y(g) != null);
    const m = fitLogit(tr.map(x), tr.map((g) => y(g)!)), b0 = mean(tr.map((g) => y(g)!));
    for (const g of te) preds.push({ p: predictLogit(m, x(g)), y: y(g)!, base: b0, s });
  }
  const pick = preds.map((q) => ({ c: Math.max(q.p, 1 - q.p), h: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, s: q.s })).sort((a, b) => b.c - a.c);
  const top = (f: number) => pct(mean(pick.slice(0, Math.round(pick.length * f)).map((q) => q.h)));
  console.log(`  ${name.padEnd(62)} skill ${((mean(preds.map((q) => (q.base - q.y) ** 2)) - mean(preds.map((q) => (q.p - q.y) ** 2))) * 1e4).toFixed(1).padStart(6)}bp  hit ${pct(mean(pick.map((q) => q.h)))} [${seasons.map((s) => pct(mean(pick.filter((q) => q.s === s).map((q) => q.h)))).join(" ")}]  top10 ${top(0.1)}  top5 ${top(0.05)}`);
}
const cover = (g: G) => (am(g) + g.spread! === 0 ? null : am(g) + g.spread! > 0 ? 1 : 0);
const win = (g: G) => (am(g) === 0 ? null : am(g) > 0 ? 1 : 0);
const over = (g: G) => (g.finalHome! + g.finalAway! === g.total! ? null : g.finalHome! + g.finalAway! > g.total! ? 1 : 0);
prob("ATS current: sheet edge, cover10, record luck", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("ATS: + report injuries in edge", (g) => [pm(g) + 0.6 * vRep(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("ATS: player-strength edge", (g) => [sRep(g) + 1.5 + g.spread!, g.cover10, g.recordLuck], cover);
prob("ATS: sheet edge + player-strength edge", (g) => [pm(g) + g.spread!, sRep(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("ATS: blended (0.5 sheet + 0.5 strength) edge", (g) => [0.5 * pm(g) + 0.5 * (sRep(g) + 1.5) + g.spread!, g.cover10, g.recordLuck], cover);
prob("WIN current: market, record luck", (g) => [-g.spread!, g.recordLuck], win);
prob("WIN: + player strength", (g) => [-g.spread!, g.recordLuck, sRep(g)], win);
prob("O/U current: 3P luck", (g) => [g.shot3made, g.shot3allowed], over);
prob("O/U: + report injuries both teams", (g) => [g.shot3made, g.shot3allowed, g.h!.rep_vorp + g.a!.rep_vorp], over);
