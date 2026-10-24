// Results tracking, like Sam's "Model Results" sheet: every finished game filed under
// each team by home/away, favourite/underdog (by the MODEL's spread) and spread size,
// with moneyline W-L and covers. Browser-safe.

// One row per team per game (public/data/tracking.json, written by scripts/confidence.ts).
export type TrackRow = {
  season: number;
  date: string;
  team: string; // abbreviation
  opp: string;
  home: boolean;
  spread: number; // the model's spread for this team (negative = favoured)
  line: number | null; // sportsbook spread for this team
  pts: number;
  oppPts: number;
};
export type TrackingFile = { generated_at: string; model_hash: string; columns: string[]; rows: (string | number | null)[][] };

export function readRows(f: TrackingFile): TrackRow[] {
  const i = (c: string) => f.columns.indexOf(c);
  return f.rows.map((r) => ({
    season: Number(r[i("season")]), date: String(r[i("date")]), team: String(r[i("team")]), opp: String(r[i("opp")]),
    home: Number(r[i("home")]) === 1, spread: Number(r[i("spread")]),
    line: r[i("line")] == null || r[i("line")] === "" ? null : Number(r[i("line")]),
    pts: Number(r[i("pts")]), oppPts: Number(r[i("oppPts")]),
  }));
}

// Spread-size buckets, by the absolute spread (spreads move in half points).
export const BUCKETS = [
  { key: 0, size: "0-2.5", fav: "-0.5 to -2.5", dog: "+0.5 to +2.5", lo: 0, hi: 2.5 },
  { key: 1, size: "3-5.5", fav: "-3 to -5.5", dog: "+3 to +5.5", lo: 3, hi: 5.5 },
  { key: 2, size: "6-8.5", fav: "-6 to -8.5", dog: "+6 to +8.5", lo: 6, hi: 8.5 },
  { key: 3, size: "9-11.5", fav: "-9 to -11.5", dog: "+9 to +11.5", lo: 9, hi: 11.5 },
  { key: 4, size: "12+", fav: "-12 or more", dog: "+12 or more", lo: 12, hi: Infinity },
];
export const bucketOf = (spread: number) => {
  const a = Math.abs(spread);
  return BUCKETS.findIndex((b) => a <= b.hi + 1e-9);
};

export type Basis = "model" | "line";

export type Record = {
  favW: number; favL: number; dogW: number; dogL: number;
  cover: number; noCover: number; push: number; marginSum: number; n: number;
};
const empty = (): Record => ({ favW: 0, favL: 0, dogW: 0, dogL: 0, cover: 0, noCover: 0, push: 0, marginSum: 0, n: 0 });

// Margin over the spread for one game: > 0 covered. Model basis = actual margin vs the
// model's projected margin; line basis = vs the sportsbook spread.
export function coverMargin(r: TrackRow, basis: Basis): number | null {
  const s = basis === "model" ? r.spread : r.line;
  return s == null ? null : r.pts - r.oppPts + s;
}

export function add(rec: Record, r: TrackRow, basis: Basis) {
  const won = r.pts > r.oppPts;
  if (r.spread < 0) won ? rec.favW++ : rec.favL++;
  else if (r.spread > 0) won ? rec.dogW++ : rec.dogL++;
  const m = coverMargin(r, basis);
  if (m == null) return;
  rec.n++;
  rec.marginSum += m;
  if (m > 0) rec.cover++;
  else if (m < 0) rec.noCover++;
  else rec.push++;
}

export type TeamSummary = { team: string; all: Record; home: Record; away: Record; homeB: Record[]; awayB: Record[] };

export function summarize(rows: TrackRow[], basis: Basis, allTeams = false): TeamSummary[] {
  const by = new Map<string, TeamSummary>();
  for (const r of rows) {
    const key = allTeams ? "ALL" : r.team;
    let t = by.get(key);
    if (!t) {
      t = { team: key, all: empty(), home: empty(), away: empty(), homeB: BUCKETS.map(empty), awayB: BUCKETS.map(empty) };
      by.set(key, t);
    }
    add(t.all, r, basis);
    add(r.home ? t.home : t.away, r, basis);
    add((r.home ? t.homeB : t.awayB)[bucketOf(r.spread)], r, basis);
  }
  return [...by.values()].sort((a, b) => a.team.localeCompare(b.team));
}

// The same situation as an upcoming game, from a team's history.
export type Precedent = {
  team: string;
  label: string; // e.g. "road underdog of +12 or more"
  ml: { w: number; l: number };
  ats: { cover: number; noCover: number; push: number; avg: number | null };
  atsLine: { cover: number; noCover: number; push: number; avg: number | null };
  n: number;
};

export function situationLabel(home: boolean, spread: number): string {
  const b = BUCKETS[bucketOf(spread)];
  const where = home ? "home" : "road";
  if (spread === 0) return `${where} pick'em`;
  const role = spread < 0 ? "favourite" : "underdog";
  return `${where} ${role} ${spread < 0 ? b.fav : b.dog}`;
}

export function precedent(rows: TrackRow[], team: string, home: boolean, spread: number, seasons?: number[]): Precedent {
  const b = bucketOf(spread);
  const same = rows.filter((r) =>
    r.team === team && r.home === home && bucketOf(r.spread) === b && Math.sign(r.spread) === Math.sign(spread) &&
    (!seasons || seasons.includes(r.season)));
  const m = empty(), l = empty();
  for (const r of same) {
    add(m, r, "model");
    add(l, r, "line");
  }
  const win = spread < 0 ? { w: m.favW, l: m.favL } : spread > 0 ? { w: m.dogW, l: m.dogL } : { w: same.filter((r) => r.pts > r.oppPts).length, l: same.filter((r) => r.pts < r.oppPts).length };
  return {
    team, label: situationLabel(home, spread), ml: win,
    ats: { cover: m.cover, noCover: m.noCover, push: m.push, avg: m.n ? m.marginSum / m.n : null },
    atsLine: { cover: l.cover, noCover: l.noCover, push: l.push, avg: l.n ? l.marginSum / l.n : null },
    n: same.length,
  };
}

export const pctOf = (w: number, l: number) => (w + l ? `${((100 * w) / (w + l)).toFixed(1)}%` : "—");
export const wl = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ""}`;
