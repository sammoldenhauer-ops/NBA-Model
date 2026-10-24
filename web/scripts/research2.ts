// Round 2: features the market might not fully price.
//   cd web && npx tsx scripts/research2.ts
import fs from "node:fs";
import { fitLogit, predictLogit, earliness } from "../lib/confidence";
import type { SheetModel } from "../lib/sheet";
import { loadInputs, loadLabels, loadLines, runModel, type InputDay } from "./backtest-core";

const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const days = [...loadInputs()].sort((a, b) => a.date.localeCompare(b.date));
const lines = loadLines();
const proj = new Map(runModel(model, days, lines, loadLabels()).map((r) => [r.game_id, r]));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

type Row = Record<string, number> & { season: number };
const data: Row[] = [];

// Elo with margin of victory (538-style), carried across seasons with regression.
const elo = new Map<string, number>();
const ELO_HFA = 70, K = 20;
let season = 0;
// Per-team running state within a season.
type TS = { dates: string[]; homeAway: string[]; cover: number[]; margins: number[]; wins: number };
let st = new Map<string, TS>();
const T = (id: string) => { if (!st.has(id)) st.set(id, { dates: [], homeAway: [], cover: [], margins: [], wins: 0 }); return st.get(id)!; };
const ALT = new Set(["7", "26"]); // DEN, UTAH (ESPN ids)

