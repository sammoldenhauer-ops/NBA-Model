# Pipeline settings. The pipeline only builds the stat inputs; the model itself is
# Sam's formulas in web/model.json, built on the site's Model page.

CONFIG <- list(
  # League average for a window:
  #   "team_mean" = average of the 30 teams' values for that window (as Sam's sheet does)
  #   "pooled"    = ratio of league-wide totals
  league_avg = "team_mean",

  # Possessions = FGA - OREB + TOV + fta_coef x FTA, averaged across both teams.
  # 0.475 matches TeamRankings; 0.44 is the common textbook value.
  fta_coef = 0.475,

  # Minimum games for the L3 window. The sheet shows L3 for teams with 1-2 games.
  l3_min_games = 1,

  # hoopR season_type: 2 = regular season, 3 = playoffs, 5 = play-in.
  # All three, to match TeamRankings (Sam's sheet source), whose season numbers
  # include play-in and playoff games. Use c(2) for regular season only.
  season_types = c(2, 3, 5),

  # How games are combined inside a window for rate stats.
  #   "totals" = ratio of summed numerators / summed denominators
  #   "mean"   = average of each game's rate
  rate_method = "totals",

  # Number of games in the "last N" window.
  last_n = 3,

  # ESPN team ids in the Eastern Conference (the rest are West), for conference seeds.
  east_team_ids = c("1", "2", "4", "5", "8", "11", "14", "15", "17", "18", "19", "20", "27", "28", "30"),

  # Output directory for the website JSON (relative to repo root).
  out_dir = "web/public/data"
)
