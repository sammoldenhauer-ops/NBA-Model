# Raw stat tables for building the model by hand (spreadsheet-style).
# Written to web/public/data/stats/ and overwritten every run:
#   team_stats.csv       one row per team per window (YTD, L3, Home, Away, Prior), all 33 stats
#   league_averages.csv  one row per window
#   team_games.csv       every team-game (current + prior season): box score, opponent box, per-game stats
#   slate.csv            today's games with tip time and the model's projection
#   stats.json           team_stats + league averages for the website

STATS_WINDOWS <- c(ytd = "YTD", l3 = "L3", home = "Home", away = "Away", prior = "Prior")

stat_label <- function(ids) STAT_DEFS$label[match(ids, STAT_DEFS$id)]

# long -> wide: one column per stat, in STAT_DEFS order, headed with the sheet's label.
widen_stats <- function(df, keys) {
  wide <- tidyr::pivot_wider(df[, c(keys, "stat", "value")], names_from = stat, values_from = value)
  ids <- intersect(STAT_DEFS$id, names(wide))
  out <- wide[, c(keys, ids)]
  names(out) <- c(keys, stat_label(ids))
  out
}

team_directory <- function(tg) {
  tg |>
    dplyr::arrange(dplyr::desc(game_date)) |>
    dplyr::distinct(team_id, .keep_all = TRUE) |>
    dplyr::select(team_id, team, team_name) |>
    dplyr::arrange(team)
}

write_csv <- function(df, path) {
  df <- as.data.frame(df)
  num <- vapply(df, is.numeric, logical(1))
  df[num] <- lapply(df[num], function(x) signif(x, 6))
  utils::write.csv(df, path, row.names = FALSE, na = "")
  path
}

write_stats_files <- function(tg, long, windows, season, as_of, slate = NULL, projections = NULL,
                              out_dir = file.path(CONFIG$out_dir, "stats")) {
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  teams <- team_directory(tg[tg$season %in% c(season, season - 1), ])

  # Team stats by window.
  tw <- windows$team[windows$team$window %in% names(STATS_WINDOWS), ]
  games <- tw |> dplyr::group_by(team_id, window) |> dplyr::summarise(games = max(n), .groups = "drop")
  ts <- widen_stats(tw, c("team_id", "window")) |>
    dplyr::left_join(games, by = c("team_id", "window")) |>
    dplyr::right_join(tidyr::crossing(team_id = teams$team_id, window = names(STATS_WINDOWS)),
                      by = c("team_id", "window")) |>
    dplyr::left_join(teams, by = "team_id") |>
    dplyr::mutate(games = dplyr::coalesce(games, 0L),
                  window = factor(window, names(STATS_WINDOWS))) |>
    dplyr::arrange(window, team) |>
    dplyr::mutate(window = unname(STATS_WINDOWS[as.character(window)]))
  ts <- ts[, c("team", "team_name", "team_id", "window", "games", stat_label(STAT_DEFS$id))]

  # League averages by window.
  lw <- windows$league[windows$league$window %in% names(STATS_WINDOWS), ]
  la <- widen_stats(lw, "window") |>
    dplyr::mutate(window = factor(window, names(STATS_WINDOWS))) |>
    dplyr::arrange(window) |>
    dplyr::mutate(window = unname(STATS_WINDOWS[as.character(window)]))

  # Game log with per-game stat values.
  per_game <- long[long$season %in% c(season, season - 1), ] |>
    dplyr::mutate(value = ifelse(den == 0, NA_real_, num / den))
  gl <- tg[tg$season %in% c(season, season - 1), ] |>
    dplyr::select(season, game_date, game_id, team, team_id, opponent = opp_team, home_away,
                  pts:tov, opp_pts:opp_tov, poss) |>
    dplyr::left_join(widen_stats(per_game, c("game_id", "team_id")), by = c("game_id", "team_id")) |>
    dplyr::arrange(dplyr::desc(game_date), game_id, home_away)

  write_csv(ts, file.path(out_dir, "team_stats.csv"))
  write_csv(la, file.path(out_dir, "league_averages.csv"))
  write_csv(gl, file.path(out_dir, "team_games.csv"))

  if (!is.null(slate) && nrow(slate)) {
    sl <- slate[, c("game_date", "tip_time", "game_id", "away_abbr", "home_abbr", "away_name", "home_name")]
    names(sl) <- c("date", "tip_time_utc", "game_id", "away", "home", "away_name", "home_name")
    if (!is.null(projections)) {
      p <- do.call(rbind, lapply(projections, function(g) data.frame(
        game_id = g$game_id, proj_away = g$projection$away_score, proj_home = g$projection$home_score,
        home_spread = g$projection$home_spread, total = g$projection$total,
        possessions = g$projection$possessions)))
      sl <- dplyr::left_join(sl, p, by = "game_id")
    }
    write_csv(sl, file.path(out_dir, "slate.csv"))
  }

  jsonlite::write_json(list(
    as_of = as.character(as_of),
    season = season,
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    league_avg = CONFIG$league_avg,
    rate_method = CONFIG$rate_method,
    stats = lapply(seq_len(nrow(STAT_DEFS)), function(i) list(id = STAT_DEFS$id[i], label = STAT_DEFS$label[i], fmt = STAT_DEFS$fmt[i])),
    windows = unname(STATS_WINDOWS),
    team_stats = ts,
    league_averages = la
  ), file.path(out_dir, "stats.json"), dataframe = "rows", auto_unbox = TRUE, na = "null", digits = 6)

  message("Wrote stats tables to ", out_dir, " (as of ", as_of, ", ", nrow(teams), " teams, ", nrow(gl), " team-games)")
  invisible(out_dir)
}
