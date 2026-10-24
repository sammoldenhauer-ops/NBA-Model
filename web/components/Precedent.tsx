// Each team's history in the same situation as this game (home/away, model
// favourite/underdog, spread size). No hooks, so server pages and the client Model
// editor can both render it.

import { precedent, wl, pctOf, type Precedent as P, type TrackRow } from "@/lib/tracking";

function Line({ title, p }: { title: string; p: P }) {
  if (!p.n) return <div className="small muted">{title}: no games yet</div>;
  const avg = (x: number | null) => (x == null ? "" : ` (avg ${x > 0 ? "+" : ""}${x.toFixed(1)})`);
  return (
    <div className="small">
      <span className="muted">{title}:</span> ML <b>{wl(p.ml.w, p.ml.l)}</b> <span className="muted">{pctOf(p.ml.w, p.ml.l)}</span>
      {" · "}vs model <b>{wl(p.ats.cover, p.ats.noCover, p.ats.push)}</b>{avg(p.ats.avg)}
      {" · "}vs book <b>{wl(p.atsLine.cover, p.atsLine.noCover, p.atsLine.push)}</b>{avg(p.atsLine.avg)}
    </div>
  );
}

export function precedents(rows: TrackRow[], home: string, away: string, homeSpread: number, season: number) {
  return {
    home: { cur: precedent(rows, home, true, homeSpread, [season]), all: precedent(rows, home, true, homeSpread) },
    away: { cur: precedent(rows, away, false, -homeSpread, [season]), all: precedent(rows, away, false, -homeSpread) },
  };
}

export default function PrecedentPanel({ rows, home, away, homeSpread, season }: { rows: TrackRow[]; home: string; away: string; homeSpread: number | null; season: number }) {
  if (homeSpread == null) return <p className="muted small">No projection yet.</p>;
  const p = precedents(rows, home, away, homeSpread, season);
  return (
    <div className="precedent">
      {([["away", away], ["home", home]] as const).map(([side, abbr]) => (
        <div key={side} className="card">
          <h4>{abbr} as {p[side].all.label}</h4>
          <Line title="This season" p={p[side].cur} />
          <Line title="All seasons" p={p[side].all} />
        </div>
      ))}
    </div>
  );
}

// One-line summary for slate cards: "NO road underdog +12 or more: 1-20 ML, 11-10 vs model".
export function precedentLine(rows: TrackRow[], abbr: string, home: boolean, teamSpread: number): string | null {
  const p = precedent(rows, abbr, home, teamSpread);
  if (!p.n) return null;
  return `${abbr} as ${p.label}: ${wl(p.ml.w, p.ml.l)} ML, ${wl(p.ats.cover, p.ats.noCover, p.ats.push)} vs model, ${wl(p.atsLine.cover, p.atsLine.noCover, p.atsLine.push)} vs book`;
}
