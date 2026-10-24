// Sam's model: rows of formulas (web/model.json), evaluated for one game at a time.
// Safe to import from client components (no filesystem access here).

import type { Game, Slate } from "./data";
import type { WindowName } from "./windows";
import { evaluate, FormulaError, mround, parse, type Node } from "./formula";

export type ModelRow = {
  name: string; // referenced by other rows, e.g. home_pts_w
  label: string; // shown on the site
  formula: string;
  round: boolean; // round the result to the nearest 0.5
  show: boolean; // show on the game page
};

export type Model = { rows: ModelRow[] };

// Rows the slate reads its projected scores from.
export const HOME_SCORE = "HOME_SCORE";
export const AWAY_SCORE = "AWAY_SCORE";

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type RowResult = { value: number | null; error: string | null; missing: string[] };

export type GameResult = {
  rows: Record<string, RowResult>; // keyed by upper-case row name
  home_score: number | null;
  away_score: number | null;
  home_spread: number | null;
  total: number | null;
};

const SIDES = ["HOME", "AWAY", "LEAGUE"];
const WINDOW_ALIASES: Record<string, WindowName | "H/A"> = {
  YTD: "YTD",
  L3: "L3",
  HOME: "Home",
  AWAY: "Away",
  PRIOR: "Prior",
  "H/A": "H/A",
  HA: "H/A",
};

export type ParsedRef = { side: "Home" | "Away" | "League"; window: WindowName | "H/A"; stat: string };

// "[Home YTD Points/Game]" -> { side: "Home", window: "YTD", stat: "Points/Game" }
export function parseRef(ref: string, statLabels: string[]): ParsedRef {
  const parts = ref.trim().split(/\s+/);
  if (parts.length < 3) throw new FormulaError(`[${ref}]: use [Side Window Stat], e.g. [Home YTD Points/Game]`);
  const side = parts[0].toUpperCase();
  if (!SIDES.includes(side)) throw new FormulaError(`[${ref}]: side must be Home, Away or League`);
  const window = WINDOW_ALIASES[parts[1].toUpperCase()];
  if (!window) throw new FormulaError(`[${ref}]: window must be YTD, L3, Home, Away, Prior or H/A`);
  const want = parts.slice(2).join(" ").toLowerCase();
  const stat = want === "games" ? "Games" : statLabels.find((l) => l.toLowerCase() === want);
  if (!stat) throw new FormulaError(`[${ref}]: unknown stat "${parts.slice(2).join(" ")}"`);
  const s = (side[0] + side.slice(1).toLowerCase()) as ParsedRef["side"];
  if (s === "League" && window === "H/A") throw new FormulaError(`[${ref}]: for League use Home or Away, not H/A`);
  if (s === "League" && stat === "Games") throw new FormulaError(`[${ref}]: League has no Games count`);
  return { side: s, window, stat };
}

export function lookupStat(slate: Slate, game: Game, r: ParsedRef): number | null {
  if (r.side === "League") return slate.league[r.window as WindowName]?.[r.stat] ?? null;
  const team = r.side === "Home" ? game.home : game.away;
  const window: WindowName = r.window === "H/A" ? (r.side === "Home" ? "Home" : "Away") : r.window;
  const w = slate.teams[team.id]?.[window];
  if (!w) return null;
  return r.stat === "Games" ? w.games : (w.stats[r.stat] ?? null);
}

const parseCache = new Map<string, Node | FormulaError>();
function parsed(formula: string): Node {
  let n = parseCache.get(formula);
  if (!n) {
    try {
      n = parse(formula);
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    parseCache.set(formula, n);
  }
  if (n instanceof FormulaError) throw n;
  return n;
}

export function evaluateGame(model: Model, slate: Slate, game: Game, statLabels: string[]): GameResult {
  const byName = new Map(model.rows.map((r) => [r.name.toUpperCase(), r]));
  const results: Record<string, RowResult> = {};
  const inProgress = new Set<string>();

  const run = (name: string): RowResult => {
    if (results[name]) return results[name];
    const row = byName.get(name);
    if (!row) return { value: null, error: `No row named ${name}`, missing: [] };
    if (inProgress.has(name)) return { value: null, error: `Circular reference through ${row.name}`, missing: [] };
    inProgress.add(name);
    const missing: string[] = [];
    let res: RowResult;
    try {
      const v = evaluate(parsed(row.formula), {
        stat: (ref) => lookupStat(slate, game, parseRef(ref, statLabels)),
        row: (other) => {
          if (!byName.has(other)) throw new FormulaError(`No row named ${other}`);
          const r = run(other);
          if (r.error) throw new FormulaError(`${byName.get(other)?.name ?? other}: ${r.error}`);
          return r.value!;
        },
        onMissing: (ref) => missing.push(ref),
      });
      if (Array.isArray(v)) throw new FormulaError("Result is a list; wrap it in SUM or SUMPRODUCT");
      if (!Number.isFinite(v)) throw new FormulaError("Result is not a number");
      res = { value: row.round ? mround(v, 0.5) : v, error: null, missing };
    } catch (e) {
      res = { value: null, error: e instanceof Error ? e.message : String(e), missing };
    }
    inProgress.delete(name);
    results[name] = res;
    return res;
  };

  model.rows.forEach((r) => run(r.name.toUpperCase()));
  const home = results[HOME_SCORE]?.value ?? null;
  const away = results[AWAY_SCORE]?.value ?? null;
  return {
    rows: results,
    home_score: home,
    away_score: away,
    home_spread: home != null && away != null ? away - home : null,
    total: home != null && away != null ? home + away : null,
  };
}
