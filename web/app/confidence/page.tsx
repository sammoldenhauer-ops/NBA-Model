import fs from "node:fs";
import path from "node:path";
import { getConfidence } from "@/lib/data";
import type { Validation } from "@/lib/confidence";
import { getModelHash } from "@/lib/modelFile";

export const metadata = { title: "Confidence · NBA Matchup Model" };

type WeightsFile = {
  generated_at: string;
  seasons: number[];
  objective: string;
  stages: { min_games: number; weights: { ytd: number; l3: number; ha: number; prior: number }; holdout_games: number; holdout_error: { schedule: number; best_fixed: number; current: number } }[];
  overall: { games: number; schedule: number; best_fixed: number; current: number; best_fixed_weights: number[] };
};

function readWeights(): WeightsFile | null {
  const p = path.join(process.cwd(), "public", "data", "weights.json");
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as WeightsFile) : null;
}

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const WHAT: Record<string, string> = {
  ats: "the side picked against the sportsbook spread covers",
  ou: "the over/under pick against the sportsbook total hits",
  winner: "the team picked to win wins outright",
};

function MeasureCard({ v }: { v: Validation }) {
  const breakEven = v.measure !== "winner";
  return (
    <section className="card conf-card">
      <h3>{v.title}</h3>
      <p className="small muted">
        Probability that {WHAT[v.measure]}. Built from: {v.features.join(", ")}. Every number below is from seasons the model never saw
        (each season predicted by a model fit on the others).
      </p>
      <p className="small">
        Overall <b>{pct(v.hit_rate)}</b> on {v.n.toLocaleString()} games
        {" "}({v.per_season.map((s) => `${s.season - 1}-${String(s.season).slice(2)}: ${pct(s.hit_rate)}`).join(", ")})
        {breakEven && <span className="muted"> · −110 odds need 52.4% to break even</span>}
        {" · "}
        {v.skill ? <span className="pos">beats a flat guess</span> : <span className="muted">no better than a flat guess, so it shows the base rate</span>}
      </p>
      <div className="two-col">
        <table className="lines">
          <thead>
            <tr><th className="left">Confidence shown</th><th>Games</th><th>Avg shown</th><th>Actually hit</th></tr>
          </thead>
          <tbody>
            {v.calibration.map((c) => (
              <tr key={c.bin}><td className="left">{c.bin}</td><td>{c.n}</td><td>{pct(c.predicted)}</td><td className="strong">{pct(c.actual)}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="lines">
          <thead>
            <tr><th className="left">Only bet when confidence ≥</th><th>Games</th><th>Hit rate</th></tr>
          </thead>
          <tbody>
            {v.thresholds.filter((t) => t.n >= 20).map((t) => (
              <tr key={t.min}>
                <td className="left">{Math.round(t.min * 100)}%</td>
                <td>{t.n}</td>
                <td className={breakEven && t.hit_rate >= 0.524 ? "strong pos" : "strong"}>{pct(t.hit_rate)}</td>
              </tr>
            ))}
            {v.top.map((t) => (
              <tr key={`top${t.share}`}>
                <td className="left muted">Most confident {Math.round(t.share * 100)}%</td>
                <td className="muted">{t.n}</td>
                <td className={breakEven && t.hit_rate >= 0.524 ? "pos" : ""}>{pct(t.hit_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ConfidencePage() {
  const c = getConfidence();
  const w = readWeights();
  const hash = getModelHash();
  if (!c?.validation) return <p className="muted">No backtest yet.</p>;
  const a = c.accuracy;
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>Confidence</h1>
          <p className="muted small">
            Every game from {c.seasons.map((s) => `${s - 1}-${String(s).slice(2)}`).join(", ")} re-projected through the Model sheet with only the stats
            available before tip-off, then compared with the final score and the sportsbook line. Updated{" "}
            {new Date(c.generated_at).toLocaleDateString("en-US")}.
            {c.model_hash !== hash && " The sheet has changed since then; this updates on the next run."}
          </p>
        </div>
      </div>

      <p className="notice small">
        How to read this: a pick shown at 56% has won about 56% of the time in past seasons it was never trained on. Against the spread and on
        totals the edges are small: overall hit rates are 51–52%, and only the most confident picks clear the 52.4% needed at −110.
      </p>

      {c.validation.map((v) => <MeasureCard key={v.measure} v={v} />)}

      <h2>Projection accuracy</h2>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr><th className="left" /><th>Model sheet</th><th>Sportsbook line</th><th>Sheet bias</th></tr>
          </thead>
          <tbody>
            <tr><td className="left">Average miss, margin (pts)</td><td className="strong">{a.margin_mae.toFixed(2)}</td><td>{a.market_margin_mae.toFixed(2)}</td><td>{a.margin_bias > 0 ? "+" : ""}{a.margin_bias.toFixed(2)} (home)</td></tr>
            <tr><td className="left">Average miss, total (pts)</td><td className="strong">{a.total_mae.toFixed(2)}</td><td>{a.market_total_mae.toFixed(2)}</td><td>{a.total_bias > 0 ? "+" : ""}{a.total_bias.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Bands on each game (e.g. ±9/16) mean half of past games landed within the first number of the sheet&apos;s projected margin, and 80% within the second.
      </p>

      {w && (
        <>
          <h2>Weight schedule</h2>
          <p className="muted small">
            The Weight cells in the Model sheet look up these rows by the two teams&apos; average games played. Each stage&apos;s weights were picked by
            backtest ({w.objective}); the error columns are for seasons the pick never saw.
          </p>
          <div className="table-wrap">
            <table className="lines">
              <thead>
                <tr>
                  <th className="left">Avg games played</th><th>≈ Week</th><th>YTD</th><th>L3</th><th>H/A</th><th>Prior</th>
                  <th>Games</th><th>Error: schedule</th><th>Best fixed</th><th>10/0/0/90</th>
                </tr>
              </thead>
              <tbody>
                {w.stages.map((s, i) => (
                  <tr key={s.min_games}>
                    <td className="left">{s.min_games}{w.stages[i + 1] ? `–${w.stages[i + 1].min_games - 1}` : "+"}</td>
                    <td className="muted">{Math.floor(s.min_games / 3.5) + 1}</td>
                    <td>{s.weights.ytd}</td><td>{s.weights.l3}</td><td>{s.weights.ha}</td><td>{s.weights.prior}</td>
                    <td className="muted">{s.holdout_games}</td>
                    <td className="strong">{s.holdout_error.schedule.toFixed(2)}</td>
                    <td>{s.holdout_error.best_fixed.toFixed(2)}</td>
                    <td>{s.holdout_error.current.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="weighted">
                  <td className="left">All</td><td /><td colSpan={4} className="muted small">best fixed: {w.overall.best_fixed_weights.join("/")}</td>
                  <td>{w.overall.games}</td><td>{w.overall.schedule.toFixed(2)}</td><td>{w.overall.best_fixed.toFixed(2)}</td><td>{w.overall.current.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="small">
        <a href="/data/backtest.csv" download>Download every backtested game with its features (CSV)</a>
      </p>
    </>
  );
}
