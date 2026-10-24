"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { BUCKETS, pctOf, readRows, summarize, type Basis, type Record as Rec, type TeamSummary, type TrackingFile } from "@/lib/tracking";

const logo = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${abbr.toLowerCase()}.png`;

// Green above the line, red below; stronger with distance and sample size.
function heat(w: number, l: number, center = 0.5): string | undefined {
  const n = w + l;
  if (!n) return undefined;
  const p = w / n;
  const strength = Math.min(1, Math.abs(p - center) * 2.5) * Math.min(1, n / 8);
  const color = p >= center ? "22, 163, 74" : "220, 38, 38";
  return `rgba(${color}, ${(0.08 + 0.42 * strength).toFixed(2)})`;
}

function Cells({ r }: { r: Rec }) {
  const avg = r.n ? r.marginSum / r.n : null;
  const fav = r.favW + r.favL, dog = r.dogW + r.dogL;
  return (
    <>
      <td>{fav ? r.favW : ""}</td>
      <td>{fav ? r.favL : ""}</td>
      <td style={{ background: heat(r.favW, r.favL, 0.65) }}>{fav ? pctOf(r.favW, r.favL) : ""}</td>
      <td className="grp">{dog ? r.dogW : ""}</td>
      <td>{dog ? r.dogL : ""}</td>
      <td style={{ background: heat(r.dogW, r.dogL, 0.35) }}>{dog ? pctOf(r.dogW, r.dogL) : ""}</td>
      <td className="grp">{r.n ? r.cover : ""}</td>
      <td>{r.n ? r.noCover : ""}</td>
      <td>{r.push || ""}</td>
      <td style={{ background: heat(r.cover, r.noCover) }}>{r.n ? pctOf(r.cover, r.noCover) : ""}</td>
      <td className={avg == null ? "" : avg > 0 ? "pos" : "neg"}>{avg == null ? "" : `${avg > 0 ? "+" : ""}${avg.toFixed(1)}`}</td>
    </>
  );
}

export default function TrackingTable({ file }: { file: TrackingFile }) {
  const rows = useMemo(() => readRows(file), [file]);
  const seasons = useMemo(() => [...new Set(rows.map((r) => r.season))].sort((a, b) => b - a), [rows]);
  const [season, setSeason] = useState<string>("all");
  const [basis, setBasis] = useState<Basis>("model");
  const [open, setOpen] = useState<Set<string>>(new Set(["ALL"]));
  const [sort, setSort] = useState<"team" | "cover" | "fav" | "dog">("team");

  const filtered = useMemo(() => (season === "all" ? rows : rows.filter((r) => r.season === Number(season))), [rows, season]);
  const teams = useMemo(() => {
    const t = summarize(filtered, basis);
    const key = (r: Rec) =>
      sort === "cover" ? r.cover / (r.cover + r.noCover || 1) : sort === "fav" ? r.favW / (r.favW + r.favL || 1) : r.dogW / (r.dogW + r.dogL || 1);
    return sort === "team" ? t : [...t].sort((a, b) => key(b.all) - key(a.all));
  }, [filtered, basis, sort]);
  const league = useMemo(() => summarize(filtered, basis, true)[0], [filtered, basis]);
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const current = Math.max(...seasons);
  const label = (s: number) => `${s - 1}-${String(s).slice(2)}${s === current ? " (this season)" : " (backtest)"}`;

  const block = (t: TeamSummary, name: ReactNode) => {
    const isOpen = open.has(t.team);
    return (
      <Fragment key={t.team}>
        <tr className="trk-team" onClick={() => toggle(t.team)}>
          <td className="left sticky-col"><span className="caret">{isOpen ? "▾" : "▸"}</span> {name}</td>
          <Cells r={t.all} />
        </tr>
        {isOpen &&
          (["home", "away"] as const).map((side) => (
            <Fragment key={side}>
              <tr className="trk-side">
                <td className="left sticky-col">{side === "home" ? "Home" : "Away"}</td>
                <Cells r={t[side]} />
              </tr>
              {BUCKETS.map((b, i) => (
                <tr key={b.key} className="trk-bucket">
                  <td className="left sticky-col muted">spread {b.size}</td>
                  <Cells r={(side === "home" ? t.homeB : t.awayB)[i]} />
                </tr>
              ))}
            </Fragment>
          ))}
      </Fragment>
    );
  };

  return (
    <>
      <div className="filters card">
        <label className="small">
          Season
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="all">All seasons</option>
            {seasons.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
        </label>
        <label className="small">
          Covers vs
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
            <option value="model">model spread</option>
            <option value="line">sportsbook spread</option>
          </select>
        </label>
        <label className="small">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="team">Team</option>
            <option value="cover">Cover %</option>
            <option value="fav">Favourite win %</option>
            <option value="dog">Underdog win %</option>
          </select>
        </label>
        <button className="tab" onClick={() => setOpen(new Set(["ALL", ...teams.map((t) => t.team)]))}>Expand all</button>
        <button className="tab" onClick={() => setOpen(new Set())}>Collapse all</button>
        <span className="muted small">{filtered.length / 2} games</span>
      </div>
      <div className="table-wrap stats-wrap">
        <table className="stats tracking">
          <thead>
            <tr>
              <th className="left sticky-col" rowSpan={2}>Team</th>
              <th colSpan={3} className="grp-head">Favourites (model)</th>
              <th colSpan={3} className="grp-head grp">Underdogs (model)</th>
              <th colSpan={5} className="grp-head grp">Spreads (vs {basis === "model" ? "model" : "sportsbook"})</th>
            </tr>
            <tr>
              <th>ML W</th><th>ML L</th><th>ML W%</th>
              <th className="grp">ML W</th><th>ML L</th><th>ML W%</th>
              <th className="grp">Cover</th><th>No cover</th><th>Push</th><th>Cover %</th><th>Avg +/-</th>
            </tr>
          </thead>
          <tbody>
            {league && block(league, <b>All teams</b>)}
            {teams.map((t) => block(t, <><img src={logo(t.team)} alt="" width={20} height={20} className="trk-logo" /> {t.team}</>))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Favourites / underdogs are by the model&apos;s spread for that team. ML W% = how often the model&apos;s favourite (or underdog) won. Cover =
        the team&apos;s actual margin beat the {basis === "model" ? "model's" : "sportsbook"} spread; Avg +/- = by how much on average.
      </p>
    </>
  );
}
