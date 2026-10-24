import Link from "next/link";
import { notFound } from "next/navigation";
import SheetGrid from "@/components/SheetGrid";
import { getDates, getGame, getSlate, getStatList, type Team } from "@/lib/data";
import { fmtDateLong, fmtSpread, fmtTip, teamColor } from "@/lib/format";
import { formatCell, scoreGame, slateSource } from "@/lib/sheet";
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

export default async function GamePage({ params }: { params: Promise<{ date: string; gameId: string }> }) {
  const { date, gameId } = await params;
  const found = getGame(date, gameId);
  if (!found) notFound();
  const { slate, game } = found;
  const model = getModel();
  const r = scoreGame(model, slateSource(slate, game), getStatList().map((s) => s.label));
  const view = (a: string) => {
    const c = r.get(a);
    return {
      text: formatCell(c, model.formats[a]),
      error: c.error ? `${c.error.code}: ${c.error.message}` : undefined,
      numeric: typeof c.value === "number" || !!c.error,
    };
  };

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

      <h2>Model sheet</h2>
      <p className="muted small">
        <Link href="/model">The Model sheet</Link> with {game.home.abbr} at home and {game.away.abbr} away, using stats from games before{" "}
        {fmtDateLong(date)}. Hover an error to see why.
      </p>
      <SheetGrid model={model} view={view} maxHeight="80vh" />
    </>
  );
}
