// Round 7: why does the sheet underrate favourites? Export every game's pieces of the
// sheet's home margin so they can be compared with the book and the result.
//   cd web && npx tsx scripts/research7.ts   -> ../pipeline/cache/components.csv
//
// Per game: the sheet's stat margin (B237) under the published weights and under each
// window alone (YTD / L3 / H/A / Prior), the player-based margin (B236), lineup
// strengths, injury value lost, the final projection, the book line and the result.

import fs from "node:fs";
import path from "node:path";
import type { SheetModel } from "../lib/sheet";
import { scoreGame, slateSource } from "../lib/sheet";
import { CACHE, loadInputs, loadLabels, loadLines } from "./backtest-core";
import { setSchedule, STAGES, type Weights } from "./weights-schedule";

const model = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const only = (i: number): SheetModel => {
  const m = JSON.parse(JSON.stringify(model)) as SheetModel;
  setSchedule(m, STAGES.map(() => [0, 1, 2, 3].map((j) => (j === i ? 100 : 0)) as Weights));
  return m;
};
const variants = { ytd: only(0), l3: only(1), ha: only(2), prior: only(3) };

const days = loadInputs();
const lines = loadLines();
const labels = loadLabels();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const cols = ["season", "date", "game_id", "home", "away", "hg", "ag", "fh", "fa", "spread", "total", "ph", "pa",
  "stat", "player", "str_h", "str_a", "inj_h", "inj_a", "injn_h", "injn_a", "pace", "stat_ytd", "stat_l3", "stat_ha", "stat_prior"];
const out: string[] = [cols.join(",")];
const t0 = Date.now();
for (const day of days) {
  for (const g of day.games) {
    if (g.home.final == null || g.away.final == null) continue;
    const game = { ...g, tip_time: "", status: "", neutral: false,
      home: { ...g.home, name: g.home.abbr, color: null, logo: null }, away: { ...g.away, name: g.away.abbr, color: null, logo: null } };
    const src = slateSource(day, game);
    const r = scoreGame(model, src, labels);
    if (r.home_score == null) continue;
    const v = (a: string) => num(r.get(a).value);
    const w = Object.fromEntries(Object.entries(variants).map(([k, m]) => [k, num(scoreGame(m, src, labels).get("B237").value)]));
    const l = lines.get(g.game_id);
    const row = [day.season, day.date, g.game_id, g.home.abbr, g.away.abbr,
      day.teams[g.home.id]?.YTD.games ?? 0, day.teams[g.away.id]?.YTD.games ?? 0, g.home.final, g.away.final,
      l?.spread ?? null, l?.total ?? null, r.home_score, r.away_score,
      v("B237"), v("B236"), v("B235"), v("C235"), v("B224"), v("C224"), v("B222"), v("C222"), v("K12"),
      w.ytd, w.l3, w.ha, w.prior];
    out.push(row.map((x) => (x == null ? "" : typeof x === "number" ? Number(x.toFixed(4)) : x)).join(","));
  }
}
fs.writeFileSync(path.join(CACHE, "components.csv"), out.join("\n") + "\n");
console.log(`${out.length - 1} games in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
