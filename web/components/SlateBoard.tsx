"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Game, Team } from "@/lib/data";
import type { GameConfidence } from "@/lib/confidence";
import { fmtSpread, fmtTip, teamColor } from "@/lib/format";

export type Card = {
  game: Game;
  home_score: number | null;
  away_score: number | null;
  home_spread: number | null; // model
  total: number | null; // model
  conf: GameConfidence | null;
  prec?: string[];
};

type Filters = {
  spreadSource: "model" | "market";
  spreadMin: string;
  spreadMax: string;
  totalSource: "model" | "market";
  totalMin: string;
  totalMax: string;
  measure: "any" | "ats" | "ou" | "winner";
  minConf: number; // percent
  sort: "time" | "ats" | "ou" | "winner" | "edge";
};
const DEFAULTS: Filters = { spreadSource: "model", spreadMin: "", spreadMax: "", totalSource: "model", totalMin: "", totalMax: "", measure: "any", minConf: 0, sort: "time" };
const KEY = "nba-slate-filters-v1";

const pct = (p: number | null | undefined) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
const tone = (p: number | null | undefined, skill = true) => (p == null || !skill ? "conf-lo" : p >= 0.6 ? "conf-hi" : p >= 0.53 ? "conf-mid" : "conf-lo");
const NO_EDGE = "No proven edge: on held-out seasons this call hit at its base rate regardless of the edge, so the score is that base rate.";
const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

function TeamRow({ team, score, spread, isHome }: { team: Team; score: number | null; spread: number | null; isHome: boolean }) {
  return (
    <div className="team-row">
      <span className="swatch" style={{ background: teamColor(team.color) }} />
      {team.logo && <img className="logo" src={team.logo} alt="" width={28} height={28} />}
      <span className="team-name">
        <span className="abbr">{team.abbr}</span>
        <span className="full muted">{team.name}</span>
        {isHome && <span className="tag">home</span>}
      </span>
      <span className="spread">{spread == null ? "—" : fmtSpread(spread)}</span>
      <span className="score">{score == null ? "—" : score.toFixed(1)}</span>
      {team.final != null && <span className="final">{team.final}</span>}
    </div>
  );
}

function Picks({ c }: { c: Card }) {
  const g = c.game;
  const line = g.line;
  const conf = c.conf;
  const abbr = (side: "home" | "away" | null) => (side === "home" ? g.home.abbr : side === "away" ? g.away.abbr : "—");
  const atsLine = conf?.ats.side && line ? (conf.ats.side === "home" ? line.home_spread : -line.home_spread) : null;
  return (
    <div className="picks">
      <div className="line small muted">
        {line ? (
          <>
            Line {g.home.abbr} {fmtSpread(line.home_spread)}
            {line.total != null && <> · O/U {line.total}</>}
          </>
        ) : (
          "No line yet"
        )}
      </div>
      {conf && (
        <div className="pick-chips">
          <span className={`chip ${tone(conf.ats.p, conf.ats.skill)}`} title={`${conf.ats.edge != null ? `Model vs line: ${conf.ats.edge > 0 ? "+" : ""}${conf.ats.edge.toFixed(1)} pts. ` : ""}${conf.ats.skill ? "" : NO_EDGE}`}>
            ATS {conf.ats.side ? `${abbr(conf.ats.side)}${atsLine != null ? ` ${fmtSpread(atsLine)}` : ""}` : "—"} <b>{pct(conf.ats.p)}</b>{!conf.ats.skill && " · no edge"}
          </span>
          <span className={`chip ${tone(conf.ou.p, conf.ou.skill)}`} title={`${conf.ou.edge != null ? `Model vs line: ${conf.ou.edge > 0 ? "+" : ""}${conf.ou.edge.toFixed(1)} pts. ` : ""}${conf.ou.skill ? "" : NO_EDGE}`}>
            {conf.ou.side ? (conf.ou.side === "over" ? "Over" : "Under") : "O/U —"} <b>{pct(conf.ou.p)}</b>{!conf.ou.skill && " · no edge"}
          </span>
          <span className={`chip ${tone(conf.winner.p, conf.winner.skill)}`}>
            Win {abbr(conf.winner.team)} <b>{pct(conf.winner.p)}</b>
          </span>
          <span className="chip plain" title="Half of past games landed within the first number of the projection, 80% within the second">
            ±{conf.margin_band[0].toFixed(0)}/{conf.margin_band[1].toFixed(0)} margin · ±{conf.total_band[0].toFixed(0)}/{conf.total_band[1].toFixed(0)} total
          </span>
        </div>
      )}
    </div>
  );
}

function GameCard({ date, c }: { date: string; c: Card }) {
  const g = c.game;
  const isFinal = g.home.final != null && g.away.final != null;
  return (
    <Link className="card game-card" href={`/game/${date}/${g.game_id}`}>
      <div className="card-head">
        <span className="muted small">{isFinal ? "Final" : fmtTip(g.tip_time)}</span>
        <span className="muted small">
          Total <strong className="fg">{c.total == null ? "—" : c.total.toFixed(1)}</strong>
        </span>
      </div>
      <div className="cols-head muted small">
        <span />
        <span className="spread">Spread</span>
        <span className="score">Proj</span>
        {isFinal && <span className="final">Actual</span>}
      </div>
      <TeamRow team={g.away} score={c.away_score} spread={c.home_spread == null ? null : -c.home_spread} isHome={false} />
      <TeamRow team={g.home} score={c.home_score} spread={c.home_spread} isHome={!g.neutral} />
      <Picks c={c} />
      {c.prec?.map((t) => <div key={t} className="prec-line">{t}</div>)}
    </Link>
  );
}

