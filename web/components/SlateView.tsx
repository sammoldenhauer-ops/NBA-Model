import Link from "next/link";
import type { ConfidenceGames, Slate } from "@/lib/data";
import { precedentLine } from "./Precedent";
import type { TrackRow } from "@/lib/tracking";
import { isLateSeason, isTanking } from "@/lib/altline";
import { fmtDateLong } from "@/lib/format";
import { scoreGame, slateSource, type SheetModel } from "@/lib/sheet";
import DatePicker from "./DatePicker";
import SlateBoard, { type Card } from "./SlateBoard";

type Props = {
  slate: Slate;
  dates: string[];
  model: SheetModel;
  statLabels: string[];
  confidence: ConfidenceGames | null;
  modelHash: string;
  tracking: TrackRow[];
};

export default function SlateView({ slate, dates, model, statLabels, confidence, modelHash, tracking }: Props) {
  const cards: Card[] = slate.games.map((g) => {
    const r = scoreGame(model, slateSource(slate, g), statLabels);
    const conf = confidence?.games[g.game_id] ?? null;
    const prec = r.home_spread == null ? [] : [precedentLine(tracking, g.away.abbr, false, -r.home_spread), precedentLine(tracking, g.home.abbr, true, r.home_spread)].filter((x): x is string => !!x);
    const late = isLateSeason(slate.teams[g.home.id]?.YTD.games ?? 0, slate.teams[g.away.id]?.YTD.games ?? 0);
    const tanking = (id: string) => isTanking(slate.teams[id]?.YTD.stats["Conference Seed"], slate.teams[id]?.YTD.games ?? 0);
    const tank = { home: tanking(g.home.id), away: tanking(g.away.id) };
    return { game: g, home_score: r.home_score, away_score: r.away_score, home_spread: r.home_spread, total: r.total, conf, prec, late, tank };
  });
  const anyScore = cards.some((c) => c.home_score != null && c.away_score != null);
  const stale = confidence && confidence.model_hash !== modelHash
    ? "The Model sheet changed since confidence was last calibrated; the percentages update on the next daily run."
    : null;

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
          No projections yet. The slate reads the score cells set on the <Link href="/model">Model</Link> page.
        </p>
      )}
      <SlateBoard date={slate.date} cards={cards} staleNote={stale} alt={confidence?.alt_spread ?? null} />
    </>
  );
}
