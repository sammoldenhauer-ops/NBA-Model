# Layer 1: team values and league averages for each window, as of a date.
#
# Windows: ytd, l3, home, away, prior. "ha" in the model maps to home for the
# home team and away for the away team.

combine_window <- function(num, den, method = CONFIG$rate_method) {
  v <- if (method == "mean") mean(num / den) else sum(num) / sum(den)
  if (is.finite(v)) v else NA_real_
}

# Context stats for the YTD window, from this season's games before as_of:
#   rest_days  days since the team's last game (1 = second night of a back-to-back)
#   sos        strength of schedule: average point margin per game of the opponents
#              faced so far (their own games before as_of)
#   seed       place in the conference by win %, then wins (no tiebreakers)
context_rows <- function(cur, as_of, east = CONFIG$east_team_ids) {
  pts <- cur[cur$stat == "pts", c("game_id", "game_date", "team_id", "num")]
  opp <- cur[cur$stat == "opp_pts", c("game_id", "team_id", "num")]
  g <- dplyr::inner_join(pts, opp, by = c("game_id", "team_id"), suffix = c("", "_opp")) |>
    dplyr::mutate(margin = num - num_opp)
  if (!nrow(g)) return(NULL)
  mov <- g |> dplyr::group_by(team_id) |> dplyr::summarise(mov = mean(margin), .groups = "drop")
  faced <- dplyr::inner_join(g[, c("game_id", "team_id")], g[, c("game_id", "team_id")], by = "game_id",
                             suffix = c("", "_opp"), relationship = "many-to-many") |>
    dplyr::filter(team_id != team_id_opp) |>
    dplyr::left_join(mov, by = c("team_id_opp" = "team_id"))
  sos <- faced |> dplyr::group_by(team_id) |> dplyr::summarise(value = mean(mov), n = dplyr::n(), .groups = "drop")
  rest <- g |> dplyr::group_by(team_id) |>
    dplyr::summarise(value = as.numeric(as.Date(as_of) - max(game_date)), n = dplyr::n(), .groups = "drop")
  seed <- g |>
    dplyr::group_by(team_id) |>
    dplyr::summarise(w = sum(margin > 0), n = dplyr::n(), .groups = "drop") |>
    dplyr::mutate(conf = team_id %in% east, pct = w / n) |>
    dplyr::group_by(conf) |>
    dplyr::arrange(dplyr::desc(pct), dplyr::desc(w), team_id, .by_group = TRUE) |>
    dplyr::mutate(value = as.numeric(dplyr::row_number())) |>
    dplyr::ungroup() |>
    dplyr::select(team_id, value, n)
  dplyr::bind_rows(dplyr::mutate(rest, stat = "rest_days"), dplyr::mutate(sos, stat = "sos"), dplyr::mutate(seed, stat = "seed")) |>
    dplyr::mutate(window = "ytd")
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
  team <- dplyr::bind_rows(team, context_rows(cur, as_of))
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