for (const d of days as InputDay[]) {
  if (d.season !== season) {
    for (const [k, v] of elo) elo.set(k, 0.75 * v + 0.25 * 1505);
    st = new Map();
    season = d.season;
  }
  const todays: { g: InputDay["games"][number]; row: Row | null }[] = [];
  for (const g of d.games) {
    const p = proj.get(g.game_id);
    const l = lines.get(g.game_id);
    const h = g.home.id, a = g.away.id;
    const eh = elo.get(h) ?? 1505, ea = elo.get(a) ?? 1505;
    const th = T(h), ta = T(a);
    const ti = d.teams[h], ta2 = d.teams[a];
    const val = (t: typeof ti, w: "YTD" | "Prior", k: string) => t?.[w]?.stats[k] ?? null;
    const lg = (w: "YTD" | "Prior", k: string) => d.league[w]?.[k] ?? null;
    let row: Row | null = null;
    if (p && l?.spread != null && l.total != null && g.home.final != null && g.away.final != null) {
      const rest = (t: TS) => (t.dates.length ? Math.min(4, dayDiff(d.date, t.dates[t.dates.length - 1])) : 4);
      const in4 = (t: TS) => t.dates.filter((x) => dayDiff(d.date, x) <= 3).length;
      const streak = (t: TS, ha: string) => { let n = 0; for (let i = t.homeAway.length - 1; i >= 0 && t.homeAway[i] === ha; i--) n++; return n; };
      const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
      const gp = Math.min(ti?.YTD.games ?? 0, ta2?.YTD.games ?? 0);
      // Shooting luck: YTD 3P% minus last season's, shrunk by games played.
      const luckN = (t: typeof ti, k: string, n: number, w: "YTD" | "L3" = "YTD", ref: "Prior" | "league" = "Prior") => {
        const y = w === "YTD" ? val(t, "YTD", k) : (t?.L3?.stats[k] ?? null);
        const pr = ref === "Prior" ? val(t, "Prior", k) : lg("Prior", k);
        return y == null || pr == null ? 0 : (y - pr) * Math.min(1, (t?.YTD.games ?? 0) / n);
      };
      const luck = (t: typeof ti, k: string) => luckN(t, k, 20);
      // Record vs point differential: wins above what the margin implies.
      const pyth = (t: TS) => (t.margins.length < 5 ? 0 : t.wins / t.margins.length - (0.5 + avg(t.margins) * 0.033));
      const ytdPts = (t: typeof ti) => (val(t, "YTD", "Points/Game") ?? val(t, "Prior", "Points/Game") ?? 110);
      const ytdOpp = (t: typeof ti) => (val(t, "YTD", "Opp. Points/Game") ?? val(t, "Prior", "Opp. Points/Game") ?? 110);
      const pace = (t: typeof ti) => (val(t, "YTD", "Poss./Game") ?? val(t, "Prior", "Poss./Game") ?? 100);
      const lgPace = lg("YTD", "Poss./Game") ?? lg("Prior", "Poss./Game") ?? 100;
      row = {
        season: d.season,
        month: Number(d.date.slice(5, 7)),
        playoffs: d.date.slice(5, 7) >= "04" && d.date.slice(5, 7) <= "06" && dayDiff(d.date, `${d.date.slice(0, 4)}-04-16`) >= 0 ? 1 : 0,
        gp, early: earliness(ti?.YTD.games ?? 0, ta2?.YTD.games ?? 0),
        s: l.spread, T: l.total,
        pm: p.proj_home - p.proj_away, pt: p.proj_home + p.proj_away,
        am: g.home.final - g.away.final, at: g.home.final + g.away.final,
        eloM: (eh + ELO_HFA - ea) / 28,
        rh: rest(th), ra: rest(ta), b2bh: rest(th) === 1 ? 1 : 0, b2ba: rest(ta) === 1 ? 1 : 0,
        g4h: in4(th), g4a: in4(ta),
        roadTrip: streak(ta, "away"), homeStand: streak(th, "home"),
        alt: ALT.has(h) ? 1 : 0,
        coverH: avg(th.cover.slice(-10)), coverA: avg(ta.cover.slice(-10)),
        lux3h: luck(ti, "3 Point %"), lux3a: luck(ta2, "3 Point %"),
        l3_10: luckN(ti, "3 Point %", 10) + luckN(ta2, "3 Point %", 10) + luckN(ti, "Opp. 3 Point %", 10) + luckN(ta2, "Opp. 3 Point %", 10),
        l3_40: luckN(ti, "3 Point %", 40) + luckN(ta2, "3 Point %", 40) + luckN(ti, "Opp. 3 Point %", 40) + luckN(ta2, "Opp. 3 Point %", 40),
        l3_lg: luckN(ti, "3 Point %", 20, "YTD", "league") + luckN(ta2, "3 Point %", 20, "YTD", "league") + luckN(ti, "Opp. 3 Point %", 20, "YTD", "league") + luckN(ta2, "Opp. 3 Point %", 20, "YTD", "league"),
        l3_L3: luckN(ti, "3 Point %", 20, "L3") + luckN(ta2, "3 Point %", 20, "L3") + luckN(ti, "Opp. 3 Point %", 20, "L3") + luckN(ta2, "Opp. 3 Point %", 20, "L3"),
        ftLux: luck(ti, "FT%") + luck(ta2, "FT%"),
        efgLux: luck(ti, "EFG%") + luck(ta2, "EFG%") + luck(ti, "Opp. EFG%") + luck(ta2, "Opp. EFG%"),
        cov5: avg(th.cover.slice(-5)) - avg(ta.cover.slice(-5)),
        covS: avg(th.cover) - avg(ta.cover),
        covRate: (th.cover.length ? th.cover.filter((x) => x > 0).length / th.cover.length : 0.5) - (ta.cover.length ? ta.cover.filter((x) => x > 0).length / ta.cover.length : 0.5),
        luxO3h: luck(ti, "Opp. 3 Point %"), luxO3a: luck(ta2, "Opp. 3 Point %"),
        pythH: pyth(th), pythA: pyth(ta),
        scoreTot: (ytdPts(ti) + ytdOpp(ta2) + ytdPts(ta2) + ytdOpp(ti)) / 2,
        paceSum: pace(ti) + pace(ta2) - 2 * lgPace,
      };
      data.push(row);
    }
    todays.push({ g, row });
  }
  // Update state after the day's games.
  for (const { g } of todays) {
    if (g.home.final == null || g.away.final == null) continue;
    const h = g.home.id, a = g.away.id, m = g.home.final - g.away.final;
    const eh = elo.get(h) ?? 1505, ea = elo.get(a) ?? 1505;
    const diff = eh + ELO_HFA - ea;
    const exp = 1 / (1 + 10 ** (-diff / 400));
    const mult = ((Math.abs(m) + 3) ** 0.8) / (7.5 + 0.006 * (m > 0 ? diff : -diff));
    const delta = K * mult * ((m > 0 ? 1 : 0) - exp);
    elo.set(h, eh + delta);
    elo.set(a, ea - delta);
    const l = lines.get(g.game_id);
    for (const [id, sign, ha] of [[h, 1, "home"], [a, -1, "away"]] as [string, number, string][]) {
      const t = T(id);
      t.dates.push(d.date);
      t.homeAway.push(ha);
      t.margins.push(sign * m);
      if (sign * m > 0) t.wins++;
      if (l?.spread != null) t.cover.push(sign * (m + l.spread));
    }
  }
}
const seasons = [...new Set(data.map((d) => d.season))].filter((s) => s >= 2024 && s <= 2026).sort();
const D = data.filter((d) => seasons.includes(d.season));
console.log(`${D.length} games, seasons ${seasons.join(", ")}`);

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

