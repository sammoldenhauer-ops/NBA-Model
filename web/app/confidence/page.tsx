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
const TITLES: Record<string, { name: string; what: string }> = {
  ats: { name: "Against the spread", what: "the side the model favours versus the sportsbook spread covers" },
  ou: { name: "Over / under", what: "the model's over/under call versus the sportsbook total hits" },
  winner: { name: "Winner", what: "the team the model projects to win wins outright" },
};

function MeasureTable({ v }: { v: Validation }) {
  const t = TITLES[v.measure];
  const skill = v.brier_baseline - v.brier;
  return (
    <section className="card conf-card">
      <h3>{t.name}</h3>
      <p className="small muted">
        Probability that {t.what}. Tested on {v.n.toLocaleString()} games the calibration never saw (each season predicted by a model fit on the
        other seasons).
      </p>
      <p className="small">
        Hit rate <b>{pct(v.hit_rate)}</b>
        {v.measure !== "winner" && <span className="muted"> (−110 odds need 52.4% to break even)</span>} · Brier {v.brier.toFixed(4)} vs{" "}
        {v.brier_baseline.toFixed(4)} for a flat guess{" "}
        <span className={skill > 0.0005 ? "pos" : "muted"}>{skill > 0.0005 ? "(adds information)" : "(no better than a flat guess)"}</span>
      </p>
      <div className="two-col">
        <table className="lines">
          <thead>
            <tr><th className="left">Confidence said</th><th>Games</th><th>Avg said</th><th>Actually hit</th></tr>
          </thead>
          <tbody>
            {v.calibration.map((c) => (
              <tr key={c.bin}><td className="left">{c.bin}</td><td>{c.n}</td><td>{pct(c.predicted)}</td><td className="strong">{pct(c.actual)}</td></tr>
            ))}
          </tbody>
        </table>
        <table className="lines">
          <thead>
            <tr><th className="left">{v.measure === "winner" ? "Projected margin" : "Edge vs line"}</th><th>Games</th><th>Hit rate</th></tr>
          </thead>
          <tbody>
            {v.by_edge.map((b) => (
              <tr key={b.bucket}><td className="left">{b.bucket} pts</td><td>{b.n}</td><td className="strong">{pct(b.hit_rate)}</td></tr>
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
  if (!c) return <p className="muted">No backtest yet.</p>;
  const a = c.accuracy;
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>Confidence</h1>
          <p className="muted small">
            Every game from the {c.model.seasons.join(", ")} seasons re-projected through the Model sheet using only stats available before tip-off,
            then compared with the final score and the sportsbook line. Calibrated {new Date(c.generated_at).toLocaleDateString("en-US")}.
            {c.model.model_hash !== hash && " The sheet has changed since then; this updates on the next daily run."}
          </p>
        </div>
      </div>

      <h2>Projection accuracy</h2>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr><th className="left" /><th>Model</th><th>Sportsbook line</th><th>Model bias</th></tr>
          </thead>
          <tbody>
            <tr><td className="left">Average miss, margin (pts)</td><td className="strong">{a.model_margin_mae_same_games.toFixed(2)}</td><td>{a.market_margin_mae.toFixed(2)}</td><td>{a.margin_bias > 0 ? "+" : ""}{a.margin_bias.toFixed(2)} (home)</td></tr>
            <tr><td className="left">Average miss, total (pts)</td><td className="strong">{a.model_total_mae_same_games.toFixed(2)}</td><td>{a.market_total_mae.toFixed(2)}</td><td>{a.total_bias > 0 ? "+" : ""}{a.total_bias.toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Bands on each game (e.g. ±9/16) mean half of past games landed within the first number of the projected margin, and 80% within the second.
      </p>

      {c.validation.map((v) => <MeasureTable key={v.measure} v={v} />)}

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
        <a href="/data/backtest.csv" download>Download every backtested game (CSV)</a>
      </p>
    </>
  );
}
