// Shared backtest plumbing: load point-in-time inputs and lines, run a Model sheet
// over every historical game.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Slate, TeamInjury } from "../lib/data";
import { scoreGame, slateSource, type SheetModel } from "../lib/sheet";

export const CACHE = path.join("..", "pipeline", "cache");

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
  home_games: number;
  away_games: number;
};

export function loadLabels(): string[] {
  return JSON.parse(fs.readFileSync(path.join("public", "data", "stats", "stats.json"), "utf8")).stats.map((s: { label: string }) => s.label);
}

export function loadLines(): Map<string, { spread: number | null; total: number | null }> {
  const lines = new Map<string, { spread: number | null; total: number | null }>();
  const [head, ...body] = fs.readFileSync(path.join(CACHE, "lines.csv"), "utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.replace(/"/g, ""));
  const num = (v: string | undefined) => (v == null || v === "" || v === "NA" ? null : Number(v));
  for (const line of body) {
    const v = line.split(",").map((c) => c.replace(/"/g, ""));
    const row = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
    lines.set(row.game_id, { spread: num(row.home_spread), total: num(row.total) });
  }
  return lines;
}

export type InputDay = Slate & { season: number };

// Actual absences per team-game (pipeline/injuries.R), keyed "game_id|team_id".
export function loadInjuries(): Map<string, TeamInjury> {
  const out = new Map<string, TeamInjury>();
  for (const f of fs.readdirSync(CACHE).filter((x) => /^injuries_\d+\.csv\.gz$/.test(x))) {
    const [head, ...rows] = zlib.gunzipSync(fs.readFileSync(path.join(CACHE, f))).toString("utf8").trim().split(/\r?\n/);
    const cols = head.split(",").map((c) => c.replace(/"/g, ""));
    for (const line of rows) {
      const v = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, ""));
      const o = Object.fromEntries(cols.map((c, i) => [c, v[i]]));
      out.set(`${o.game_id}|${o.team_id}`, {
        value: +o.vorp, bpm: +o.sam, minutes: +o.out_min, count: +o.out_n,
        names: (o.out_names ?? "").replace(/; /g, ", "), dtd: "", source: "played",
      });
    }
  }
  return out;
}

export function loadInputs(withInjuries = true): InputDay[] {
  const days: InputDay[] = [];
  const inj = withInjuries ? loadInjuries() : new Map<string, TeamInjury>();
  for (const f of fs.readdirSync(CACHE).filter((x) => /^inputs_\d+\.ndjson\.gz$/.test(x)).sort()) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(CACHE, f))).toString("utf8");
    for (const l of text.split("\n")) {
      if (!l.trim()) continue;
      const d = JSON.parse(l) as InputDay;
      d.injuries = {};
      for (const g of d.games) {
        for (const id of [g.home.id, g.away.id]) {
          const x = inj.get(`${g.game_id}|${id}`);
          if (x) d.injuries[id] = x;
        }
      }
      days.push(d);
    }
  }
  return days;
}

export function runModel(model: SheetModel, days: InputDay[], lines: ReturnType<typeof loadLines>, labels: string[]): BacktestRow[] {
  const rows: BacktestRow[] = [];
  for (const day of days) {
    for (const g of day.games) {
      const game = {
        ...g, tip_time: "", status: "", neutral: false,
        home: { ...g.home, name: g.home.abbr, color: null, logo: null },
        away: { ...g.away, name: g.away.abbr, color: null, logo: null },
      };
      const r = scoreGame(model, slateSource(day, game), labels);
      if (r.home_score == null || r.away_score == null || g.home.final == null || g.away.final == null) continue;
      const l = lines.get(g.game_id);
      rows.push({
        season: day.season, date: day.date, game_id: g.game_id, home: g.home.abbr, away: g.away.abbr,
        proj_home: r.home_score, proj_away: r.away_score, actual_home: g.home.final, actual_away: g.away.final,
        line_spread: l?.spread ?? null, line_total: l?.total ?? null,
        home_games: day.teams[g.home.id]?.YTD.games ?? 0, away_games: day.teams[g.away.id]?.YTD.games ?? 0,
      });
    }
  }
  return rows;
}
