// Alternate spreads: chance a team covers any spread, from how past games finished,
// plus FanDuel payout math. Browser-safe.
//
// Two estimates, both checked on held-out seasons (scripts/confidence.ts builds them):
//   book  - centred on the sportsbook spread. The more accurate of the two: the line
//           predicts final margins better than the sheet does.
//   model - centred on the sheet's projected margin, rescaled (the sheet's margins run
//           ~10% too narrow), with the sheet's own, wider error.
// Each stores how far past results finished from the centre, by size of the centre,
// as d = favourite's actual margin minus the size of the expected margin.

export type AltDist = { seasons: number[]; buckets: { max: number; n: number; d: Record<string, number> }[] };
export type AltDists = { book: AltDist; model: AltDist & { a: number; b: number } };

export const ALT_BUCKETS = [4, 8, Infinity];

// games: expected home margin (book: -home spread) and actual home margin.
export function buildAltDist(games: { expected: number; margin: number }[], seasons: number[]): AltDist {
  const buckets = ALT_BUCKETS.map((max) => ({ max, n: 0, d: {} as Record<string, number> }));
  for (const g of games) {
    const L = Math.abs(g.expected);
    const favMargin = g.expected >= 0 ? g.margin : -g.margin;
    const b = buckets[ALT_BUCKETS.findIndex((m) => L < m)];
    const k = String(Math.round((favMargin - L) * 2) / 2); // half points keep the file small
    b.d[k] = (b.d[k] ?? 0) + 1;
    b.n++;
  }
  // JSON has no Infinity.
  return { seasons, buckets: buckets.map((b) => ({ ...b, max: Number.isFinite(b.max) ? b.max : 999 })) };
}

// Least squares: actual margin = a + b * sheet margin.
export function fitScale(games: { proj: number; margin: number }[]): { a: number; b: number } {
  const n = games.length;
  const mx = games.reduce((s, g) => s + g.proj, 0) / n, my = games.reduce((s, g) => s + g.margin, 0) / n;
  const sxy = games.reduce((s, g) => s + (g.proj - mx) * (g.margin - my), 0), sxx = games.reduce((s, g) => s + (g.proj - mx) ** 2, 0);
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}
export const modelCentre = (m: { a: number; b: number }, projHomeMargin: number) => m.a + m.b * projHomeMargin;

export type Odds = { win: number; push: number };

// Last ~2 weeks of the regular season (both teams 72+ games, neither past 82). On
// 2023-26 the sheet's 5+ point disagreements with the book covered only ~1 in 3 here
// (61-73% fading them, every season): rest and tanking are priced by the book but
// invisible to the stats. A late-season term in the ATS confidence model didn't improve
// its held-out Brier score, so this stays a warning.
export const isLateSeason = (homeGames: number, awayGames: number) =>
  (homeGames + awayGames) / 2 >= 72 && Math.max(homeGames, awayGames) <= 82;
// Teams outside the play-in spots late in the season (the sheet's Motivation section).
export const isTanking = (seed: number | null | undefined, games: number) => seed != null && seed >= 11 && games >= 65;
export const LATE_NOTE = "Late season: rest and tanking decisions aren't in the stats. In the last 2 weeks of 2023-26, the model's 5+ point disagreements with the book covered only about 1 in 3 (every season), and favourites of 4+ covered 59%. Trust the book column.";

// P(team covers altSpread) and P(push). expected = expected home margin (book: -home
// spread; model: modelCentre(...)); altSpread = the spread on the team's bet (-9.5, +4).
export function coverOdds(dist: AltDist, expected: number, teamIsHome: boolean, altSpread: number): Odds {
  const L = Math.abs(expected);
  const b = dist.buckets.find((x) => L < x.max) ?? dist.buckets[dist.buckets.length - 1];
  const teamIsFav = teamIsHome === expected >= 0;
  // Shifted onto tonight's centre a past result can land between whole margins: split it
  // across both. A 0 margin can't happen (overtime).
  let win = 0, push = 0;
  const score = (favMargin: number, c: number): void => {
    if (favMargin === 0) {
      score(1, c / 2);
      score(-1, c / 2);
      return;
    }
    const m = (teamIsFav ? favMargin : -favMargin) + altSpread;
    if (Math.abs(m) < 1e-9) push += c;
    else if (m > 0) win += c;
  };
  for (const [k, c] of Object.entries(b.d)) {
    const fm = L + Number(k), lo = Math.floor(fm), w = fm - lo;
    if (w < 1e-9) score(lo, c);
    else {
      score(lo, c * (1 - w));
      score(lo + 1, c * w);
    }
  }
  return { win: win / b.n, push: push / b.n };
}

// Multiplier = total paid back per $1 staked, stake included (decimal odds).
export const breakEvenMultiplier = (o: Odds) => (o.win > 0 ? (1 - o.push) / o.win : Infinity);
export function toAmerican(mult: number): string {
  if (!Number.isFinite(mult) || mult <= 1) return "—";
  return mult >= 2 ? `+${Math.round((mult - 1) * 100)}` : `${Math.round(-100 / (mult - 1))}`;
}

// FanDuel's predict format sells whole contracts that each pay $1. The multiplier shown is
// $1 / price cut to two decimals (53¢ shows as 1.88x, 87¢ as 1.14x), and each contract
// carries a fee of about 4¢ x sqrt(price x (1 - price)), to a tenth of a cent. Checked
// against five of Sam's slips ($10 at 2x: 19 contracts for $9.88; 1.14x: 11 for $9.71;
// 7.69x: 69 for $9.87; 1.88x: 18; 1.78x: 17).
export const contractPrice = (mult: number) => Math.floor(100 / mult + 1e-9) / 100;
export const contractFee = (price: number) => Math.round(40 * Math.sqrt(price * (1 - price))) / 1000;
export const shownMultiplier = (price: number) => Math.floor(100 / price + 1e-9) / 100;
export function fanduelBet(mult: number, stake: number) {
  const price = contractPrice(mult), fee = contractFee(price);
  const contracts = price > 0 ? Math.floor(stake / (price + fee) + 1e-9) : 0;
  const cost = Math.round(100 * (contracts * price + Math.round(100 * contracts * fee) / 100)) / 100;
  return { price, contracts, cost, payout: contracts };
}
// Expected profit on a FanDuel bet: each contract pays $1 on a win; a push refunds the cost.
export const fanduelProfit = (o: Odds, bet: ReturnType<typeof fanduelBet>) => o.win * bet.payout + o.push * bet.cost - bet.cost;
// Lowest multiplier FanDuel can show that clears the given edge after fees (1 = break even).
export function fanduelNeeded(o: Odds, edge = 1): { price: number; mult: number } | null {
  for (let c = 99; c >= 1; c--) {
    const price = c / 100, cost = price + contractFee(price);
    if ((o.win + o.push * cost) / cost >= edge) return { price, mult: shownMultiplier(price) };
  }
  return null;
}
