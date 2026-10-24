test_that("round_half matches Sheets MROUND(x, 0.5), not banker's rounding", {
  expect_equal(round_half(58.3), 58.5)
  expect_equal(round_half(58.2), 58.0)
  expect_equal(round_half(58.25), 58.5)   # R's round(58.25 * 2) / 2 gives 58.0
  expect_equal(round_half(58.75), 59.0)
  expect_equal(round_half(82.5), 82.5)
  expect_equal(round_half(0.25), 0.5)
})

test_that("worked example: LAL expected offensive efficiency", {
  # 1.1300 (LAL Off. Eff adj) x 0.6643 (BKN Def. Eff adj) x 1.078 (LAL weighted lg avg)
  expect_equal(round(expected_value(1.1300, 0.6643, 1.078), 3), 0.809)
  expect_equal(round(expected_value(1.1300, 0.6643, 1.078), 2), 0.81)
})

test_that("worked example: LAL 82.5, BKN 58.5, spread 24, total 141", {
  s <- score_from_expected(exp_pts_home = 79.5, exp_opp_pts_away = 85.5,
                           exp_pts_away = 49.3, exp_opp_pts_home = 67.3)
  expect_equal(s$raw_home, 82.5)
  expect_equal(s$raw_away, 58.3)
  expect_equal(s$home, 82.5)
  expect_equal(s$away, 58.5)
  expect_equal(s$home_spread, -24.0)
  expect_equal(s$away_spread, 24.0)
  expect_equal(s$total, 141.0)
})

test_that("favourite always gets the negative spread", {
  s <- score_from_expected(100, 100, 110, 110)
  expect_true(s$away > s$home)
  expect_lt(s$away_spread, 0)
  expect_gt(s$home_spread, 0)
})

one_stat_tbl <- function(team, lg, stat = "pts") {
  tibble::tibble(
    stat = stat,
    team_ytd = team[1], team_l3 = team[2], team_ha = team[3], team_prior = team[4],
    lg_ytd = lg[1], lg_l3 = lg[2], lg_ha = lg[3], lg_prior = lg[4]
  )
}

test_that("weighted values use 40/25/30/5 and adj = weighted team / weighted league", {
  t <- add_weighted(one_stat_tbl(c(110, 120, 100, 105), c(112, 115, 113, 111)))
  expect_equal(t$weighted_team, (40 * 110 + 25 * 120 + 30 * 100 + 5 * 105) / 100)
  expect_equal(t$weighted_lg,   (40 * 112 + 25 * 115 + 30 * 113 + 5 * 111) / 100)
  expect_equal(t$adj, t$weighted_team / t$weighted_lg)
  # Not the weighted average of per-window ratios.
  ratios <- c(110 / 112, 120 / 115, 100 / 113, 105 / 111)
  expect_false(isTRUE(all.equal(t$adj, sum(c(40, 25, 30, 5) * ratios) / 100)))
  expect_equal(t$diff_ytd, -2)
})

test_that("missing windows are dropped from both sides and weights renormalised", {
  t <- add_weighted(one_stat_tbl(c(110, NA, 100, 105), c(112, 115, 113, 111)))
  expect_equal(t$weight_sum, 75)
  expect_equal(t$weighted_team, (40 * 110 + 30 * 100 + 5 * 105) / 75)
  expect_equal(t$weighted_lg,   (40 * 112 + 30 * 113 + 5 * 111) / 75)

  only_prior <- add_weighted(one_stat_tbl(c(NA, NA, NA, 105), c(NA, NA, NA, 111)))
  expect_equal(only_prior$weighted_team, 105)
  expect_equal(only_prior$adj, 105 / 111)
})

# Build a full window table for a team where every window has the same team and
# league value, so weighted = that value and adj = team / league.
flat_table <- function(team_vals, lg_vals) {
  tibble::tibble(stat = STAT_DEFS$id) |>
    dplyr::mutate(
      team = unname(team_vals[stat]), lg = unname(lg_vals[stat]),
      team_ytd = team, team_l3 = team, team_ha = team, team_prior = team,
      lg_ytd = lg, lg_l3 = lg, lg_ha = lg, lg_prior = lg,
      n_ytd = 10L, n_l3 = 3L, n_ha = 5L, n_prior = 82L
    ) |>
    dplyr::select(-team, -lg)
}

test_that("expected values pair each stat with the opponent's mirror", {
  ids <- STAT_DEFS$id
  lg <- stats::setNames(rep(1, length(ids)), ids)
  lg[c("pts", "opp_pts")] <- 110
  lg["poss"] <- 100
  home <- lg; away <- lg
  home["pts"] <- 121       # home adj pts = 1.1
  away["opp_pts"] <- 99    # away allows 0.9x league
  away["pts"] <- 110
  home["opp_pts"] <- 110
  home["poss"] <- 102; away["poss"] <- 98

  p <- project_matchup(flat_table(home, lg), flat_table(away, lg))
  exp_h <- p$home$expected[p$home$stat == "pts"]
  exp_a_opp <- p$away$expected[p$away$stat == "opp_pts"]
  expect_equal(exp_h, 1.1 * 0.9 * 110)
  expect_equal(exp_a_opp, 0.9 * 1.1 * 110)
  expect_equal(p$score$raw_home, (exp_h + exp_a_opp) / 2)
  expect_equal(p$score$home, round_half(108.9))
  expect_equal(p$possessions, 100)
  # Unpaired stats get no expected value.
  expect_true(is.na(p$home$expected[p$home$stat == "ft_pct"]))
})
