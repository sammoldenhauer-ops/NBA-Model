# NBA Matchup Model

Automates the team-level NBA projection spreadsheet. A daily GitHub Action pulls box scores with hoopR, runs the model for every game on the slate, writes JSON to `web/public/data/`, and commits it. The commit triggers a Vercel redeploy of the Next.js site.

Full spec: [docs/NBA_MODEL_SPEC.md](docs/NBA_MODEL_SPEC.md).

## Layout

```
pipeline/
  config.R       weights, season types, rate method, sanity ranges (all CHECK items live here)
  stats.R        the 34 stat definitions (numerator / denominator per team-game) and mirror pairs
  fetch.R        hoopR box scores + schedule, ESPN fallback for games missing from the bulk file
  team_games.R   one row per team per game with opponent stats joined, possessions
  windows.R      YTD / L3 / H/A / Prior team values and league averages as of a date
  model.R        weighting, adjusted index, expected values, projected score
  export.R       JSON output
  run.R          entry point
  tests/         unit tests (run_tests.R)
web/             Next.js site (reads web/public/data at build time)
.github/workflows/daily.yml
```

## Running locally

Requires R 4.4+ with `hoopR dplyr tibble jsonlite testthat`, and Node 20+.

```sh
Rscript pipeline/tests/run_tests.R              # unit tests
Rscript pipeline/run.R                          # today's slate (Eastern date)
Rscript pipeline/run.R --date=2026-10-23        # one date
Rscript pipeline/run.R --backfill               # every slate this season through today

cd web && npm install && npm run dev            # http://localhost:3000
```

`run.R` exits non-zero and writes nothing if any sanity check fails (missing projection, NaN/Inf, spread sign mismatch, possessions outside 85–115).

## Deploying

1. **Vercel:** import the GitHub repo, set **Root Directory = `web`**, and keep the default Next.js settings. Every push to `main` redeploys.
2. **GitHub Actions:** the workflow runs at 13:30 UTC, October through June. It needs **Settings → Actions → General → Workflow permissions → Read and write** so it can commit the data. Run it by hand from the Actions tab (with an optional date or backfill).

## Model settings

The model reproduces Sam's spreadsheet cell for cell. The reverse-engineered formulas and their
quirks are in [docs/SHEET_FORMULAS.md](docs/SHEET_FORMULAS.md). Switches are in `pipeline/config.R`:

| Setting | Current | Note |
|---|---|---|
| Weights | pace 40/25/0/5, volume 60/15/0/5, rate 65/10/0/5 | Sheet uses H/A 30/20/20; set to 0 for now while weights are reworked |
| `missing_window` | `zero` (sheet) | A team's first game can't be projected (only the prior window counts); backfill skips those dates |
| `expected_formula` | `sheet` | Includes the Points / FGA / FTA / Opp. FTA / Rebound Rate exceptions |
| `league_avg` | `team_mean` (sheet) | Average of team values |

Still open:
- Playoffs in or out (regular season only for now).
- Stat line REB, OFF REBs, BLKs, STLs: need the formula text (`.xlsx` download of the sheet).
- Rate stats within a window: ratio of totals vs average of game rates. The sheet's inputs come from another tab.
- Possessions formula and turnover column (`total_turnovers`).

## Reproducing the spreadsheet

`pipeline/tests/fixtures/sheet_lal_bkn.csv` is a CSV export of the sheet's Team v Team tab. `test-sheet.R` feeds its window values and league averages into the model and checks every weighted, league, adjusted and expected cell, the stat line, and the score against it. To check another game, export it the same way and point the test at the new file.
