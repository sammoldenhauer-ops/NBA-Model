# Point-in-time inputs for every completed game, for backtesting the Model sheet.
#   Rscript pipeline/backtest_inputs.R 2024 2025 2026 2027
# Writes pipeline/cache/inputs_<season>.ndjson.gz: one line per game date with the games
# (and final scores) plus each team's window stats and league averages using only
# games before that date, in the same shape as the site's slate files.

write_backtest_inputs <- function(season, tg = build_team_games(fetch_box(c(season - 1, season)))) {
  t0 <- Sys.time()
  long <- stats_long(tg)
  cur <- tg[tg$season == season & tg$home_away == "home", ]
  dates <- sort(unique(cur$game_date))
  out <- file.path("pipeline", "cache", sprintf("inputs_%d.ndjson.gz", season))
  dir.create(dirname(out), showWarnings = FALSE)
  con <- gzfile(out, open = "w")
  for (d in as.character(dates)) {
    w <- compute_windows(long, season, d)
    g <- cur[cur$game_date == as.Date(d), ]
    ids <- unique(c(g$team_id, g$opp_team_id))
    line <- list(
      date = d,
      season = season,
      games = lapply(seq_len(nrow(g)), function(i) list(
        game_id = g$game_id[i],
        home = list(id = g$team_id[i], abbr = g$team[i], final = g$pts[i]),
        away = list(id = g$opp_team_id[i], abbr = g$opp_team[i], final = g$opp_pts[i])
      )),
      teams = stats::setNames(lapply(ids, function(id) team_inputs(w, id)), ids),
      league = league_inputs(w)
    )
    writeLines(jsonlite::toJSON(line, auto_unbox = TRUE, null = "null", na = "null", digits = NA), con)
  }
  close(con)
  message(sprintf("Backtest inputs %d: %d dates, %d games -> %s (%.0fs)", season, length(dates), nrow(cur), out,
                  as.numeric(difftime(Sys.time(), t0, units = "secs"))))
  invisible(out)
}

if (sys.nframe() == 0) {
  suppressPackageStartupMessages(library(dplyr))
  for (f in c("config.R", "stats.R", "team_games.R", "windows.R", "fetch.R", "export.R")) source(file.path("pipeline", f))
  seasons <- as.integer(commandArgs(trailingOnly = TRUE))
  if (!length(seasons)) seasons <- 2024:2027
  for (season in seasons) write_backtest_inputs(season)
}
