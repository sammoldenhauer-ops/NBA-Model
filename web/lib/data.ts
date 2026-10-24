import fs from "node:fs";
import path from "node:path";

// JSON written by pipeline/export.R. Read at build time; a new commit redeploys.
const DATA_DIR = path.join(process.cwd(), "public", "data");

export type WindowKey = "ytd" | "l3" | "ha" | "prior";
export const WINDOW_KEYS: WindowKey[] = ["ytd", "l3", "ha", "prior"];

export type WindowValue = {
  team: number | null;
  lg: number | null;
  diff: number | null;
  n: number | null;
};

export type StatSide = {
  windows: Record<WindowKey, WindowValue>;
  weighted_team: number | null;
  weighted_lg: number | null;
  weight_sum: number;
  adj: number | null;
  expected: number | null;
};

export type StatFormat = "dec1" | "dec2" | "dec3" | "pct";

export type StatRow = {
  id: string;
  label: string;
  fmt: StatFormat;
  weights: Record<WindowKey, number>;
  mirror: string | null;
  home: StatSide;
  away: StatSide;
};

export type Team = {
  id: string;
  abbr: string;
  name: string;
  color: string | null;
  logo: string | null;
  final: number | null;
};

export type Lines = { fga: number; fg3a: number; fta: number; ast: number; tov: number };

export type Game = {
  game_id: string;
  tip_time: string;
  status: string;
  neutral: boolean;
  home: Team;
  away: Team;
  projection: {
    home_score: number;
    away_score: number;
    home_spread: number;
    away_spread: number;
    total: number;
    raw_home: number;
    raw_away: number;
    possessions: number;
  };
  lines: { home: Lines; away: Lines };
  stats: StatRow[];
};

export type Slate = {
  date: string;
  season: number;
  generated_at: string;
  settings: { missing_window: string; expected_formula: string; league_avg: string; rate_method: string };
  games: Game[];
};

function readJson<T>(file: string): T | null {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

export function getDates(): string[] {
  return readJson<{ dates: string[] }>("index.json")?.dates ?? [];
}

export function getSlate(date: string): Slate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return readJson<Slate>(`${date}.json`);
}

export function getLatest(): Slate | null {
  return readJson<Slate>("latest.json");
}

export function getGame(date: string, gameId: string): { slate: Slate; game: Game } | null {
  const slate = getSlate(date);
  const game = slate?.games.find((g) => g.game_id === gameId);
  return slate && game ? { slate, game } : null;
}

// Raw stat tables written by pipeline/stats_export.R.
export type StatsRow = Record<string, string | number | null>;

export type StatsData = {
  as_of: string;
  season: number;
  generated_at: string;
  league_avg: string;
  rate_method: string;
  stats: { id: string; label: string; fmt: StatFormat }[];
  windows: string[];
  team_stats: StatsRow[];
  league_averages: StatsRow[];
};

export function getStats(): StatsData | null {
  return readJson<StatsData>(path.join("stats", "stats.json"));
}
