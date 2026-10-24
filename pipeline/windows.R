# Layer 1: team values and league averages for each window, as of a date.
#
# Windows: ytd, l3, home, away, prior. "ha" in the model maps to home for the
# home team and away for the away team.

combine_window <- function(num, den, method = CONFIG$rate_method) {
  v <- if (method == "mean") mean(num / den) else sum(num) / sum(den)
  if (is.finite(v)) v else NA_real_
}

summarise_window <- function(df, ...) {
  df |>
    dplyr::group_by(...) |>
    dplyr::summarise(value = combine_window(num, den), n = dplyr::n_distinct(game_id), .groups = "drop")
}

# long:   output of stats_long() for current + prior season
# season: the current season (hoopR label, e.g. 2027)
# as_of:  game date; only games strictly before it count
compute_windows <- function(long, season, as_of, last_n = CONFIG$last_n,
                            l3_min_games = CONFIG$l3_min_games, league_avg = CONFIG$league_avg) {
  as_of <- as.Date(as_of)
  cur   <- long[long$season == season & long$game_date < as_of, ]
  prior <- long[long$season == season - 1, ]

  last_games <- cur |>
    dplyr::distinct(team_id, game_id, game_date) |>
    dplyr::group_by(team_id) |>
    dplyr::slice_max(game_date, n = last_n, with_ties = FALSE) |>
    dplyr::filter(dplyr::n() >= l3_min_games) |>   # too few games -> window missing
    dplyr::ungroup()
  l3 <- dplyr::semi_join(cur, last_games, by = c("team_id", "game_id"))

  splits <- list(
    ytd   = cur,
    l3    = l3,
    home  = cur[cur$home_away == "home", ],
    away  = cur[cur$home_away == "away", ],
    prior = prior
  )
  team <- dplyr::bind_rows(lapply(names(splits), function(w) {
    summarise_window(splits[[w]], team_id, stat) |> dplyr::mutate(window = w)
  }))
  team$value[!is.finite(team$value)] <- NA_real_

  league <- dplyr::bind_rows(lapply(names(splits), function(w) {
    # The sheet averages the teams' values (every team counts equally); "pooled"
    # weights by games instead. L3 is always an average of team values.
    if (league_avg == "team_mean" || w == "l3") {
      team[team$window == w, ] |>
        dplyr::group_by(stat) |>
        dplyr::summarise(value = mean(value, na.rm = TRUE), n = sum(!is.na(value)), .groups = "drop") |>
        dplyr::mutate(window = w)
    } else {
      summarise_window(splits[[w]], stat) |> dplyr::mutate(window = w)
    }
  }))
  league$value[!is.finite(league$value)] <- NA_real_

  list(team = team, league = league)
}

# Wide per-stat table for one team in one matchup role ("home" / "away").
# Columns: stat, team_<w>, lg_<w>, n_<w> for w in ytd, l3, ha, prior.
team_window_table <- function(windows, team_id, side) {
  source_window <- c(ytd = "ytd", l3 = "l3", ha = side, prior = "prior")
  tid <- team_id
  team_rows <- windows$team[windows$team$team_id == tid, ]
  out <- tibble::tibble(stat = STAT_DEFS$id)
  for (w in names(source_window)) {
    t <- team_rows[team_rows$window == source_window[[w]], c("stat", "value", "n")]
    names(t) <- c("stat", paste0("team_", w), paste0("n_", w))
    l <- windows$league[windows$league$window == source_window[[w]], c("stat", "value")]
    names(l) <- c("stat", paste0("lg_", w))
    out <- out |> dplyr::left_join(t, by = "stat") |> dplyr::left_join(l, by = "stat")
  }
  out
}
