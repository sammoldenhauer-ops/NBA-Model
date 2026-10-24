// Round 3: injury / availability adjustments. Leave-one-season-out throughout.
//   cd web && npx tsx scripts/research3.ts
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fitLogit, predictLogit } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { CACHE, loadInputs, loadLabels, loadLines, runModel } from "./backtest-core";
import { buildFeatures } from "./features";

type Inj = { out_n: number; out_min: number; sam: number; vorp: number; pm_vorp: number; lineup_delta: number };
const inj = new Map<string, Inj>();
for (const f of fs.readdirSync(CACHE).filter((x) => /^injuries_\d+\.csv\.gz$/.test(x))) {
  const [head, ...rows] = zlib.gunzipSync(fs.readFileSync(path.join(CACHE, f))).toString("utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.replace(/"/g, ""));
  for (const line of rows) {
    const v = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, ""));
    const o = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    inj.set(`${o.game_id}|${o.team_id}`, { out_n: +o.out_n, out_min: +o.out_min, sam: +o.sam, vorp: +o.vorp, pm_vorp: +o.pm_vorp, lineup_delta: +o.lineup_delta });
  }
}

const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = loadInputs();
const lines = loadLines();
const rows = runModel(model, days, lines, loadLabels());
const proj = new Map(rows.map((r) => [r.game_id, { home: r.proj_home, away: r.proj_away }]));
const feats = buildFeatures(days, lines, proj);

const Z: Inj = { out_n: 0, out_min: 0, sam: 0, vorp: 0, pm_vorp: 0, lineup_delta: 0 };
const D = feats
  .filter((g) => g.season >= 2024 && g.season <= 2026 && g.spread != null && g.total != null && g.projHome != null && g.finalHome != null)
  .map((g) => ({ ...g, h: inj.get(`${g.game_id}|${g.homeId}`) ?? Z, a: inj.get(`${g.game_id}|${g.awayId}`) ?? Z }));
console.log(`${D.length} games; injury rows matched for ${D.filter((d) => d.h !== Z).length} home teams`);
type G = (typeof D)[number];
const seasons = [2024, 2025, 2026];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pm = (g: G) => g.projHome! - g.projAway!;
const pt = (g: G) => g.projHome! + g.projAway!;
const am = (g: G) => g.finalHome! - g.finalAway!;
const at = (g: G) => g.finalHome! + g.finalAway!;

// Margin adjustments (home perspective): positive = good for home.
const ADJ: [string, (g: G) => number][] = [
  ["none", () => 0],
  ["Sam: full BPM swing (BPM/2 off team, /2 to opponent)", (g) => -g.h.sam + g.a.sam],
  ["Sam, but half (BPM/2 net swing)", (g) => (-g.h.sam + g.a.sam) / 2],
  ["minutes-scaled value over replacement", (g) => -g.h.vorp + g.a.vorp],
  ["plus-minus rating, minutes-scaled", (g) => -g.h.pm_vorp + g.a.pm_vorp],
  ["lineup strength vs season baseline", (g) => g.h.lineup_delta - g.a.lineup_delta],
  ["missing minutes only (no ratings)", (g) => -(g.h.out_min - g.a.out_min) / 48],
];

console.log("\nMARGIN: average miss of sheet + adjustment (points) — as is, and with the scale fit on the other seasons");
console.log("  " + "method".padEnd(56) + "as is    fit     scale    [per held-out season]");
for (const [name, f] of ADJ) {
  const raw = mean(D.map((g) => Math.abs(am(g) - pm(g) - f(g))));
  const errs: number[] = [];
  const per: string[] = [];
  const scales: number[] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s);
    const x = tr.map(f), y = tr.map((g) => am(g) - pm(g));
    const mx = mean(x), my = mean(y);
    const vx = mean(x.map((v) => (v - mx) ** 2));
    const k = vx > 0 ? mean(x.map((v, i) => (v - mx) * (y[i] - my))) / vx : 0;
    scales.push(k);
    const te = D.filter((g) => g.season === s);
    const e = te.map((g) => Math.abs(am(g) - pm(g) - (my - k * mx) - k * f(g)));
    errs.push(...e);
    per.push(mean(e).toFixed(2));
  }
  console.log(`  ${name.padEnd(56)}${raw.toFixed(3).padStart(6)}  ${mean(errs).toFixed(3)}  ${mean(scales).toFixed(2).padStart(6)}   [${per.join(" ")}]`);
}
console.log(`  (sportsbook line: ${mean(D.map((g) => Math.abs(am(g) + g.spread!))).toFixed(3)})`);

// Does the market already price absences? Regress what the market missed on them.
console.log("\nDOES THE MARKET PRICE INJURIES? (actual margin minus market margin ~ adjustment; scale 0 = fully priced)");
for (const [name, f] of ADJ.slice(1)) {
  const x = D.map(f), y = D.map((g) => am(g) + g.spread!);
  const mx = mean(x), my = mean(y);
  const k = mean(x.map((v, i) => (v - mx) * (y[i] - my))) / mean(x.map((v) => (v - mx) ** 2));
  const se = Math.sqrt(mean(y.map((v, i) => (v - my - k * (x[i] - mx)) ** 2)) / (x.length * mean(x.map((v) => (v - mx) ** 2))));
  console.log(`  ${name.padEnd(56)} scale ${k.toFixed(3)} ± ${se.toFixed(3)}`);
}

