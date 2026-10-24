import Link from "next/link";
import { notFound } from "next/navigation";
import SheetGrid from "@/components/SheetGrid";
import { getConfidenceGames, getDates, getGame, getSlate, getStatList, getTracking, type Team } from "@/lib/data";
import PrecedentPanel from "@/components/Precedent";
import { readRows } from "@/lib/tracking";
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
  const conf = getConfidenceGames()?.games[game.game_id] ?? null;
  const tf = getTracking();
  const tracking = tf ? readRows(tf) : [];
  const pct = (p: number | null | undefined) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);
  const abbr = (side: string | null) => (side === "home" ? game.home.abbr : side === "away" ? game.away.abbr : "—");
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

      <h2>Line and confidence</h2>
      <div className="table-wrap">
        <table className="lines">
          <thead>
            <tr><th className="left" /><th className="left">Line</th><th className="left">Model</th><th className="left">Pick</th><th>Confidence</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="left">Spread</td>
              <td className="left">{game.line ? `${game.home.abbr} ${fmtSpread(game.line.home_spread)}` : "—"}</td>
              <td className="left">{r.home_spread == null ? "—" : `${game.home.abbr} ${fmtSpread(r.home_spread)}`}</td>
              <td className="left">{conf?.ats.side && game.line ? `${abbr(conf.ats.side)} ${fmtSpread(conf.ats.side === "home" ? game.line.home_spread : -game.line.home_spread)}` : "—"}</td>
              <td className="strong">{pct(conf?.ats.p)}{conf && !conf.ats.skill && <span className="muted small"> · no proven edge</span>}</td>
            </tr>
            <tr>
              <td className="left">Total</td>
              <td className="left">{game.line?.total ?? "—"}</td>
              <td className="left">{r.total ?? "—"}</td>
              <td className="left">{conf?.ou.side ? (conf.ou.side === "over" ? "Over" : "Under") : "—"}</td>
              <td className="strong">{pct(conf?.ou.p)}{conf && !conf.ou.skill && <span className="muted small"> · no proven edge</span>}</td>
            </tr>
            <tr>
              <td className="left">Winner</td>
              <td className="left">{game.line?.home_ml != null ? `${game.home.abbr} ${game.line.home_ml > 0 ? "+" : ""}${game.line.home_ml} / ${game.away.abbr} ${game.line.away_ml! > 0 ? "+" : ""}${game.line.away_ml}` : "—"}</td>
              <td className="left">{abbr(conf?.winner.team ?? null)}</td>
              <td className="left">{abbr(conf?.winner.team ?? null)}</td>
              <td className="strong">{pct(conf?.winner.p)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {conf && (
        <p className="muted small">
          Past games like this landed within ±{conf.margin_band[0].toFixed(1)} of the projected margin half the time (±{conf.margin_band[1].toFixed(1)} for 80%),
          and within ±{conf.total_band[0].toFixed(1)} / ±{conf.total_band[1].toFixed(1)} of the projected total. <Link href="/confidence">How confidence works</Link>
        </p>
      )}

      <h2>History in this spot</h2>
      <p className="muted small">
        Each team&apos;s record when the model had them in the same situation as tonight. Past seasons are backtests of the current sheet.{" "}
        <Link href="/tracking">Full tracking</Link>
      </p>
      <PrecedentPanel rows={tracking} home={game.home.abbr} away={game.away.abbr} homeSpread={r.home_spread} season={slate.season} />

      <h2>Model sheet</h2>
      <p className="muted small">
        <Link href="/model">The Model sheet</Link> with {game.home.abbr} at home and {game.away.abbr} away, using stats from games before{" "}
        {fmtDateLong(date)}. Hover an error to see why.
      </p>
      <SheetGrid model={model} view={view} maxHeight="80vh" />
    </>
  );
}
