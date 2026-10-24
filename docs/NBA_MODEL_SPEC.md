# NBA Team Matchup Model — Build Spec

This file describes a team-level NBA projection model that already exists as a spreadsheet. The job is to automate it: pull data daily, run the exact same calculations for every game on the slate, and show projected scores, spreads, and totals on a website hosted on Vercel.

**The spreadsheet is the source of truth.** If a formula in the sheet differs from anything written here, follow the sheet and flag the difference to Sam.

Items marked **CHECK** are decisions Sam needs to confirm.

---

## 1. Architecture

```
GitHub Action (daily, R + hoopR)
   └─ pulls game-level team box scores + today's schedule
   └─ runs the model for every game on today's slate
   └─ writes JSON to /web/public/data/
   └─ commits → Vercel redeploys automatically

Next.js site on Vercel
   └─ reads the JSON and displays the slate + game detail pages
```

- **Why not R on Vercel:** Vercel runs Node and Python, not R. R runs in GitHub Actions instead.
- **Why not live NBA Stats API calls:** stats.nba.com often blocks requests from cloud servers. Use hoopR's bulk loaders, which pull pre-built files from GitHub.

### Repo layout

```
/pipeline
  fetch.R          # load box scores + schedule
  team_games.R     # build one row per team per game, with opponent stats joined
  windows.R        # compute YTD / L3 / H/A / prior-season values + league averages
  model.R          # weighting, adjustment, expected values, scores
  export.R         # write JSON
  tests/           # unit tests that reproduce Sam's sheet
/web               # Next.js app
/.github/workflows/daily.yml
```

---

## 2. Data

- **Box scores:** `hoopR::load_nba_team_box(seasons = c(2026, 2027))`
- **Today's games:** `hoopR::espn_nba_scoreboard()` (or `load_nba_schedule()`)
- hoopR labels seasons by the year they end. The current season (2026-27) is `2027`; the prior season (2025-26) is `2026`.
- Regular-season games only. Exclude preseason. **CHECK:** playoffs in or out.
- Verify column names against the actual data before writing code. They are along the lines of `field_goals_attempted`, `three_point_field_goals_made`, `offensive_rebounds`, `team_home_away`, etc.
- Verify how often the hoopR release files update. If they lag more than a day, fall back to `espn_nba_team_box()` for the missing games.

### Build a team-game table

One row per team per game. Join each row to the other team's row in the same game so every row has both **own** and **opponent** box score numbers. All stats below come from this table.

---

## 3. Stat definitions (per game, from the box score)

Abbreviations: PTS, FGM, FGA, 3PM, 3PA, FTM, FTA, OREB, DREB, REB, AST, STL, BLK, TOV. Opponent versions start with `opp_`.

| # | Stat | Formula |
|---|------|---------|
| 1 | Possessions | Team estimate = FGA − OREB + TOV + 0.44×FTA. Average the team's and opponent's estimates so both teams in a game share one number. **CHECK** — Sam's existing data may have come from a source with its own formula. |
| 2 | Points/Game | PTS |
| 3 | Off. Efficiency | PTS ÷ Possessions (points per possession, ~1.1) |
| 4 | Opp. Points/Game | opp_PTS |
| 5 | Def. Efficiency | opp_PTS ÷ Possessions |
| 6 | FGA/Game | FGA |
| 7 | Opp. FGA/Game | opp_FGA |
| 8 | 3PA/Game | 3PA |
| 9 | Opp. 3PA/Game | opp_3PA |
| 10 | FTA/Game | FTA |
| 11 | Opp. FTA/Game | opp_FTA |
| 12 | eFG% | (FGM + 0.5×3PM) ÷ FGA |
| 13 | Opp. eFG% | (opp_FGM + 0.5×opp_3PM) ÷ opp_FGA |
| 14 | 2-Point Rate | (FGA − 3PA) ÷ FGA |
| 15 | Opp. 2-Point Rate | (opp_FGA − opp_3PA) ÷ opp_FGA |
| 16 | 3P% | 3PM ÷ 3PA |
| 17 | Opp. 3P% | opp_3PM ÷ opp_3PA |
| 18 | 3-Point Rate | 3PA ÷ FGA |
| 19 | Opp. 3-Point Rate | opp_3PA ÷ opp_FGA |
| 20 | FT% | FTM ÷ FTA |
| 21 | OREB% | OREB ÷ (OREB + opp_DREB) |
| 22 | Opp. OREB% | opp_OREB ÷ (opp_OREB + DREB) |
| 23 | DREB% | DREB ÷ (DREB + opp_OREB) |
| 24 | Opp. DREB% | opp_DREB ÷ (opp_DREB + OREB) |
| 25 | Rebound Rate | REB ÷ (REB + opp_REB) |
| 26 | Block% | BLK ÷ (opp_FGA − opp_3PA) |
| 27 | Steals/Defensive Play% | STL ÷ Possessions |
| 28 | Turnovers/Game | TOV |
| 29 | Opp. Turnovers/Game | opp_TOV |
| 30 | Assists/Game | AST |
| 31 | Opp. Assists/Game | opp_AST |
| 32 | AST/TO Ratio | AST ÷ TOV |
| 33 | Opp. AST/TO Ratio | opp_AST ÷ opp_TOV |
| 34 | Box Score +/- | PTS − opp_PTS (point differential). **CHECK** |

### Combining games within a window

- **Counting stats** (points, FGA, etc.): average per game.
- **Rate stats** (efficiency, %, rates, ratios): ratio of totals across the window, e.g. eFG% over L3 = (sum of FGM + 0.5 × sum of 3PM) ÷ sum of FGA. **CHECK** — the alternative is averaging each game's percentage.

---

## 4. The model — four layers

### Layer 1: Four time windows per stat, per team

