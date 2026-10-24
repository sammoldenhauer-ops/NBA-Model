import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { getDates, getGame, getSlate, getStatList, WINDOWS, type Team } from "@/lib/data";
import { fmtDateLong, fmtSpread, fmtStat, fmtTip, teamColor } from "@/lib/format";
import { evaluateGame } from "@/lib/model";
import { getModel } from "@/lib/modelFile";

export const dynamicParams = false;

export function generateStaticParams() {
  return getDates().flatMap((date) =>
    (getSlate(date)?.games ?? []).map((g) => ({ date, gameId: g.game_id })),
  );
}

function Side({ team, score, spread, label }: { team: Team; score: number | null; spread: number | null; label: string }) {
  return (
    <div className="side" style={{ borderColor: teamColor(team.color) }}>
      <div className="muted small">{label}</div>
      <div className="side-team">
        {team.logo && <img src={team.logo} alt="" width={44} height={44} />}
        <div>
          <div className="side-name">{team.name}</div>
          <div className="muted small">Spread {spread == null ? "—" : fmtSpread(spread)}</div>
        </div>
      </div>
      <div className="side-score">{score == null ? "—" : score.toFixed(1)}</div>
      {team.final != null && <div className="muted small">Final: {team.final}</div>}
    </div>
  );
}

const fmtValue = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4).replace(/\.?0+$/, ""));

export default async function GamePage({ params }: { params: Promise<{ date: string; gameId: string }> }) {
  const { date, gameId } = await params;
  const found = getGame(date, gameId);
  if (!found) notFound();
  const { slate, game } = found;
  const stats = getStatList();
  const model = getModel();
  const r = evaluateGame(model, slate, game, stats.map((s) => s.label));
  const shown = model.rows.filter((row) => row.show);
  const rows = shown.length ? shown : model.rows;
  const home = slate.teams[game.home.id];
  const away = slate.teams[game.away.id];

  return (
    <>
      <p className="small">
        <Link href={`/slate/${date}`}>← {fmtDateLong(date)}</Link>
      </p>

      <section className="matchup">
        <Side team={game.away} score={r.away_score} spread={r.home_spread == null ? null : -r.home_spread} label="Away" />
        <div className="matchup-mid">
          <div className="muted small">{fmtTip(game.tip_time)}</div>
          <div className="big">{r.total == null ? "—" : r.total.toFixed(1)}</div>
          <div className="muted small">Projected total</div>
        </div>
        <Side team={game.home} score={r.home_score} spread={r.home_spread} label={game.neutral ? "Home (neutral)" : "Home"} />
      </section>

      <h2>Your model</h2>
      <p className="muted small">
        From <Link href="/model">the Model page</Link>. Stats are from games before {fmtDateLong(date)}.
      </p>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th className="left">Row</th>
              <th className="left">Name</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const res = r.rows[row.name.toUpperCase()];
              return (
                <tr key={row.name}>
                  <td className="left">{row.label || row.name}</td>
                  <td className="left muted"><code>{row.name}</code></td>
                  <td className={res?.error ? "err" : "strong"} title={res?.error ?? undefined}>
                    {res?.error ? "Error" : res?.value == null ? "—" : fmtValue(res.value)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Inputs</h2>
      <p className="muted small">
        Reference any cell as <code>[Side Window Stat]</code>, e.g. <code>[Home YTD Points/Game]</code>. Blank = no games in that window
        (counts as 0 in formulas).
      </p>
      <div className="table-wrap stats-wrap">
        <table className="stats inputs">
          <thead>
            <tr>
              <th rowSpan={2} className="left sticky-col">Stat</th>
              <th colSpan={5}>Home: {game.home.abbr}</th>
              <th colSpan={5}>Away: {game.away.abbr}</th>
              <th colSpan={5}>League</th>
            </tr>
            <tr>
              {[0, 1, 2].map((i) => (
                <Fragment key={i}>
                  {WINDOWS.map((w) => (
                    <th key={w}>{w}</th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="left sticky-col muted">Games</td>
              {[home, away].map((t, i) => (
                <Fragment key={i}>
                  {WINDOWS.map((w) => (
                    <td key={w} className="muted">{t?.[w]?.games ?? "—"}</td>
                  ))}
                </Fragment>
              ))}
              {WINDOWS.map((w) => (
                <td key={w} />
              ))}
            </tr>
            {stats.map((s) => (
              <tr key={s.id}>
                <td className="left sticky-col">{s.label}</td>
                {[home, away].map((t, i) => (
                  <Fragment key={i}>
                    {WINDOWS.map((w) => (
                      <td key={w}>{t?.[w]?.stats[s.label] == null ? "" : fmtStat(t[w].stats[s.label], s.fmt)}</td>
                    ))}
                  </Fragment>
                ))}
                {WINDOWS.map((w) => (
                  <td key={w} className="muted">{fmtStat(slate.league[w]?.[s.label], s.fmt)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
