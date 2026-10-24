import Link from "next/link";
import type { Game, Slate, Team } from "@/lib/data";
import { fmtDateLong, fmtSpread, fmtTip, teamColor } from "@/lib/format";
import { evaluateGame, type GameResult, type Model } from "@/lib/model";
import DatePicker from "./DatePicker";

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

function GameCard({ date, game, r }: { date: string; game: Game; r: GameResult }) {
  const isFinal = game.home.final != null && game.away.final != null;
  return (
    <Link className="card game-card" href={`/game/${date}/${game.game_id}`}>
      <div className="card-head">
        <span className="muted small">{isFinal ? "Final" : fmtTip(game.tip_time)}</span>
        <span className="muted small">
          Total <strong className="fg">{r.total == null ? "—" : r.total.toFixed(1)}</strong>
        </span>
      </div>
      <div className="cols-head muted small">
        <span />
        <span className="spread">Spread</span>
        <span className="score">Proj</span>
        {isFinal && <span className="final">Actual</span>}
      </div>
      <TeamRow team={game.away} score={r.away_score} spread={r.home_spread == null ? null : -r.home_spread} isHome={false} />
      <TeamRow team={game.home} score={r.home_score} spread={r.home_spread} isHome={!game.neutral} />
    </Link>
  );
}

export default function SlateView({ slate, dates, model, statLabels }: { slate: Slate; dates: string[]; model: Model; statLabels: string[] }) {
  const results = slate.games.map((g) => evaluateGame(model, slate, g, statLabels));
  const anyScore = results.some((r) => r.home_score != null && r.away_score != null);
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>{fmtDateLong(slate.date)}</h1>
          <p className="muted small">
            {slate.games.length} game{slate.games.length === 1 ? "" : "s"} · stats updated{" "}
            {new Date(slate.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
          </p>
        </div>
        <DatePicker current={slate.date} dates={dates} />
      </div>
      {!anyScore && (
        <p className="notice small">
          No projections yet. Build the <code>HOME_SCORE</code> and <code>AWAY_SCORE</code> rows on the{" "}
          <Link href="/model">Model</Link> page.
        </p>
      )}
      <div className="grid">
        {slate.games.map((g, i) => (
          <GameCard key={g.game_id} date={slate.date} game={g} r={results[i]} />
        ))}
      </div>
    </>
  );
}
