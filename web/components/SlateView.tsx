import Link from "next/link";
import type { Game, Slate, Team } from "@/lib/data";
import { fmtDateLong, fmtSpread, fmtTip, teamColor } from "@/lib/format";
import DatePicker from "./DatePicker";

function TeamRow({ team, score, spread, isHome }: { team: Team; score: number; spread: number; isHome: boolean }) {
  return (
    <div className="team-row">
      <span className="swatch" style={{ background: teamColor(team.color) }} />
      {team.logo && <img className="logo" src={team.logo} alt="" width={28} height={28} />}
      <span className="team-name">
        <span className="abbr">{team.abbr}</span>
        <span className="full muted">{team.name}</span>
        {isHome && <span className="tag">home</span>}
      </span>
      <span className="spread">{fmtSpread(spread)}</span>
      <span className="score">{score.toFixed(1)}</span>
      {team.final != null && <span className="final">{team.final}</span>}
    </div>
  );
}

function GameCard({ date, game }: { date: string; game: Game }) {
  const p = game.projection;
  const isFinal = game.home.final != null && game.away.final != null;
  return (
    <Link className="card game-card" href={`/game/${date}/${game.game_id}`}>
      <div className="card-head">
        <span className="muted small">{isFinal ? "Final" : fmtTip(game.tip_time)}</span>
        <span className="muted small">
          Total <strong className="fg">{p.total.toFixed(1)}</strong>
        </span>
      </div>
      <div className="cols-head muted small">
        <span />
        <span className="spread">Spread</span>
        <span className="score">Proj</span>
        {isFinal && <span className="final">Actual</span>}
      </div>
      <TeamRow team={game.away} score={p.away_score} spread={p.away_spread} isHome={false} />
      <TeamRow team={game.home} score={p.home_score} spread={p.home_spread} isHome={!game.neutral} />
    </Link>
  );
}

export default function SlateView({ slate, dates }: { slate: Slate; dates: string[] }) {
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>{fmtDateLong(slate.date)}</h1>
          <p className="muted small">
            {slate.games.length} game{slate.games.length === 1 ? "" : "s"} · updated{" "}
            {new Date(slate.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET
          </p>
        </div>
        <DatePicker current={slate.date} dates={dates} />
      </div>
      <div className="grid">
        {slate.games.map((g) => (
          <GameCard key={g.game_id} date={slate.date} game={g} />
        ))}
      </div>
    </>
  );
}
