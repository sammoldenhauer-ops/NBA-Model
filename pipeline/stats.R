# Stat definitions (spec section 3).
#
# Every stat is stored per team-game as a numerator and a denominator, so one
# aggregation rule covers everything:
#   counting stats -> den = 1, window value = sum(num) / n games (per-game average)
#   rate stats     -> window value = sum(num) / sum(den)  (ratio of totals)

STAT_DEFS <- tibble::tribble(
  ~id,            ~label,                     ~kind,   ~fmt,    ~mirror,
  "poss",         "Possessions",              "count", "dec1",  NA,
  "pts",          "Points/Game",              "count", "dec1",  "opp_pts",
  "off_eff",      "Off. Efficiency",          "rate",  "dec3",  "def_eff",
  "opp_pts",      "Opp. Points/Game",         "count", "dec1",  "pts",
  "def_eff",      "Def. Efficiency",          "rate",  "dec3",  "off_eff",
  "fga",          "FGA/Game",                 "count", "dec1",  "opp_fga",
  "opp_fga",      "Opp. FGA/Game",            "count", "dec1",  "fga",
  "fg3a",         "3PA/Game",                 "count", "dec1",  "opp_fg3a",
  "opp_fg3a",     "Opp. 3PA/Game",            "count", "dec1",  "fg3a",
  "fta",          "FTA/Game",                 "count", "dec1",  "opp_fta",
  "opp_fta",      "Opp. FTA/Game",            "count", "dec1",  "fta",
  "efg",          "eFG%",                     "rate",  "pct",   "opp_efg",
  "opp_efg",      "Opp. eFG%",                "rate",  "pct",   "efg",
  "fg2_rate",     "2-Point Rate",             "rate",  "pct",   "opp_fg2_rate",
  "opp_fg2_rate", "Opp. 2-Point Rate",        "rate",  "pct",   "fg2_rate",
  "fg3_pct",      "3P%",                      "rate",  "pct",   "opp_fg3_pct",
  "opp_fg3_pct",  "Opp. 3P%",                 "rate",  "pct",   "fg3_pct",
  "fg3_rate",     "3-Point Rate",             "rate",  "pct",   "opp_fg3_rate",
  "opp_fg3_rate", "Opp. 3-Point Rate",        "rate",  "pct",   "fg3_rate",
  "ft_pct",       "FT%",                      "rate",  "pct",   NA,
  "oreb_pct",     "OREB%",                    "rate",  "pct",   "opp_oreb_pct",
  "opp_oreb_pct", "Opp. OREB%",               "rate",  "pct",   "oreb_pct",
  "dreb_pct",     "DREB%",                    "rate",  "pct",   "opp_dreb_pct",
  "opp_dreb_pct", "Opp. DREB%",               "rate",  "pct",   "dreb_pct",
  "reb_rate",     "Rebound Rate",             "rate",  "pct",   NA,
  "blk_pct",      "Block%",                   "rate",  "pct",   NA,
  "stl_pct",      "Steals/Defensive Play%",   "rate",  "pct",   NA,
  "tov",          "Turnovers/Game",           "count", "dec1",  "opp_tov",
  "opp_tov",      "Opp. Turnovers/Game",      "count", "dec1",  "tov",
  "ast",          "Assists/Game",             "count", "dec1",  "opp_ast",
  "opp_ast",      "Opp. Assists/Game",        "count", "dec1",  "ast",
  "ast_to",       "AST/TO Ratio",             "rate",  "dec2",  "opp_ast_to",
  "opp_ast_to",   "Opp. AST/TO Ratio",        "rate",  "dec2",  "ast_to",
  "plus_minus",   "Box Score +/-",            "count", "dec1",  NA  # CHECK: point differential
)

# Numerator / denominator for each stat from a team-game row (own + opp_ columns).
stat_components <- function(tg) {
  one <- rep(1, nrow(tg))
  with(tg, list(
    poss         = list(poss, one),
    pts          = list(pts, one),
    off_eff      = list(pts, poss),
    opp_pts      = list(opp_pts, one),
    def_eff      = list(opp_pts, poss),
    fga          = list(fga, one),
    opp_fga      = list(opp_fga, one),
    fg3a         = list(fg3a, one),
    opp_fg3a     = list(opp_fg3a, one),
    fta          = list(fta, one),
    opp_fta      = list(opp_fta, one),
    efg          = list(fgm + 0.5 * fg3m, fga),
    opp_efg      = list(opp_fgm + 0.5 * opp_fg3m, opp_fga),
    fg2_rate     = list(fga - fg3a, fga),
    opp_fg2_rate = list(opp_fga - opp_fg3a, opp_fga),
    fg3_pct      = list(fg3m, fg3a),
    opp_fg3_pct  = list(opp_fg3m, opp_fg3a),
    fg3_rate     = list(fg3a, fga),
    opp_fg3_rate = list(opp_fg3a, opp_fga),
    ft_pct       = list(ftm, fta),
    oreb_pct     = list(oreb, oreb + opp_dreb),
    opp_oreb_pct = list(opp_oreb, opp_oreb + dreb),
    dreb_pct     = list(dreb, dreb + opp_oreb),
    opp_dreb_pct = list(opp_dreb, opp_dreb + oreb),
    reb_rate     = list(reb, reb + opp_reb),
    blk_pct      = list(blk, opp_fga - opp_fg3a),
    stl_pct      = list(stl, poss),
    tov          = list(tov, one),
    opp_tov      = list(opp_tov, one),
    ast          = list(ast, one),
    opp_ast      = list(opp_ast, one),
    ast_to       = list(ast, tov),
    opp_ast_to   = list(opp_ast, opp_tov),
    plus_minus   = list(pts - opp_pts, one)
  ))
}

# Long table: one row per team-game per stat, with num and den.
stats_long <- function(tg) {
  comps <- stat_components(tg)
  stopifnot(identical(sort(names(comps)), sort(STAT_DEFS$id)))
  keys <- tg[, c("season", "game_id", "game_date", "team_id", "home_away")]
  dplyr::bind_rows(lapply(names(comps), function(s) {
    dplyr::mutate(keys, stat = s, num = comps[[s]][[1]], den = comps[[s]][[2]])
  }))
}
