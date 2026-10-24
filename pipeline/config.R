# Model settings. Anything marked CHECK in NBA_MODEL_SPEC.md lives here so it
# can be flipped in one place once Sam confirms against the spreadsheet.

CONFIG <- list(
  # Window weights (Layer 1). Must sum to 100.
  weights = c(ytd = 40, l3 = 25, ha = 30, prior = 5),

  # hoopR season_type: 2 = regular season, 3 = playoffs, 5 = play-in.
  # CHECK: playoffs in or out. Regular season only for now.
  season_types = c(2),

  # How games are combined inside a window for rate stats.
  #   "totals" = ratio of summed numerators / summed denominators (spec default)
  #   "mean"   = average of each game's rate
  # CHECK against the sheet.
  rate_method = "totals",

  # Number of games in the "last N" window.
  last_n = 3,

  # Sanity range for expected possessions on every daily run.
  poss_range = c(85, 115),

  # Output directory for the website JSON (relative to repo root).
  out_dir = "web/public/data"
)
