import { Fragment } from "react";
import type { Game, Slate, WindowKey } from "@/lib/data";
import { WINDOW_KEYS } from "@/lib/data";
import { fmtDiff, fmtNum, fmtStat } from "@/lib/format";

const WINDOW_LABEL: Record<WindowKey, string> = {
  ytd: "YTD",
  l3: "L3",
  ha: "H/A",
  prior: "Prior",
};

// Laid out like the spreadsheet: one block per stat, a row per window, then Weighted.
export default function ModelTable({ game, slate }: { game: Game; slate: Slate }) {
  const labels = Object.fromEntries(game.stats.map((s) => [s.id, s.label]));
  const h = game.home.abbr;
  const a = game.away.abbr;

  return (
    <div className="table-wrap">
      <table className="model">
        <thead>
          <tr>
            <th rowSpan={2} className="left">Stat / window</th>
            <th colSpan={2}>Team</th>
            <th rowSpan={2}>Wt</th>
            <th colSpan={2}>League avg</th>
            <th colSpan={2}>Difference</th>
            <th colSpan={2}>Adjusted</th>
            <th colSpan={2}>Expected</th>
          </tr>
          <tr>
            {[0, 1, 2, 3, 4].map((i) => (
              <Fragment key={i}>
                <th>{h}</th>
                <th>{a}</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {game.stats.map((s) => {
            const sameWeights = s.home.weight_sum === s.away.weight_sum;
            return (
              <Fragment key={s.id}>
                <tr className="stat-head">
                  <th colSpan={13} className="left">
                    {s.label}
                    {s.mirror && <span className="muted small"> · vs. opponent’s {labels[s.mirror]}</span>}
                    {s.id === "poss" && <span className="muted small"> · expected = average of both weighted values</span>}
                  </th>
                </tr>
                {WINDOW_KEYS.map((w) => {
                  const hw = s.home.windows[w];
                  const aw = s.away.windows[w];
                  return (
                    <tr key={w}>
                      <td className="left muted">
                        {WINDOW_LABEL[w]}
                        {w === "ha" && <span className="small"> (home / away)</span>}
                      </td>
                      <td>{fmtStat(hw.team, s.fmt)}</td>
                      <td>{fmtStat(aw.team, s.fmt)}</td>
                      <td className="muted">{slate.weights[w]}</td>
                      <td>{fmtStat(hw.lg, s.fmt)}</td>
                      <td>{fmtStat(aw.lg, s.fmt)}</td>
                      <td className={tone(hw.diff)}>{fmtDiff(hw.diff, s.fmt)}</td>
                      <td className={tone(aw.diff)}>{fmtDiff(aw.diff, s.fmt)}</td>
                      <td colSpan={4} />
                    </tr>
                  );
                })}
                <tr className="weighted">
                  <td className="left">Weighted</td>
                  <td>{fmtStat(s.home.weighted_team, s.fmt)}</td>
                  <td>{fmtStat(s.away.weighted_team, s.fmt)}</td>
                  <td className="muted" title="Weights used (missing windows are dropped)">
                    {sameWeights ? s.home.weight_sum : `${s.home.weight_sum}/${s.away.weight_sum}`}
                  </td>
                  <td>{fmtStat(s.home.weighted_lg, s.fmt)}</td>
                  <td>{fmtStat(s.away.weighted_lg, s.fmt)}</td>
                  <td className={tone(diff(s.home.weighted_team, s.home.weighted_lg))}>
                    {fmtDiff(diff(s.home.weighted_team, s.home.weighted_lg), s.fmt)}
                  </td>
                  <td className={tone(diff(s.away.weighted_team, s.away.weighted_lg))}>
                    {fmtDiff(diff(s.away.weighted_team, s.away.weighted_lg), s.fmt)}
                  </td>
                  <td>{fmtNum(s.home.adj, 4)}</td>
                  <td>{fmtNum(s.away.adj, 4)}</td>
                  <td className="strong">{fmtStat(s.home.expected, s.fmt)}</td>
                  <td className="strong">{fmtStat(s.away.expected, s.fmt)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function diff(t: number | null, l: number | null): number | null {
  return t == null || l == null ? null : t - l;
}

function tone(v: number | null): string {
  if (v == null || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}
