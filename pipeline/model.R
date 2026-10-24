# Layers 2-4: weighting, adjusted index, expected values, projected score.

WINDOWS <- c("ytd", "l3", "ha", "prior")

# Google Sheets MROUND(x, 0.5). R's round() rounds halves to even, so don't use it.
round_half <- function(x) floor(x * 2 + 0.5) / 2

# Layer 2. tbl has team_<w> and lg_<w> columns for each window.
# A window with no team value or no league value is dropped from both sides and
# the remaining weights are renormalised. CHECK against sheet.
add_weighted <- function(tbl, weights = CONFIG$weights) {
  tv <- as.matrix(tbl[paste0("team_", WINDOWS)])
  lv <- as.matrix(tbl[paste0("lg_", WINDOWS)])
  avail <- !is.na(tv) & !is.na(lv)
  w <- matrix(weights[WINDOWS], nrow(tv), length(WINDOWS), byrow = TRUE) * avail
  tv[!avail] <- 0
  lv[!avail] <- 0
  wsum <- rowSums(w)

  for (win in WINDOWS) tbl[[paste0("diff_", win)]] <- tbl[[paste0("team_", win)]] - tbl[[paste0("lg_", win)]]
  tbl$weight_sum    <- wsum
  tbl$weighted_team <- ifelse(wsum > 0, rowSums(w * tv) / wsum, NA_real_)
  tbl$weighted_lg   <- ifelse(wsum > 0, rowSums(w * lv) / wsum, NA_real_)
  tbl$adj           <- tbl$weighted_team / tbl$weighted_lg
  tbl
}

# Layer 3: one side's estimate for a paired stat.
expected_value <- function(adj_team, adj_opp_mirror, weighted_lg_team) {
  adj_team * adj_opp_mirror * weighted_lg_team
}

add_expected <- function(team_tbl, opp_tbl) {
  mirror <- STAT_DEFS$mirror[match(team_tbl$stat, STAT_DEFS$id)]
  opp_adj <- opp_tbl$adj[match(mirror, opp_tbl$stat)]
  team_tbl$expected <- expected_value(team_tbl$adj, opp_adj, team_tbl$weighted_lg)
  team_tbl
}

# Layer 4.
score_from_expected <- function(exp_pts_home, exp_opp_pts_away, exp_pts_away, exp_opp_pts_home) {
  raw_home <- (exp_pts_home + exp_opp_pts_away) / 2
  raw_away <- (exp_pts_away + exp_opp_pts_home) / 2
  home <- round_half(raw_home)
  away <- round_half(raw_away)
  list(
    raw_home = raw_home, raw_away = raw_away,
    home = home, away = away,
    home_spread = away - home,
    away_spread = home - away,
    total = home + away
  )
}

# Projected stat lines: average of the team's estimate and the opponent's
# "allowed" estimate. CHECK: REB, OREB, BLK, STL have no counting-stat pair in
# the spec, so they are left out until the sheet's formulas are confirmed.
LINE_STATS <- c("fga", "fg3a", "fta", "ast", "tov")

projected_line <- function(team_tbl, opp_tbl) {
  ex <- function(tbl, s) tbl$expected[tbl$stat == s]
  stats::setNames(
    vapply(LINE_STATS, function(s) (ex(team_tbl, s) + ex(opp_tbl, paste0("opp_", s))) / 2, numeric(1)),
    LINE_STATS
  )
}

# Full projection for one game from the two teams' window tables.
project_matchup <- function(home_windows, away_windows, weights = CONFIG$weights) {
  h <- add_weighted(home_windows, weights)
  a <- add_weighted(away_windows, weights)
  h <- add_expected(h, a)
  a <- add_expected(a, h)

  # Possessions: average of the two weighted values (not the adj x adj method).
  exp_poss <- (h$weighted_team[h$stat == "poss"] + a$weighted_team[a$stat == "poss"]) / 2
  h$expected[h$stat == "poss"] <- exp_poss
  a$expected[a$stat == "poss"] <- exp_poss

  ex <- function(tbl, s) tbl$expected[tbl$stat == s]
  score <- score_from_expected(ex(h, "pts"), ex(a, "opp_pts"), ex(a, "pts"), ex(h, "opp_pts"))

  list(
    home = h,
    away = a,
    possessions = exp_poss,
    score = score,
    lines = list(home = projected_line(h, a), away = projected_line(a, h))
  )
}
