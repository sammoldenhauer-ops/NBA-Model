// The Model sheet (web/model.json): a grid of cells laid out like Sam's Team v Team tab.
// Stat cells pull from [Home/Away/League Window Stat]; everything else is ordinary
// formulas. Evaluated once per game with that game's teams. Browser-safe.

import type { Game, Slate, StatFormat, StatsData, TeamInjury } from "./data";
import { addr, evaluate, parseAddr, parseFormula, SheetError, type Node, type Scalar } from "./sheetFormula";
import { WINDOWS, type WindowName } from "./windows";

export type CellFormat = "general" | "int" | "dec1" | "dec2" | "dec3" | "dec4" | "pct";

export type SheetModel = {
  version: 2;
  cols: number;
  rows: number;
  cells: Record<string, string>; // "B9": "=[Home YTD Poss./Game]"
  formats: Record<string, CellFormat>;
  styles: Record<string, "header" | "bold">; // by row number ("7")
  widths: Record<string, number>; // by column letter
  outputs: { home_score: string; away_score: string };
};

// ---- where stats come from -------------------------------------------------

export type Side = "Home" | "Away";
export type StatSource = {
  team: (side: Side) => { id: string; name: string; abbr: string } | null;
  stat: (side: Side, window: WindowName, label: string) => number | null;
  games: (side: Side, window: WindowName) => number;
  league: (window: WindowName, label: string) => number | null;
  injury: (side: Side) => TeamInjury | null;
};

// One game on a slate, with stats as of that slate's date.
export function slateSource(slate: Slate, game: Game): StatSource {
  const t = (s: Side) => (s === "Home" ? game.home : game.away);
  return {
    team: (s) => ({ id: t(s).id, name: t(s).name, abbr: t(s).abbr }),
    stat: (s, w, l) => slate.teams[t(s).id]?.[w]?.stats[l] ?? null,
    games: (s, w) => slate.teams[t(s).id]?.[w]?.games ?? 0,
    league: (w, l) => slate.league[w]?.[l] ?? null,
    injury: (s) => slate.injuries?.[t(s).id] ?? null,
  };
}

// Any two teams, with today's stats (the Team stats tables).
export function statsSource(stats: StatsData, homeId: string, awayId: string, injuries: Record<string, TeamInjury> | null = null): StatSource {
  const rows = new Map(stats.team_stats.map((r) => [`${r.team_id}|${r.window}`, r]));
  const lg = new Map(stats.league_averages.map((r) => [String(r.window), r]));
  const id = (s: Side) => (s === "Home" ? homeId : awayId);
  return {
    team: (s) => {
      const r = rows.get(`${id(s)}|YTD`);
      return r ? { id: id(s), name: String(r.team_name), abbr: String(r.team) } : null;
    },
    stat: (s, w, l) => {
      const v = rows.get(`${id(s)}|${w}`)?.[l];
      return typeof v === "number" ? v : null;
    },
    games: (s, w) => Number(rows.get(`${id(s)}|${w}`)?.games ?? 0),
    league: (w, l) => {
      const v = lg.get(w)?.[l];
      return typeof v === "number" ? v : null;
    },
    injury: (s) => injuries?.[id(s)] ?? null,
  };
}

// ---- stat references -------------------------------------------------------

const WINDOW_ALIASES: Record<string, WindowName | "H/A"> = {
  YTD: "YTD", L3: "L3", HOME: "Home", AWAY: "Away", PRIOR: "Prior", "H/A": "H/A", HA: "H/A",
};

// [Home YTD Points/Game] [Away H/A EFG%] [League Home Points/Game] [Home YTD Games] [Home Team]
export function resolveStat(ref: string, src: StatSource, labels: string[]): Scalar {
  const parts = ref.trim().split(/\s+/);
  const side = (parts[0] ?? "").toUpperCase();
  if (!["HOME", "AWAY", "LEAGUE"].includes(side)) throw new SheetError("#REF!", `[${ref}]: start with Home, Away or League`);
  const s = (side[0] + side.slice(1).toLowerCase()) as Side | "League";
  if (s !== "League" && parts.length === 2 && ["TEAM", "NAME", "ABBR"].includes(parts[1].toUpperCase())) {
    const t = src.team(s);
    return t ? (parts[1].toUpperCase() === "ABBR" ? t.abbr : t.name) : "";
  }
  if (s !== "League" && parts[1]?.toUpperCase() === "LINEUP") {
    // [Home Lineup Strength]: available players' ratings x projected minutes.
    const v = src.injury(s)?.strength;
    return v == null || !Number.isFinite(v) ? "--" : v;
  }
  if (s !== "League" && parts[1]?.toUpperCase() === "INJURY") {
    // [Home Injury Value|BPM|Minutes|Count|List|DTD]
    const inj = src.injury(s);
    const what = (parts[2] ?? "").toUpperCase();
    const fields: Record<string, keyof TeamInjury> = { VALUE: "value", BPM: "bpm", MINUTES: "minutes", COUNT: "count", LIST: "names", DTD: "dtd" };
    const f = fields[what];
    if (!f) throw new SheetError("#REF!", `[${ref}]: use Injury Value, BPM, Minutes, Count, List or DTD`);
    const v = inj?.[f];
    return v == null ? (f === "names" || f === "dtd" ? "" : 0) : (v as Scalar);
  }
  if (parts.length < 3) throw new SheetError("#REF!", `[${ref}]: use [Side Window Stat], e.g. [Home YTD Points/Game]`);
  const w = WINDOW_ALIASES[parts[1].toUpperCase()];
  if (!w) throw new SheetError("#REF!", `[${ref}]: window must be YTD, L3, Home, Away, Prior or H/A`);
  const want = parts.slice(2).join(" ").toLowerCase();
  const label = want === "games" ? "Games" : labels.find((l) => l.toLowerCase() === want);
  if (!label) throw new SheetError("#REF!", `[${ref}]: unknown stat "${parts.slice(2).join(" ")}"`);
  if (s === "League") {
    if (w === "H/A") throw new SheetError("#REF!", `[${ref}]: for League use Home or Away, not H/A`);
    if (label === "Games") throw new SheetError("#REF!", `[${ref}]: League has no Games count`);
    return src.league(w, label) ?? "--";
  }
  const win: WindowName = w === "H/A" ? (s === "Home" ? "Home" : "Away") : w;
  if (label === "Games") return src.games(s, win);
  return src.stat(s, win, label) ?? "--"; // no games in that window, like the sheet's "--"
}

