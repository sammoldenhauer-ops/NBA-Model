# NBA Matchup Model

A daily GitHub Action pulls box scores with hoopR, builds every team's stats by window (YTD, L3, Home, Away, Prior) plus league averages, writes them to `web/public/data/`, and commits. The commit triggers a Vercel redeploy of the Next.js site.

The pipeline does **no model math**. Projections come from the Model sheet in [`web/model.json`](web/model.json): a spreadsheet laid out like Sam's Team v Team tab, edited on the site's **Model** page and run for every game.

Full spec: [docs/NBA_MODEL_SPEC.md](docs/NBA_MODEL_SPEC.md).

## Layout

```
pipeline/
  config.R       season types, league-average and rate methods
  stats.R        the 41 stat definitions (numerator / denominator per team-game)
  fetch.R        hoopR box scores + schedule, ESPN fallback for games missing from the bulk file
  team_games.R   one row per team per game with opponent stats joined, possessions
  windows.R      YTD / L3 / H/A / Prior team values and league averages as of a date
  export.R       per-date slate JSON (games + stat inputs)
  stats_export.R raw stat tables (CSV + JSON)
  run.R          entry point
  tests/         unit tests (run_tests.R)
web/             Next.js site (reads web/public/data and web/model.json at build time)
.github/workflows/daily.yml
```

## Raw stat tables

Every run writes the model's inputs to `web/public/data/stats/` (overwritten daily, history in git):

| File | Contents |
|---|---|
| `team_stats.csv` | One row per team per window (YTD, L3, Home, Away, Prior) with games played and all 41 stats |
| `league_averages.csv` | League average per window (mean of the 30 teams) |
| `team_games.csv` | Every team-game this season and last: box score, opponent box, possessions, per-game stats |
| `slate.csv` | Today's games and tip times (UTC) |

On the live site they're at `/data/stats/<file>`. The **Team stats** page lists them with a ready-made
`=IMPORTDATA("…")` formula for Google Sheets. Rates are decimals (0.523 = 52.3%).

## Running locally

Requires R 4.4+ with `hoopR dplyr tibble jsonlite testthat`, and Node 20+.

```sh
Rscript pipeline/tests/run_tests.R              # unit tests
Rscript pipeline/run.R                          # today's slate (Eastern date)
Rscript pipeline/run.R --date=2026-10-23        # one date
Rscript pipeline/run.R --backfill               # every slate this season through today

cd web && npm install && npm run dev            # http://localhost:3000
```

`run.R` skips (with a warning) any slate where a team has no stats.

## Deploying

1. **Vercel:** import the GitHub repo, set **Root Directory = `web`**, and keep the default Next.js settings. Every push to `main` redeploys.
2. **GitHub Actions:** the workflow runs at 13:30 UTC, October through June. It needs **Settings → Actions → General → Workflow permissions → Read and write** so it can commit the data. Run it by hand from the Actions tab (with an optional date or backfill).

## Building the model

The **Model** page is a spreadsheet laid out like the Team v Team tab: score and stat line at the top, then
YTD / L3 / H/A / Prior / Weighted rows for each stat, with Home, Away, Weight, League Average,
Difference, Adjusted and Expected columns. Pick the home and away teams and every stat cell fills in.

- Stat cells are formulas like `=[Home YTD Points/Game]`, `=[Away H/A EFG%]`, `=[League Home Points/Game]`, `=[Home Team]`.
  H/A = the home team's home games / the away team's away games. `--` = no games in that window.
- Everything else is ordinary Sheets-style formulas: `A1`, `$D$8`, ranges `B13:B16`, `+ - * / ^ &`, comparisons,
  `SUMPRODUCT`, `SUM`, `AVERAGE`, `MIN`, `MAX`, `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `MROUND`, `ABS`, `IF`, `IFERROR`.
- Like Sheets: an empty cell is 0; `--` is 0 inside `SUMPRODUCT`/`SUM` and `#VALUE!` in plain arithmetic.
- Editing: click a cell and type, Enter to commit; double-click or F2 to edit; while typing a formula, click or drag
  over cells to insert references; Ctrl+C / Ctrl+V shifts relative references; Ctrl+Z undoes.