console.log("\nTOTAL: does missing value lower scoring? (fit scale on other seasons)");
const TADJ: [string, (g: G) => number][] = [
  ["none", () => 0],
  ["value over replacement out, both teams", (g) => -(g.h.vorp + g.a.vorp)],
  ["lineup strength change, both teams", (g) => g.h.lineup_delta + g.a.lineup_delta],
  ["missing minutes, both teams", (g) => -(g.h.out_min + g.a.out_min) / 48],
];
for (const [name, f] of TADJ) {
  const errs: number[] = [];
  const scales: number[] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s);
    const x = tr.map(f), y = tr.map((g) => at(g) - pt(g));
    const mx = mean(x), my = mean(y);
    const vx = mean(x.map((v) => (v - mx) ** 2));
    const k = vx > 0 ? mean(x.map((v, i) => (v - mx) * (y[i] - my))) / vx : 0;
    scales.push(k);
    errs.push(...D.filter((g) => g.season === s).map((g) => Math.abs(at(g) - pt(g) - (my - k * mx) - k * f(g))));
  }
  console.log(`  ${name.padEnd(56)} ${mean(errs).toFixed(3)}  scale ${mean(scales).toFixed(2)}`);
}

// Confidence with injury information.
function prob(name: string, x: (g: G) => number[], y: (g: G) => number | null) {
  const preds: { p: number; y: number; base: number; season: number }[] = [];
  for (const s of seasons) {
    const tr = D.filter((g) => g.season !== s && y(g) != null), te = D.filter((g) => g.season === s && y(g) != null);
    const m = fitLogit(tr.map(x), tr.map((g) => y(g)!));
    const base = mean(tr.map((g) => y(g)!));
    for (const g of te) preds.push({ p: predictLogit(m, x(g)), y: y(g)!, base, season: s });
  }
  const pick = preds.map((q) => ({ conf: Math.max(q.p, 1 - q.p), hit: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, season: q.season }));
  const top = (f: number) => pct(mean([...pick].sort((a, b) => b.conf - a.conf).slice(0, Math.round(pick.length * f)).map((q) => q.hit)));
  const skill = (mean(preds.map((q) => (q.base - q.y) ** 2)) - mean(preds.map((q) => (q.p - q.y) ** 2))) * 1e4;
  console.log(`  ${name.padEnd(56)} skill ${skill.toFixed(1).padStart(6)}bp  hit ${pct(mean(pick.map((q) => q.hit)))} [${seasons.map((s) => pct(mean(pick.filter((q) => q.season === s).map((q) => q.hit)))).join(" ")}]  top20 ${top(0.2)}  top10 ${top(0.1)}  top5 ${top(0.05)}`);
}
const cover = (g: G) => (am(g) + g.spread! === 0 ? null : am(g) + g.spread! > 0 ? 1 : 0);
const over = (g: G) => (at(g) === g.total! ? null : at(g) > g.total! ? 1 : 0);
const win = (g: G) => (am(g) === 0 ? null : am(g) > 0 ? 1 : 0);
const vorpD = (g: G) => -g.h.vorp + g.a.vorp;
const lineD = (g: G) => g.h.lineup_delta - g.a.lineup_delta;
console.log("\nATS");
prob("current (edge, cover10, record luck)", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("+ injuries: edge uses sheet + VORP adjustment", (g) => [pm(g) + vorpD(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("+ injuries: edge uses sheet + lineup adjustment", (g) => [pm(g) + lineD(g) + g.spread!, g.cover10, g.recordLuck], cover);
prob("+ injuries as separate features", (g) => [pm(g) + g.spread!, g.cover10, g.recordLuck, vorpD(g), lineD(g)], cover);
prob("+ Sam's adjustment in the edge", (g) => [pm(g) - g.h.sam + g.a.sam + g.spread!, g.cover10, g.recordLuck], cover);
console.log("\nOVER / UNDER");
prob("current (3P luck made, allowed)", (g) => [g.shot3made, g.shot3allowed], over);
prob("+ missing value both teams", (g) => [g.shot3made, g.shot3allowed, g.h.vorp + g.a.vorp], over);
prob("+ lineup change both teams", (g) => [g.shot3made, g.shot3allowed, g.h.lineup_delta + g.a.lineup_delta], over);
console.log("\nWINNER");
prob("current (market spread, record luck)", (g) => [-g.spread!, g.recordLuck], win);
prob("+ VORP adjustment", (g) => [-g.spread!, g.recordLuck, vorpD(g)], win);
prob("+ lineup adjustment", (g) => [-g.spread!, g.recordLuck, lineD(g)], win);
prob("sheet + injuries only (no market)", (g) => [pm(g) + vorpD(g)], win);
