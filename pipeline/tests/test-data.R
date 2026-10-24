# Team-game table and window calculations on a tiny hand-built box score.

box_row <- function(game_id, date, team_id, ha, pts, fgm = 40, fga = 88, fg3m = 12, fg3a = 35,
                    ftm = 18, fta = 22, oreb = 10, dreb = 34, ast = 25, stl = 7, blk = 5, tov = 13,
                    season = 2027, season_type = 2) {
  data.frame(
    game_id = game_id, season = season, season_type = season_type, game_date = date,
    team_id = team_id, team_abbreviation = paste0("T", team_id), team_home_away = ha,
    team_score = pts, field_goals_made = fgm, field_goals_attempted = fga,
    three_point_field_goals_made = fg3m, three_point_field_goals_attempted = fg3a,
    free_throws_made = ftm, free_throws_attempted = fta, offensive_rebounds = oreb,
    defensive_rebounds = dreb, total_rebounds = oreb + dreb, assists = ast, steals = stl,
    blocks = blk, total_turnovers = tov
  )
}

test_that("team-game rows carry opponent stats and shared possessions", {
  box <- rbind(
    box_row(1, "2026-10-21", 1, "home", 110, fga = 90, oreb = 12, tov = 14, fta = 25),
    box_row(1, "2026-10-21", 2, "away", 100, fga = 85, oreb = 8,  tov = 10, fta = 20, dreb = 30)
  )
  tg <- build_team_games(box)
  expect_equal(nrow(tg), 2)
  t1 <- tg[tg$team_id == "1", ]
  expect_equal(t1$opp_pts, 100)
  expect_equal(t1$opp_dreb, 30)
  p1 <- 90 - 12 + 14 + 0.44 * 25
  p2 <- 85 - 8 + 10 + 0.44 * 20
  expect_equal(t1$poss, (p1 + p2) / 2)
  expect_equal(tg$poss[1], tg$poss[2])

  comps <- stat_components(t1)
  expect_equal(comps$efg[[1]] / comps$efg[[2]], (40 + 0.5 * 12) / 90)
  expect_equal(comps$oreb_pct[[1]] / comps$oreb_pct[[2]], 12 / (12 + 30))
  expect_equal(comps$blk_pct[[1]] / comps$blk_pct[[2]], 5 / (85 - 35))
  expect_equal(comps$def_eff[[1]] / comps$def_eff[[2]], 100 / t1$poss)
})

test_that("preseason / playoff rows are excluded and incomplete games dropped", {
  box <- rbind(
    box_row(1, "2026-10-21", 1, "home", 110), box_row(1, "2026-10-21", 2, "away", 100),
    box_row(2, "2026-10-05", 1, "home", 110, season_type = 1), box_row(2, "2026-10-05", 2, "away", 100, season_type = 1),
    box_row(3, "2026-10-22", 1, "home", 110)   # opponent row missing
  )
  tg <- build_team_games(box)
  expect_equal(sort(unique(tg$game_id)), "1")
})

# Team 1 plays four games (home, away, home, home) against teams 2-5; plus a
# prior-season game.
sample_long <- function() {
  box <- rbind(
    box_row(1, "2026-10-20", 1, "home", 100), box_row(1, "2026-10-20", 2, "away", 90),
    box_row(2, "2026-10-22", 1, "away", 110), box_row(2, "2026-10-22", 3, "home", 105),
    box_row(3, "2026-10-24", 1, "home", 120), box_row(3, "2026-10-24", 4, "away", 100),
    box_row(4, "2026-10-26", 1, "home", 130), box_row(4, "2026-10-26", 5, "away", 95),
    box_row(9, "2026-01-10", 1, "home", 99, season = 2026), box_row(9, "2026-01-10", 2, "away", 101, season = 2026)
  )
  stats_long(build_team_games(box))
}

val <- function(w, team, window, stat) {
  x <- w$team[w$team$team_id == team & w$team$window == window & w$team$stat == stat, ]
  if (nrow(x)) x$value else NA_real_
}

test_that("windows only use games before the slate date", {
  w <- compute_windows(sample_long(), 2027, "2026-10-26")
  expect_equal(val(w, "1", "ytd", "pts"), mean(c(100, 110, 120)))
  expect_equal(val(w, "1", "l3", "pts"), mean(c(100, 110, 120)))
  expect_equal(val(w, "1", "home", "pts"), mean(c(100, 120)))
  expect_equal(val(w, "1", "away", "pts"), 110)
  expect_equal(val(w, "1", "prior", "pts"), 99)
})

test_that("L3 takes the last three games; sheet allows fewer than three", {
  w <- compute_windows(sample_long(), 2027, "2026-10-27")
  expect_equal(val(w, "1", "l3", "pts"), mean(c(110, 120, 130)))
  expect_equal(val(w, "2", "l3", "pts"), 90)          # one game is enough (sheet)

  strict <- compute_windows(sample_long(), 2027, "2026-10-27", l3_min_games = 3)
  expect_true(is.na(val(strict, "2", "l3", "pts")))
  lg_l3 <- strict$league$value[strict$league$window == "l3" & strict$league$stat == "pts"]
  expect_equal(lg_l3, mean(c(110, 120, 130)))          # only team 1 qualifies
})

test_that("league average is the mean of team values (sheet) or pooled totals", {
  w <- compute_windows(sample_long(), 2027, "2026-10-27")
  lg <- function(x, win) x$league$value[x$league$window == win & x$league$stat == "pts"]
  team_ytd <- c(mean(c(100, 110, 120, 130)), 90, 105, 100, 95)
  expect_equal(lg(w, "ytd"), mean(team_ytd))
  pooled <- compute_windows(sample_long(), 2027, "2026-10-27", league_avg = "pooled")
  expect_equal(lg(pooled, "ytd"), mean(c(100, 110, 120, 130, 90, 105, 100, 95)))
})

test_that("rate stats use ratio of totals across the window", {
  l <- sample_long()
  l$num[l$stat == "fg3_pct" & l$game_id == "1" & l$team_id == "1"] <- 20  # 20/35 that game
  w <- compute_windows(l, 2027, "2026-10-23")
  expect_equal(val(w, "1", "ytd", "fg3_pct"), (20 + 12) / (35 + 35))
})

test_that("team_window_table maps home/away split to the matchup side", {
  w <- compute_windows(sample_long(), 2027, "2026-10-27")
  h <- team_window_table(w, "1", "home")
  a <- team_window_table(w, "1", "away")
  expect_equal(h$team_ha[h$stat == "pts"], mean(c(100, 120, 130)))
  expect_equal(a$team_ha[a$stat == "pts"], 110)
  expect_equal(nrow(h), nrow(STAT_DEFS))
})
