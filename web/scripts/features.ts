// Per-game features for the confidence models, built in date order so every value
// uses only information from before that game.
//   cover10    home minus away: average cover margin over each team's last 10 games
//   recordLuck home minus away: win% above what the point differential implies
//   shot3      sum over both teams of (YTD 3P% - last season's), made and allowed,
//              shrunk toward 0 over the first 20 games
//   edge       sheet projected home margin + home spread (> 0: sheet likes home)
//   tEdge      sheet projected total - total line

import type { InputDay } from "./backtest-core";

export type GameFeatures = {
  game_id: string;
  season: number;
  date: string;
  home: string;
  away: string;
  homeId: string;
  awayId: string;
  spread: number | null;
  total: number | null;
  projHome: number | null;
  projAway: number | null;
  finalHome: number | null;
  finalAway: number | null;
  homeGames: number;
  awayGames: number;
  cover10: number;
  recordLuck: number;
  shot3made: number;
  shot3allowed: number;
};

type TeamState = { cover: number[]; margins: number[]; wins: number };

export function buildFeatures(
  days: InputDay[],
  lines: Map<string, { spread: number | null; total: number | null }>,
  projections: Map<string, { home: number; away: number }>,
): GameFeatures[] {
  const out: GameFeatures[] = [];
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let season = 0;
  let state = new Map<string, TeamState>();
  const T = (id: string) => {
    if (!state.has(id)) state.set(id, { cover: [], margins: [], wins: 0 });
    return state.get(id)!;
  };
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const recordLuck = (t: TeamState) => (t.margins.length < 5 ? 0 : t.wins / t.margins.length - (0.5 + avg(t.margins) * 0.033));

  for (const d of sorted) {
    if (d.season !== season) {
      state = new Map();
      season = d.season;
    }
    const luck = (id: string, k: string) => {
      const t = d.teams[id];
      const y = t?.YTD.stats[k] ?? null;
      const p = t?.Prior.stats[k] ?? null;
      return y == null || p == null ? 0 : (y - p) * Math.min(1, (t?.YTD.games ?? 0) / 20);
    };
    for (const g of d.games) {
      const l = lines.get(g.game_id);
      const p = projections.get(g.game_id);
      out.push({
        game_id: g.game_id, season: d.season, date: d.date, home: g.home.abbr, away: g.away.abbr,
        homeId: g.home.id, awayId: g.away.id,
        spread: l?.spread ?? null, total: l?.total ?? null,
        projHome: p?.home ?? null, projAway: p?.away ?? null,
        finalHome: g.home.final ?? null, finalAway: g.away.final ?? null,
        homeGames: d.teams[g.home.id]?.YTD.games ?? 0, awayGames: d.teams[g.away.id]?.YTD.games ?? 0,
        cover10: avg(T(g.home.id).cover.slice(-10)) - avg(T(g.away.id).cover.slice(-10)),
        recordLuck: recordLuck(T(g.home.id)) - recordLuck(T(g.away.id)),
        shot3made: luck(g.home.id, "3 Point %") + luck(g.away.id, "3 Point %"),
        shot3allowed: luck(g.home.id, "Opp. 3 Point %") + luck(g.away.id, "Opp. 3 Point %"),
      });
    }
    // Update team state with the day's results.
    for (const g of d.games) {
      if (g.home.final == null || g.away.final == null) continue;
      const m = g.home.final - g.away.final;
      const l = lines.get(g.game_id);
      for (const [id, sign] of [[g.home.id, 1], [g.away.id, -1]] as [string, number][]) {
        const t = T(id);
        t.margins.push(sign * m);
        if (sign * m > 0) t.wins++;
        if (l?.spread != null) t.cover.push(sign * (m + l.spread));
      }
    }
  }
  return out;
}