type Y = (d: Row) => number | null;
function evalProb(name: string, feats: (d: Row) => number[], y: Y, trainSeasons: number[][], testSeasons: number[]) {
  const preds: { p: number; y: number; season: number; base: number }[] = [];
  testSeasons.forEach((s, i) => {
    const tr = D.filter((d) => trainSeasons[i].includes(d.season) && y(d) != null);
    const te = D.filter((d) => d.season === s && y(d) != null);
    const m = fitLogit(tr.map(feats), tr.map((d) => y(d)!), 5);
    const base = mean(tr.map((d) => y(d)!));
    for (const d of te) preds.push({ p: predictLogit(m, feats(d)), y: y(d)!, season: s, base });
  });
  const brier = mean(preds.map((q) => (q.p - q.y) ** 2));
  const brier0 = mean(preds.map((q) => (q.base - q.y) ** 2));
  const pick = preds.map((q) => ({ conf: Math.max(q.p, 1 - q.p), hit: (q.p >= 0.5 ? 1 : 0) === q.y ? 1 : 0, season: q.season }));
  const top = (frac: number) => { const xs = [...pick].sort((a, b) => b.conf - a.conf).slice(0, Math.round(pick.length * frac)); return `${pct(mean(xs.map((q) => q.hit)))}`; };
  const per = testSeasons.map((s) => pct(mean(pick.filter((q) => q.season === s).map((q) => q.hit)))).join(" ");
  return { name, skill: (brier0 - brier) * 1e4, hit: mean(pick.map((q) => q.hit)), per, top20: top(0.2), top10: top(0.1), top5: top(0.05), n: pick.length };
}
const loso = { train: seasons.map((s) => seasons.filter((x) => x !== s)), test: seasons };
const strict = { train: [[2024, 2025]], test: [2026] };

function suite(title: string, y: Y, sets: [string, (d: Row) => number[]][]) {
  console.log(`\n${title}`);
  console.log("  " + "features".padEnd(40) + "LOSO skill  hit    [per season]          top20%  top10%  top5%   | strict 2026: skill  hit    top10%");
  for (const [name, f] of sets) {
    const a = evalProb(name, f, y, loso.train, loso.test);
    const b = evalProb(name, f, y, strict.train, strict.test);
    console.log(`  ${name.padEnd(40)}${a.skill.toFixed(1).padStart(8)}bp ${pct(a.hit)} [${a.per}]  ${a.top20.padStart(6)}  ${a.top10.padStart(6)}  ${a.top5.padStart(6)}  | ${b.skill.toFixed(1).padStart(8)}bp ${pct(b.hit)}  ${b.top10}`);
  }
}

const edge = (d: Row) => d.pm + d.s;
const luck3 = (d: Row) => d.lux3h + d.lux3a + d.luxO3h + d.luxO3a;
suite("OVER / UNDER refinements", (d) => (d.at === d.T ? null : d.at > d.T ? 1 : 0), [
  ["3P luck (made + allowed), shrink 20 gm", (d) => [d.lux3h + d.lux3a, d.luxO3h + d.luxO3a]],
  ["3P luck combined into one number", (d) => [luck3(d)]],
  ["3P luck, shrink 10 gm", (d) => [d.l3_10]],
  ["3P luck, shrink 40 gm", (d) => [d.l3_40]],
  ["3P luck vs league avg (not own prior)", (d) => [d.l3_lg]],
  ["3P luck using last 3 games", (d) => [d.l3_L3]],
  ["3P luck + FT% luck", (d) => [luck3(d), d.ftLux]],
  ["eFG% luck (made + allowed)", (d) => [d.efgLux]],
  ["3P luck + sheet total edge", (d) => [luck3(d), d.pt - d.T]],
  ["3P luck + line size", (d) => [luck3(d), d.T]],
]);
suite("AGAINST THE SPREAD refinements", (d) => (d.am + d.s === 0 ? null : d.am + d.s > 0 ? 1 : 0), [
  ["cover margin, last 10", (d) => [d.coverH - d.coverA]],
  ["cover margin, last 5", (d) => [d.cov5]],
  ["cover margin, season", (d) => [d.covS]],
  ["cover rate, season", (d) => [d.covRate]],
  ["cover last 10 + record vs diff", (d) => [d.coverH - d.coverA, d.pythH - d.pythA]],
  ["cover last 10 + record vs diff + sheet edge", (d) => [d.coverH - d.coverA, d.pythH - d.pythA, edge(d)]],
  ["cover season + record vs diff", (d) => [d.covS, d.pythH - d.pythA]],
  ["+ 3P luck difference", (d) => [d.coverH - d.coverA, d.pythH - d.pythA, d.lux3h - d.lux3a - d.luxO3h + d.luxO3a]],
]);

// Direction check for the two signals (fit on all three seasons).
const dir = (name: string, f: (d: Row) => number[], y: Y) => {
  const tr = D.filter((d) => y(d) != null);
  const m = fitLogit(tr.map(f), tr.map((d) => y(d)!), 5);
  console.log(`  ${name}: standardized coefficients ${m.coef.slice(1).map((c) => c.toFixed(3)).join(", ")} (intercept ${m.coef[0].toFixed(3)})`);
};
console.log("\nDirections");
dir("over ~ 3P luck made, allowed", (d) => [d.lux3h + d.lux3a, d.luxO3h + d.luxO3a], (d) => (d.at === d.T ? null : d.at > d.T ? 1 : 0));
dir("home covers ~ cover margin diff, record vs diff", (d) => [d.coverH - d.coverA, d.pythH - d.pythA], (d) => (d.am + d.s === 0 ? null : d.am + d.s > 0 ? 1 : 0));