- The slate reads the home and away score cells (B4 / B5 by default, set on the page); spread and total come from those.
- Starting weights are 10/0/0/90 (YTD, L3, H/A, Prior) in the Weight column of each section.

Edits are kept in your browser as a draft. To publish: **Download model.json**, then upload it to the
`web/` folder on GitHub and commit. Vercel redeploys and every visitor sees the new projections.
`npx tsx scripts/build-model-template.ts` (in `web/`) rebuilds the starting template, overwriting `model.json`.

Possessions use 0.475 x FTA and seasons include play-in and playoff games, both to match TeamRankings.
Still open: whether rate stats within a window should be
ratio of totals (current) or average of game rates (`pipeline/config.R`).

## Weight schedule and confidence

- **Weight schedule.** The Weight cells look up a table (O7:S17 in the Model sheet) by the two teams' average
  games played, so weights move from mostly last season in week 1 toward this season as games accumulate.
  `web/scripts/tune-weights.ts` picks each stage's weights by backtest over the last three seasons (every
  YTD/L3/H/A/Prior combination, scored on margin + total error, checked leave-one-season-out). The daily
  workflow re-tunes on Mondays. Weighted rows skip windows with no games instead of counting them as 0.
- **Confidence.** `web/scripts/confidence.ts` re-projects every game since 2023-24 through the published sheet with
  point-in-time stats, joins sportsbook lines (`pipeline/cache/lines.csv`, via ESPN), and fits three models,
  each validated leave-one-season-out (a model that doesn't beat a flat guess shows its base rate):
  - against the spread: sheet edge vs the line, recent cover margin, record vs point differential
  - over/under: 3P% luck made and allowed (YTD vs last season, shrunk over the first 20 games)
  - winner: market spread, record vs point differential (sheet margin when there's no line)
  It writes `public/data/confidence_games.json` (every slate game) and the report behind the **Confidence** page.
  Research scripts: `research*.ts` (what was tested and rejected).
- **Tracking** (`/tracking`): every finished game by team, home/away, model favourite/underdog and spread size
  (ML W-L, covers vs the model or the sportsbook); precedents for each matchup on game pages, slate cards and the
  Model page. Tested as a confidence feature (`research6.ts`): situational records do not predict future covers
  (they slightly reverse), so they are shown but not used in the confidence %.
- Historical inputs live in `pipeline/cache/inputs_<season>.ndjson.gz`; rebuild them with
  `Rscript pipeline/backtest_inputs.R 2024 2025 2026` after changing stat definitions.

## Injuries, home court and player-based projection

- **Player ratings** (`pipeline/injuries.R`): BPM-style, from Hollinger Game Score per 100 possessions scaled to
  team net rating, shrunk toward replacement (-2), point-in-time.
- **Injuries**: history uses the official NBA pregame injury report (`pipeline/injury_reports.py`, the last report
  at least an hour before tip, Out/Doubtful); today uses ESPN's injury report. Sheet references:
  `[Home Injury Value | BPM | Minutes | Count | List | DTD]`. The Injuries section's adjustment (method 1, value lost
  x 0.4; method 2 = BPM/2 each way; 0 = off) feeds the score cells.
- **Home court**: 1.5 points (half to each score).
- **Player-based projection**: `[Home Lineup Strength]` = available players' ratings x projected minutes. The
  section blends the sheet's margin 30% toward the player-based margin.
- **DARKO**: `pipeline/darko.py` archives DARKO's free daily board to `pipeline/cache/darko/` (no history is
  published), so DARKO can be backtested once snapshots accumulate. EPM's terms prohibit copying its data.

## Reproducing the spreadsheet

[docs/SHEET_FORMULAS.md](docs/SHEET_FORMULAS.md) has the spreadsheet's formulas (reverse-engineered from `docs/sheet_export_lal_bkn.csv`) for reference when rebuilding them on the Model page.
