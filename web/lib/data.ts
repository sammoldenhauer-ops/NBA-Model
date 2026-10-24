import fs from "node:fs";
import path from "node:path";

// JSON written by the pipeline (pipeline/export.R, pipeline/stats_export.R). Read at
// build time; a new commit redeploys.
const DATA_DIR = path.join(process.cwd(), "public", "data");

import { WINDOWS, type WindowName } from "./windows";
export { WINDOWS, type WindowName };

export type StatFormat = "dec1" | "dec2" | "dec3" | "pct";
export type StatMeta = { id: string; label: string; fmt: StatFormat };

export type StatValues = Record<string, number | null>;
export type TeamInputs = Record<WindowName, { games: number; stats: StatValues }>;

export type Team = {
  id: string;
  abbr: string;
  name: string;
  color: string | null;
  logo: string | null;
  final: number | null;
};

export type Line = { home_spread: number; total: number | null; home_ml: number | null; away_ml: number | null; provider: string | null };

export type Game = {
  game_id: string;
  tip_time: string;
  status: string;
  neutral: boolean;
  home: Team;
  away: Team;
  line?: Line | null;
};

// One slate: the games and the stat inputs as of that date (games before it).
export type Slate = {
  date: string;
  season: number;
  generated_at: string;
  games: Game[];
  teams: Record<string, TeamInputs>;
  league: Record<WindowName, StatValues>;
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
  stats: StatMeta[];
  windows: string[];
  team_stats: StatsRow[];
  league_averages: StatsRow[];
};

export function getStats(): StatsData | null {
  return readJson<StatsData>(path.join("stats", "stats.json"));
}

// Stat names and formats, for pickers and tables.
export function getStatList(): StatMeta[] {
  return getStats()?.stats ?? [];
}

// Confidence report and per-game confidence (web/scripts/confidence.ts).
import type { GameConfidence, Validation } from "./confidence";
export type ConfidenceFile = {
  generated_at: string;
  model_hash: string;
  seasons: number[];
  validation: Validation[];
  accuracy: Record<string, number>;
  bands: { margin: number[]; total: number[] }[];
};
export type ConfidenceGames = { model_hash: string; games: Record<string, GameConfidence> };
export function getConfidence(): ConfidenceFile | null {
  return readJson<ConfidenceFile>("confidence.json");
}
export function getConfidenceGames(): ConfidenceGames | null {
  return readJson<ConfidenceGames>("confidence_games.json");
}
