# Layers 2-4: weighting, adjusted index, expected values, projected score.
# Reverse-engineered from the sheet export; see docs/SHEET_FORMULAS.md.

WINDOWS <- c("ytd", "l3", "ha", "prior")

# Google Sheets MROUND(x, 0.5). R's round() rounds halves to even, so don't use it.
round_half <- function(x) floor(x * 2 + 0.5) / 2

# Layer 2. tbl has stat, team_<w> and lg_<w> columns for each window.
add_weighted <- function(tbl, weights = CONFIG$weights, missing = CONFIG$missing_window) {
  tv <- as.matrix(tbl[paste0("team_", WINDOWS)])
  lv <- as.matrix(tbl[paste0("lg_", WINDOWS)])
  w  <- stat_weights(tbl$stat, weights)[, WINDOWS, drop = FALSE]

  if (missing == "zero") {
    # Sheet: an empty window contributes 0 and the total is still divided by 100.
    tv[is.na(tv)] <- 0
    lv[is.na(lv)] <- 0
    wt <- w
    wl <- w
  } else {
    avail <- !is.na(tv) & !is.na(lv)
    wt <- w * avail
    wl <- wt
    tv[!avail] <- 0
    lv[!avail] <- 0
  }

  for (win in WINDOWS) tbl[[paste0("diff_", win)]] <- tbl[[paste0("team_", win)]] - tbl[[paste0("lg_", win)]]
  tbl$weight_sum    <- rowSums(wt)
  tbl$weighted_team <- ifelse(rowSums(wt) > 0, rowSums(wt * tv) / rowSums(wt), NA_real_)
  tbl$weighted_lg   <- ifelse(rowSums(wl) > 0, rowSums(wl * lv) / rowSums(wl), NA_real_)
  tbl$adj           <- tbl$weighted_team / tbl$weighted_lg
  tbl
}

# Layer 3: one side's estimate for a paired stat.
expected_value <- function(adj_team, adj_opp_mirror, weighted_lg_team) {
  adj_team * adj_opp_mirror * weighted_lg_team
}

# Standard expected value for every stat. Unpaired stats (FT%, Block%, STL%,
# Rebound Rate) carry their weighted team value, as the sheet does for FT%/BLK/STL.
standard_expected <- function(team_tbl, opp_tbl) {
  mirror <- STAT_DEFS$mirror[match(team_tbl$stat, STAT_DEFS$id)]
  opp_adj <- opp_tbl$adj[match(mirror, opp_tbl$stat)]
  ifelse(is.na(mirror), team_tbl$weighted_team,
         expected_value(team_tbl$adj, opp_adj, team_tbl$weighted_lg))
}

# Cells where the sheet departs from the standard formula. Each one reproduces the
# sheet's number; most look like a cell reference pointing at the wrong row/team.
apply_sheet_overrides <- function(h, a) {
  g <- function(tbl, s, col) tbl[[col]][tbl$stat == s]
  std <- function(team, opp, s) {               # standard formula for stat s of `team`
    m <- STAT_DEFS$mirror[STAT_DEFS$id == s]
    expected_value(g(team, s, "adj"), g(opp, m, "adj"), g(team, s, "weighted_lg"))
  }
  set <- function(tbl, s, v) { tbl$expected[tbl$stat == s] <- v; tbl }
  hx <- h; ax <- a

  # Points (home): uses the away team's H/A league average for points (the
  # league's away-game scoring) instead of the home team's weighted league average.
  hx <- set(hx, "pts", g(h, "pts", "adj") * g(a, "opp_pts", "adj") * g(a, "pts", "lg_ha"))
  # Points (away): uses the away team's own Opp. Points adj and weighted league
  # average instead of the home team's Opp. Points adj.
  ax <- set(ax, "pts", g(a, "pts", "adj") * g(a, "opp_pts", "adj") * g(a, "opp_pts", "weighted_lg"))

  # FGA: the home FGA cell and away Opp. FGA cell hold each other's formula.
  hx <- set(hx, "fga", std(a, h, "opp_fga"))
  ax <- set(ax, "opp_fga", std(h, a, "fga"))

  # FTA (home) holds the away Opp. FTA formula; the Opp. FTA row has its home and
  # away cells swapped.
  hx <- set(hx, "fta", std(a, h, "opp_fta"))
  hx <- set(hx, "opp_fta", std(a, h, "opp_fta"))
  ax <- set(ax, "opp_fta", std(h, a, "opp_fta"))

  # Rebound Rate is paired with itself: adj x adj x weighted league average.
  hx <- set(hx, "reb_rate", g(h, "reb_rate", "adj")^2 * g(h, "reb_rate", "weighted_lg"))
  ax <- set(ax, "reb_rate", g(a, "reb_rate", "adj")^2 * g(a, "reb_rate", "weighted_lg"))

  list(home = hx, away = ax)
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

# Projected stat line at the top of the sheet: each team's own Expected value.
# REB, OFF REBs, BLKs, STLs can't be derived from the exported values alone
# (need the formula text), so they are left out for now.
LINE_STATS <- c("fga", "fg3a", "fta", "ast", "tov")

projected_line <- function(team_tbl) {
  stats::setNames(team_tbl$expected[match(LINE_STATS, team_tbl$stat)], LINE_STATS)
}

# Full projection for one game from the two teams' window tables.
project_matchup <- function(home_windows, away_windows, weights = CONFIG$weights,
                            formula = CONFIG$expected_formula, missing = CONFIG$missing_window) {
  h <- add_weighted(home_windows, weights, missing)
  a <- add_weighted(away_windows, weights, missing)
  h$expected <- standard_expected(h, a)
  a$expected <- standard_expected(a, h)
  if (formula == "sheet") {
    o <- apply_sheet_overrides(h, a)
    h <- o$home
    a <- o$away
  }

  # Possessions: average of the two weighted values.
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
    lines = list(home = projected_line(h), away = projected_line(a))
  )
}