export default function SlateBoard({ date, cards, staleNote }: { date: string; cards: Card[]; staleNote?: string | null }) {
  const [f, setF] = useState<Filters>(DEFAULTS);
  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setF({ ...DEFAULTS, ...JSON.parse(s) });
    } catch {
      /* ignore */
    }
  }, []);
  const update = (patch: Partial<Filters>) =>
    setF((x) => {
      const n = { ...x, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(n));
      } catch {
        /* ignore */
      }
      return n;
    });

  const shown = useMemo(() => {
    const spreadOf = (c: Card) => (f.spreadSource === "market" ? (c.game.line ? Math.abs(c.game.line.home_spread) : null) : c.home_spread == null ? null : Math.abs(c.home_spread));
    const totalOf = (c: Card) => (f.totalSource === "market" ? c.game.line?.total ?? null : c.total);
    const confOf = (c: Card, m: Filters["measure"]) => {
      if (!c.conf) return null;
      if (m === "ats") return c.conf.ats.p;
      if (m === "ou") return c.conf.ou.p;
      if (m === "winner") return c.conf.winner.p;
      return Math.max(c.conf.ats.p ?? 0, c.conf.ou.p ?? 0);
    };
    const inRange = (v: number | null, lo: string, hi: string) => {
      const a = num(lo);
      const b = num(hi);
      if (a == null && b == null) return true;
      if (v == null) return false;
      return (a == null || v >= a) && (b == null || v <= b);
    };
    const list = cards.filter(
      (c) =>
        inRange(spreadOf(c), f.spreadMin, f.spreadMax) &&
        inRange(totalOf(c), f.totalMin, f.totalMax) &&
        (f.minConf <= 0 || (confOf(c, f.measure) ?? 0) * 100 >= f.minConf),
    );
    const key = (c: Card) =>
      f.sort === "ats" ? -(c.conf?.ats.p ?? 0) : f.sort === "ou" ? -(c.conf?.ou.p ?? 0) : f.sort === "winner" ? -(c.conf?.winner.p ?? 0)
        : f.sort === "edge" ? -Math.max(Math.abs(c.conf?.ats.edge ?? 0), Math.abs(c.conf?.ou.edge ?? 0)) : 0;
    return f.sort === "time" ? list : [...list].sort((a, b) => key(a) - key(b));
  }, [cards, f]);

  const active = JSON.stringify(f) !== JSON.stringify({ ...DEFAULTS, sort: f.sort });

  return (
    <>
      <div className="filters card">
        <label className="small">
          Spread
          <select value={f.spreadSource} onChange={(e) => update({ spreadSource: e.target.value as Filters["spreadSource"] })}>
            <option value="model">model</option>
            <option value="market">line</option>
          </select>
          <input className="num-in" placeholder="min" value={f.spreadMin} onChange={(e) => update({ spreadMin: e.target.value })} inputMode="decimal" />
          –
          <input className="num-in" placeholder="max" value={f.spreadMax} onChange={(e) => update({ spreadMax: e.target.value })} inputMode="decimal" />
        </label>
        <label className="small">
          Total
          <select value={f.totalSource} onChange={(e) => update({ totalSource: e.target.value as Filters["totalSource"] })}>
            <option value="model">model</option>
            <option value="market">line</option>
          </select>
          <input className="num-in" placeholder="min" value={f.totalMin} onChange={(e) => update({ totalMin: e.target.value })} inputMode="decimal" />
          –
          <input className="num-in" placeholder="max" value={f.totalMax} onChange={(e) => update({ totalMax: e.target.value })} inputMode="decimal" />
        </label>
        <label className="small">
          Confidence ≥ <b>{f.minConf}%</b>
          <input type="range" min={0} max={80} step={1} value={f.minConf} onChange={(e) => update({ minConf: Number(e.target.value) })} />
          <select value={f.measure} onChange={(e) => update({ measure: e.target.value as Filters["measure"] })}>
            <option value="any">ATS or O/U</option>
            <option value="ats">ATS</option>
            <option value="ou">O/U</option>
            <option value="winner">Winner</option>
          </select>
        </label>
        <label className="small">
          Sort
          <select value={f.sort} onChange={(e) => update({ sort: e.target.value as Filters["sort"] })}>
            <option value="time">Tip time</option>
            <option value="ats">ATS confidence</option>
            <option value="ou">O/U confidence</option>
            <option value="winner">Win probability</option>
            <option value="edge">Biggest edge vs line</option>
          </select>
        </label>
        {active && <button className="tab" onClick={() => update({ ...DEFAULTS, sort: f.sort })}>Clear</button>}
        <span className="muted small">{shown.length} of {cards.length} games · <Link href="/confidence">how confidence works</Link></span>
      </div>
      {staleNote && <p className="notice small">{staleNote}</p>}
      <div className="grid">
        {shown.map((c) => (
          <GameCard key={c.game.game_id} date={date} c={c} />
        ))}
      </div>
    </>
  );
}