// ---- evaluation ------------------------------------------------------------

export type CellResult = { value: Scalar; error: { code: string; message: string } | null };

const parseCache = new Map<string, Node | SheetError>();
function parsed(src: string): Node {
  let n = parseCache.get(src);
  if (!n) {
    try {
      n = parseFormula(src.slice(1));
    } catch (e) {
      n = e instanceof SheetError ? e : new SheetError("#ERROR!", String(e));
    }
    parseCache.set(src, n);
  }
  if (n instanceof SheetError) throw n;
  return n;
}

function literal(raw: string): Scalar {
  const t = raw.trim();
  if (t === "") return null;
  const pct = /^(-?\d+\.?\d*)%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  const n = Number(t);
  return Number.isFinite(n) ? n : raw;
}

// Lazily evaluates cells for one game; each cell is computed at most once.
export function evaluator(model: SheetModel, src: StatSource, labels: string[]) {
  const cache = new Map<string, CellResult>();
  const active = new Set<string>();

  const get = (a: string): CellResult => {
    const hit = cache.get(a);
    if (hit) return hit;
    const raw = model.cells[a] ?? "";
    if (!raw.startsWith("=")) {
      const r = { value: literal(raw), error: null };
      cache.set(a, r);
      return r;
    }
    if (active.has(a)) return { value: null, error: { code: "#REF!", message: `Circular reference at ${a}` } };
    active.add(a);
    let r: CellResult;
    try {
      const v = evaluate(parsed(raw), {
        cell: (c, row) => {
          const x = get(addr(c, row));
          if (x.error) throw new SheetError(x.error.code, x.error.message);
          return x.value;
        },
        stat: (ref) => resolveStat(ref, src, labels),
      });
      if (Array.isArray(v)) {
        if (v.length !== 1) throw new SheetError("#VALUE!", "Result is a range; wrap it in SUM or SUMPRODUCT");
        r = { value: v[0], error: null };
      } else if (typeof v === "number" && !Number.isFinite(v)) {
        throw new SheetError("#NUM!", "Result is not a finite number");
      } else {
        r = { value: v, error: null };
      }
    } catch (e) {
      const err = e instanceof SheetError ? e : new SheetError("#ERROR!", String(e));
      r = { value: null, error: { code: err.code, message: err.message } };
    }
    active.delete(a);
    cache.set(a, r);
    return r;
  };
  return get;
}

// The slate's numbers for one game, from the sheet's output cells.
export function scoreGame(model: SheetModel, src: StatSource, labels: string[]) {
  const get = evaluator(model, src, labels);
  const pick = (a: string) => {
    if (!parseAddr(a)) return null;
    const r = get(a.replace(/\$/g, "").toUpperCase());
    return !r.error && typeof r.value === "number" ? r.value : null;
  };
  const home = pick(model.outputs.home_score);
  const away = pick(model.outputs.away_score);
  return {
    get,
    home_score: home,
    away_score: away,
    home_spread: home != null && away != null ? away - home : null,
    total: home != null && away != null ? home + away : null,
  };
}

// ---- display ---------------------------------------------------------------

export function formatCell(r: CellResult, fmt: CellFormat | undefined): string {
  if (r.error) return r.error.code;
  const v = r.value;
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  switch (fmt) {
    case "int":
      return v.toFixed(0);
    case "dec1":
      return v.toFixed(1);
    case "dec2":
      return v.toFixed(2);
    case "dec3":
      return v.toFixed(3);
    case "dec4":
      return v.toFixed(4);
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    default:
      return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(10)));
  }
}

export const statFormatToCell = (f: StatFormat): CellFormat => f;
export { WINDOWS };

// ---- drafts ----------------------------------------------------------------

// Carry a draft's edits (draft vs the version it started from) onto a newer
// published sheet, so publishing a stale draft never drops newer rows.
export function rebaseModel(base: SheetModel, draft: SheetModel, latest: SheetModel): { model: SheetModel; changed: number } {
  const out: SheetModel = JSON.parse(JSON.stringify(latest));
  let changed = 0;
  for (const part of ["cells", "formats", "styles"] as const) {
    const b = base[part] as Record<string, string>;
    const d = draft[part] as Record<string, string>;
    const o = out[part] as Record<string, string>;
    for (const k of new Set([...Object.keys(b), ...Object.keys(d)])) {
      if (b[k] === d[k]) continue;
      if (k in d) o[k] = d[k];
      else delete o[k];
      changed++;
    }
  }
  if (JSON.stringify(base.outputs) !== JSON.stringify(draft.outputs)) out.outputs = draft.outputs;
  for (const k of Object.keys(draft.widths)) if (base.widths[k] !== draft.widths[k]) out.widths[k] = draft.widths[k];
  out.rows = Math.max(latest.rows, draft.rows - base.rows + latest.rows);
  out.cols = Math.max(latest.cols, draft.cols);
  return { model: out, changed };
}
