"use client";

import { useEffect, useRef, useState } from "react";
import { LATE_NOTE, breakEvenMultiplier, coverOdds, fanduelBet, fanduelNeeded, fanduelProfit, modelCentre, toAmerican, type AltDists, type Odds } from "@/lib/altline";
import { fmtSpread } from "@/lib/format";

// Edge to ask for on top of break-even (after fees): covers the ~1-2 point error in these estimates.
const CUSHION = 1.05;
const need = (o: Odds, edge = 1) => fanduelNeeded(o, edge)?.mult ?? Infinity;
const SPREADS = Array.from({ length: 61 }, (_, i) => -15 + i * 0.5);

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const mx = (m: number) => (Number.isFinite(m) ? `${m.toFixed(2)}x` : "—");
const money = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const spreadLabel = (x: number) => (x === 0 ? "ML" : fmtSpread(x));

type Basis = "book" | "model";
type Props = { dists: AltDists; homeLine: number; projHomeMargin: number | null; home: string; away: string; late?: boolean };

export default function AltLadder({ dists, homeLine, projHomeMargin, home, away, late }: Props) {
  const [teamIsHome, setTeamIsHome] = useState(homeLine <= 0); // start on the favourite
  const teamLine = teamIsHome ? homeLine : -homeLine;
  const [alt, setAlt] = useState(String(teamLine));
  const [stake, setStake] = useState("10");
  const [mult, setMult] = useState("");
  const [paid, setPaid] = useState("");
  const [pays, setPays] = useState("");
  const hasModel = projHomeMargin != null;
  const [basis, setBasis] = useState<Basis>("book");
  const scroller = useRef<HTMLDivElement>(null);

  const centre = { book: -homeLine, model: hasModel ? modelCentre(dists.model, projHomeMargin) : null };
  const odds = (b: Basis, x: number): Odds | null => {
    const c = centre[b];
    return c == null ? null : coverOdds(dists[b], c, teamIsHome, x);
  };

  // Keep the book line in view when the ladder opens or the team changes.
  useEffect(() => {
    const box = scroller.current, row = box?.querySelector<HTMLElement>("tr.alt-line");
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }, [teamIsHome]);

  const pick = (isHome: boolean) => {
    setTeamIsHome(isHome);
    setAlt(String(isHome ? homeLine : -homeLine));
  };
  const altN = num(alt), stakeN = num(stake) ?? 0, multN = num(mult);
  const abbr = teamIsHome ? home : away;
  // The slip's own numbers, when entered, beat the estimate from the multiplier.
  const paidN = num(paid), paysN = num(pays);
  const slip = paidN && paysN ? { price: paidN / paysN, contracts: paysN, cost: paidN, payout: paysN } : null;
  const bet = slip ?? (multN != null && multN > 1 ? fanduelBet(multN, stakeN) : null);
  const selBases: Basis[] = hasModel ? ["book", "model"] : ["book"];

  return (
    <div className="alt">
      <div className="alt-teams">
        {[false, true].map((isHome) => (
          <button key={String(isHome)} className={`tab${teamIsHome === isHome ? " active" : ""}`} onClick={() => pick(isHome)}>
            {isHome ? home : away} {fmtSpread(isHome ? homeLine : -homeLine)}
          </button>
        ))}
        {hasModel && (
          <span className="alt-basis small muted">
            Price from
            {(["book", "model"] as const).map((b) => (
              <button key={b} className={`tab${basis === b ? " active" : ""}`} onClick={() => setBasis(b)}>{b === "book" ? "Book" : "Model"}</button>
            ))}
          </span>
        )}
      </div>
      {late && hasModel && <p className="small late-note alt-note">{LATE_NOTE}</p>}
      <div className="alt-scroll" ref={scroller}>
        <table className="alt-table small">
          <thead>
            <tr><th className="left">{abbr}</th><th>Book</th>{hasModel && <th>Model</th>}<th title="Lowest FanDuel multiplier that breaks even after fees">Need</th><th title="Fair odds before fees">Odds</th></tr>
          </thead>
          <tbody>
            {SPREADS.map((x) => {
              const ob = odds("book", x)!, om = odds("model", x), o = basis === "model" && om ? om : ob;
              const gap = om ? om.win - ob.win : 0;
              return (
                <tr key={x} className={`${x === altN ? "alt-sel" : ""}${x === teamLine ? " alt-line" : ""}`} onClick={() => setAlt(String(x))}>
                  <td className="left">{spreadLabel(x)}{x === teamLine && <span className="muted"> line</span>}</td>
                  <td>{pct(ob.win)}</td>
                  {hasModel && <td className={Math.abs(gap) >= 0.05 ? (gap > 0 ? "pos" : "neg") : ""}>{pct(om!.win)}</td>}
                  <td>{mx(need(o))}</td>
                  <td className="muted">{toAmerican(breakEvenMultiplier(o))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="alt-form small">
        <label>Spread <input className="num-in" value={alt} onChange={(e) => setAlt(e.target.value)} inputMode="decimal" /></label>
        <label>Stake $<input className="num-in" value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" /></label>
        <label>FanDuel <input className="num-in" placeholder="1.88" value={mult} onChange={(e) => setMult(e.target.value)} inputMode="decimal" />x</label>
        <label className="muted">or slip: paid $<input className="num-in" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" /> pays $<input className="num-in" value={pays} onChange={(e) => setPays(e.target.value)} inputMode="decimal" /></label>
      </div>
      {altN != null && (
        <div className="alt-out small">
          <div className="strong">{abbr} {altN === 0 ? "to win" : fmtSpread(altN)}</div>
          {bet && (
            <div>
              {slip ? "From your slip" : `${bet.contracts} contracts at ${Math.round(bet.price * 100)}¢ + fee`}: {money(bet.cost)} · pays {money(bet.payout)} if it hits
              {" "}({mx(bet.payout / bet.cost)} after fees, {toAmerican(bet.payout / bet.cost)})
            </div>
          )}
          {selBases.map((b) => {
            const o = odds(b, altN)!;
            const ev = bet ? fanduelProfit(o, bet) : null;
            const verdict = ev == null ? null : ev >= bet!.cost * (CUSHION - 1) ? "worth it" : ev > 0 ? "thin edge" : "not worth it";
            return (
              <div key={b} className={verdict === "worth it" ? "pos" : verdict === "not worth it" ? "neg" : ""}>
                {b === "book" ? "Book history" : "Model"}: covers <b>{pct(o.win)}</b>{o.push > 0.002 && <> (push {pct(o.push)})</>} · FanDuel break-even {mx(need(o))} · worth it at {mx(need(o, CUSHION))}+
                {ev != null && <> · expected {ev >= 0 ? "+" : ""}{money(ev)} → <b>{verdict}</b></>}
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small alt-note">
        Book: how {dists.book.buckets.reduce((s, b) => s + b.n, 0).toLocaleString()} past games finished against the sportsbook spread. Model: the same, around
        the sheet&apos;s projected margin. On held-out seasons the book column was the more accurate; model numbers in green/red differ from it by 5+ points.
        FanDuel multipliers include its per-contract fee (worked out from your slips; enter a slip&apos;s paid/pays for exact numbers).
        &quot;Worth it&quot; asks for a 5% edge after fees.
      </p>
    </div>
  );
}
