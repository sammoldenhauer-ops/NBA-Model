import Link from "next/link";
import { notFound } from "next/navigation";
import ModelTable from "@/components/ModelTable";
import { getDates, getGame, getSlate, type Lines, type Team } from "@/lib/data";
import { fmtDateLong, fmtNum, fmtSpread, fmtTip, teamColor } from "@/lib/format";

export const dynamicParams = false;

export function generateStaticParams() {
  return getDates().flatMap((date) =>
    (getSlate(date)?.games ?? []).map((g) => ({ date, gameId: g.game_id })),
  );
}

const LINE_COLS: { key: keyof Lines; label: string }[] = [
  { key: "fga", label: "FGA" },
  { key: "fg3a", label: "3PA" },
  { key: "fta", label: "FTA" },
  { key: "ast", label: "AST" },
  { key: "tov", label: "TO" },
];

function Side({ team, score, spread, label }: { team: Team; score: number; spread: number; label: string }) {
  return (
    <div className="side" style={{ borderColor: teamColor(team.color) }}>
      <div className="muted small">{label}</div>
      <div className="side-team">
        {team.logo && <img src={team.logo} alt="" width={44} height={44} />}
        <div>
          <div className="side-name">{team.name}</div>
          <div className="muted small">Spread {fmtSpread(spread)}</div>
        </div>
      </div>
      <div className="side-score">{score.toFixed(1)}</div>
      {team.final != null && <div className="muted small">Final: {team.final}</div>}
    </div>
  );
}

export default async function GamePage({ params }: { params: Promise<{ date: string; gameId: string }> }) {
  const { date, gameId } = await params;
  const found = getGame(date, gameId);
  if (!found) notFound();
  const { game } = found;
  const p = game.projection;

  return (
    <>
      <p className="small">
        <Link href={`/slate/${date}`}>← {fmtDateLong(date)}</Link>
      </p>

      <section className="matchup">
        <Side team={game.away} score={p.away_score} spread={p.away_spread} label="Away" />
        <div className="matchup-mid">
          <div className="muted small">{fmtTip(game.tip_time)}</div>
          <div className="big">{p.total.toFixed(1)}</div>
          <div className="muted small">Projected total</div>
          <div className="small">Poss. {fmtNum(p.possessions)}</div>
        </div>
        <Side team={game.home} score={p.home_score} spread={p.home_spread} label={game.neutral ? "Home (neutral)" : "Home"} />
      </section>

      <h2>Projected stat lines</h2>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr>
              <th className="left">Team</th>
              <th>PTS</th>
              {LINE_COLS.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["away", "home"] as const).map((s) => (
              <tr key={s}>
                <td className="left">{game[s].abbr}</td>
                <td className="strong">{fmtNum(s === "home" ? p.raw_home : p.raw_away)}</td>
                {LINE_COLS.map((c) => (
                  <td key={c.key}>{fmtNum(game.lines[s][c.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Model detail</h2>
      <p className="muted small">
        Adjusted = weighted team ÷ weighted league average (1.000 = league average). Expected = team adj × opponent’s
        mirror adj × team’s weighted league average. The Wt column shows each window’s weight for that
        stat.
      </p>
      <ModelTable game={game} />
    </>
  );
}
