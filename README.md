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

## Open questions (CHECK)

| Item | Current behaviour | Where |
|---|---|---|
| Playoffs | Regular season only (`season_type` 2) | `config.R` |
| Possessions formula | FGA − OREB + TOV + 0.44×FTA, averaged across both teams; TOV = `total_turnovers` (includes team TOs) | `team_games.R` |
| Rate stats in a window | Ratio of totals | `config.R` `rate_method` |
| Missing windows | Dropped; remaining weights renormalised on both sides | `model.R` `add_weighted` |
| L3 with < 3 games | Window treated as missing | `windows.R` |
| Unpaired stats (FT%, Reb Rate, Blk%, Stl%, +/-) | Weighted + adjusted only, no expected | `stats.R` |
| Projected REB / OREB / BLK / STL lines | Not shown; no counting-stat pair in spec | `model.R` `LINE_STATS` |
| Box Score +/- | Point differential | `stats.R` |

## Reproducing the spreadsheet

Put an export of a game from the sheet at `pipeline/tests/fixtures/sheet_game.json` (format is documented in `pipeline/tests/test-sheet.R`). The test compares weighted, adjusted, and expected values and the score for every stat in the fixture.
