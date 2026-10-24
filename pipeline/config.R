# Model settings. Defaults reproduce Sam's spreadsheet ("Main Model - Team v Team").
# Where the sheet looks like it has a bug, the switch to the cleaner behaviour is
# here too. See docs/SHEET_FORMULAS.md for what each one does.

CONFIG <- list(
  # Window weights (Layer 1). The sheet uses a different set per section:
  #   pace 40/25/30/5, volume 60/15/20/5, rate 65/10/20/5.
  # H/A is set to 0 for now (Sam, 2026-10-23) so teams without home/away games
  # aren't penalised; weights are being reworked later.
  weights = list(
    pace   = c(ytd = 40, l3 = 25, ha = 0, prior = 5),  # possessions, points, efficiency
    volume = c(ytd = 60, l3 = 15, ha = 0, prior = 5),  # FGA, 3PA, FTA (own + opp)
    rate   = c(ytd = 65, l3 = 10, ha = 0, prior = 5)   # shooting %, rebounding, TO, AST, etc.
  ),

  # A team window with no games (e.g. no away games yet):
  #   "zero"        = counts as 0; weighted value divided by the total weight, as the
  #                   sheet does (its weights total 100)
  #   "renormalize" = dropped, remaining weights rescaled on both team and league side
  missing_window = "zero",

  # Expected-value formulas:
  #   "sheet" = reproduce the sheet cell-for-cell, including the cells that don't
  #             follow the standard pattern (Points, home FGA/FTA, Opp. FTA, Rebound Rate)
  #   "clean" = every paired stat uses adj_team x adj_opp_mirror x weighted_lg_team
  expected_formula = "sheet",

  # League average for a window:
  #   "team_mean" = average of the 30 teams' values for that window (sheet)
  #   "pooled"    = ratio of league-wide totals
  league_avg = "team_mean",

  # Minimum games for the L3 window. The sheet shows L3 for teams with 1-2 games.
  l3_min_games = 1,

  # hoopR season_type: 2 = regular season, 3 = playoffs, 5 = play-in.
  # CHECK: playoffs in or out. Regular season only for now.
  season_types = c(2),

  # How games are combined inside a window for rate stats.
  #   "totals" = ratio of summed numerators / summed denominators
  #   "mean"   = average of each game's rate
  # CHECK: the sheet's inputs come from another tab, so this can't be read off the export.
  rate_method = "totals",

  # Number of games in the "last N" window.
  last_n = 3,

  # Sanity range for expected possessions on every daily run.
  poss_range = c(85, 115),

  # Output directory for the website JSON (relative to repo root).
  out_dir = "web/public/data"
)
