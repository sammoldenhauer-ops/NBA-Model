# Pipeline settings. The pipeline only builds the stat inputs; the model itself is
# Sam's formulas in web/model.json, built on the site's Model page.

CONFIG <- list(
  # League average for a window:
  #   "team_mean" = average of the 30 teams' values for that window (as Sam's sheet does)
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
  rate_method = "totals",

  # Number of games in the "last N" window.
  last_n = 3,

  # Output directory for the website JSON (relative to repo root).
  out_dir = "web/public/data"
)