| Window | What it covers | Weight |
|--------|----------------|--------|
| YTD | All current-season games before the game date | 40 |
| L3 | Team's last 3 games | 25 |
| H/A | Home team: its home games this season. Away team: its away games this season | 30 |
| Prior | Full prior season | 5 |

Each window has a matching **league average**: the full league average for that same split.

- YTD league avg = all teams, all current-season games
- L3 league avg = average across all teams' last-3-game values
- H/A league avg = all teams' home games (for the home team) or away games (for the away team)
- Prior league avg = all teams, full prior season

**Difference** (display only) = Team − League avg, per window.

### Layer 2: Weighted value and adjusted index

```
Weighted_Team = Σ (weight × team value)   ÷ 100
Weighted_Lg   = Σ (weight × league avg)   ÷ 100
Adj           = Weighted_Team ÷ Weighted_Lg
```

`Adj` is an index: 1.00 = league average. Note that it is the weighted team value divided by the weighted league average, not a weighted average of the per-window ratios.

**Missing windows** (early season with fewer than 3 games, no H/A games yet, team with no prior-season data): drop that window and divide by the sum of the remaining weights instead of 100, for both the team and league-average sides. **CHECK**

### Layer 3: Expected values — pair each stat with its mirror

Every team stat X pairs with the opponent's "Opp. X" (what that opponent allows). Each pair produces two estimates, one from each side of the matchup:

```
Exp_X(Home)       = Adj_X(Home)    × Adj_OppX(Away) × Weighted_Lg_X(Home)
Exp_OppX(Away)    = Adj_OppX(Away) × Adj_X(Home)    × Weighted_Lg_OppX(Away)
```

And the same in reverse for the away team's X against the home team's Opp. X.

**Worked example (from the sheet):** Lakers expected offensive efficiency = 1.1300 (LAL Off. Eff adj) × 0.6643 (BKN Def. Eff adj) × 1.078 (LAL weighted league avg) = 0.810.

#### Pairs

| Team stat | Mirror (opponent's) |
|-----------|---------------------|
| Points/Game | Opp. Points/Game |
| Off. Efficiency | Def. Efficiency |
| FGA | Opp. FGA |
| 3PA | Opp. 3PA |
| FTA | Opp. FTA |
| eFG% | Opp. eFG% |
| 2-Point Rate | Opp. 2-Point Rate |
| 3P% | Opp. 3P% |
| 3-Point Rate | Opp. 3-Point Rate |
| OREB% | Opp. OREB% |
| DREB% | Opp. DREB% |
| Turnovers | Opp. Turnovers |
| Assists | Opp. Assists |
| AST/TO | Opp. AST/TO |

**Possessions** uses a different method in the sheet: Expected Possessions = (Weighted_Poss(Home) + Weighted_Poss(Away)) ÷ 2.

**No mirror in the list:** FT%, Rebound Rate, Block%, Steals/Defensive Play%, Box Score +/-. Compute and display their weighted and adjusted values; no Expected value unless Sam says otherwise. **CHECK**

**Per-team projected stat lines** (FGA, 3PA, FTA, REB, OREB, AST, BLK, STL, TO shown at the top of the sheet): average of the two estimates for that team. **CHECK** against the sheet's formulas.

### Layer 4: Projected score, spread, total

```
Score_Home = round_half(  (Exp_Points(Home) + Exp_OppPoints(Away)) ÷ 2  )
Score_Away = round_half(  (Exp_Points(Away) + Exp_OppPoints(Home)) ÷ 2  )

Spread_Home = Score_Away − Score_Home
Spread_Away = Score_Home − Score_Away
Total       = Score_Home + Score_Away
```

- `round_half` = round to the nearest 0.5, matching Google Sheets `MROUND(x, 0.5)`. In R use `floor(x * 2 + 0.5) / 2`. Do **not** use R's `round()`, which rounds halves to even.
- Round only at the final step. All earlier layers use unrounded values.
- The team with the higher projected score always has the negative spread. Derive the sign from the model's two scores, never from a betting line.

**Worked example (from the sheet):** Lakers (79.5 + 85.5) ÷ 2 = 82.5. Brooklyn (49.3 + 67.3) ÷ 2 = 58.3 → 58.5. Spread LAL −24.0, BKN +24.0. Total 141.0.

---

## 5. Tests

- Sam will provide an export of his spreadsheet with formulas. Build unit tests that feed the sheet's input values into `model.R` and reproduce the sheet's outputs (weighted values, adjusted values, expected values, scores, spread, total) to display rounding.
- If any output does not match, check the sheet's formula for that cell and match it, then tell Sam what differed.
- Sanity checks on every daily run: every game on the slate has a projection; no NaN/Inf values; spread signs match the scores; possessions land in a normal NBA range.

---

## 6. Website (Next.js on Vercel)

**Slate page (home):** today's games, each showing teams, tip time, projected score for both teams, spread, and total. Date picker to view past slates.

**Game detail page:** a table laid out like the sheet. One row per stat per window (YTD, L3, H/A, Prior, Weighted), with columns for Home, Away, Weight, League Average (home/away), Difference (home/away), Adjusted (home/away), and Expected (home/away). Projected stat lines and score at the top.

**Data:** one JSON file per date in `/web/public/data/`, e.g. `2026-10-23.json`, plus `latest.json`.

---

## 7. Daily job

- GitHub Actions cron, once a day in the morning Eastern time during the season.
- Steps: install R + hoopR → run pipeline → run tests → commit JSON only if tests pass.
- On failure, keep the previous day's data live and log the error.

---

## 8. Later (not now)

- Pull sportsbook lines and show model spread/total vs. the market line.
- Track results: model vs. final score, ATS and over/under record.
- Player-level projections.
