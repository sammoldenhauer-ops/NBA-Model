# Entry point.
#   Rscript pipeline/run.R                      # today's slate (Eastern date)
#   Rscript pipeline/run.R --date=2026-10-23    # a specific date
#   Rscript pipeline/run.R --backfill           # every slate this season up to the date
#
# Run from the repo root. Writes the stat inputs only; the projections come from
# Sam's formulas in web/model.json, evaluated by the website.

suppressPackageStartupMessages({
  library(dplyr)
})

script_dir <- local({
  f <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
  if (length(f)) dirname(normalizePath(f)) else "pipeline"
})
for (f in c("config.R", "stats.R", "team_games.R", "windows.R", "fetch.R", "export.R", "stats_export.R", "lines.R", "backtest_inputs.R", "injuries.R")) {
  source(file.path(script_dir, f))
}

args <- commandArgs(trailingOnly = TRUE)
arg_value <- function(name) {
  hit <- grep(paste0("^--", name, "="), args, value = TRUE)
  if (length(hit)) sub(paste0("^--", name, "="), "", hit[1]) else NULL
}
target_date <- as.Date(arg_value("date") %||% format(Sys.time(), "%Y-%m-%d", tz = "America/New_York"))
backfill <- "--backfill" %in% args

# hoopR labels seasons by the year they end; the season rolls over in August.
season_for <- function(d) as.integer(format(d, "%Y")) + (as.integer(format(d, "%m")) >= 8)
season <- season_for(target_date)
message("Target date ", target_date, " (season ", season, ")")

schedule <- fetch_schedule(season)
box <- fetch_box(c(season - 1, season))
box <- fill_missing_box(box, schedule, before = target_date)
tg <- build_team_games(box)
long <- stats_long(tg)
message("Team-games: ", sum(tg$season == season), " current, ", sum(tg$season == season - 1), " prior")

dates <- if (backfill) {
  sched_dates <- sort(unique(as.Date(schedule$game_date[schedule$season_type %in% CONFIG$season_types])))
  sched_dates[sched_dates <= target_date]
} else {
  target_date
}

# Betting lines: every completed game this season not yet cached, games from the
# last 3 days again (closing lines), and the slates being written (current lines).
slate_ids <- unlist(lapply(as.character(dates), function(d) slate_for_date(schedule, d)$game_id))
done <- schedule[schedule$status_type_completed %in% TRUE & schedule$season_type %in% CONFIG$season_types, ]
recent <- as.character(done$game_id[as.Date(done$game_date) >= target_date - 3])
lines <- tryCatch(
  update_lines(c(as.character(done$game_id), slate_ids), refetch_ids = c(recent, slate_ids)),
  error = function(e) { message("::warning::Could not update betting lines: ", conditionMessage(e)); read_lines_cache() }
)

# Injuries: the official pregame report for finished games (history; what was
# known before tip-off), ESPN's report for today.
today_et <- as.Date(format(Sys.time(), "%Y-%m-%d", tz = "America/New_York"))
pp <- tryCatch(prepare_player_games(c(season - 1, season), tg), error = function(e) { message("::warning::Player data unavailable: ", conditionMessage(e)); NULL })
rep_file <- file.path("pipeline", "cache", sprintf("injury_reports_%d.csv.gz", season))
if (!is.null(pp)) tryCatch(system2("python", c("pipeline/injury_reports.py", season)), error = function(e) message("::warning::Injury reports: ", conditionMessage(e)))
reports <- if (file.exists(rep_file)) utils::read.csv(gzfile(rep_file), colClasses = "character") else NULL
team_names <- tg |> distinct(team_id, team_name)
team_names <- stats::setNames(as.list(team_names$team_name), team_names$team_id)
inj_hist <- if (!is.null(pp)) build_injury_features(season, pp$pg, pp$b, reports, team_names) else NULL
if (!is.null(inj_hist)) write_injury_cache(season, inj_hist)
inj_live <- if (!is.null(pp)) live_injury_report(season, pp$pg, max(target_date, today_et)) else NULL
injuries_for <- function(d, slate) {
  ids <- unique(c(slate$home_id, slate$away_id))
  out <- lapply(seq_len(nrow(slate)), function(i) NULL)
  res <- list()
  for (side in c("home", "away")) for (i in seq_len(nrow(slate))) {
    tid <- slate[[paste0(side, "_id")]][i]
    gid <- slate$game_id[i]
    h <- if (!is.null(inj_hist)) inj_hist[inj_hist$game_id == gid & inj_hist$team_id == tid, ] else NULL
    res[[tid]] <- if (!is.null(h) && nrow(h)) {
      list(value = h$rep_vorp[1], bpm = h$rep_sam[1], minutes = h$rep_min[1], count = h$rep_n[1],
           names = gsub("; ", ", ", h$rep_out_names[1]), dtd = "", strength = h$strength_rep[1], source = "report")
    } else if (!is.null(inj_live) && !is.null(inj_live[[tid]]) && as.Date(d) >= today_et) {
      c(inj_live[[tid]], list(source = "espn"))
    } else {
      list(value = 0, bpm = 0, minutes = 0, count = 0, names = "", dtd = "", source = if (as.Date(d) >= today_et && !is.null(inj_live)) "espn" else "none")
    }
  }
  res
}
if (!is.null(inj_live)) jsonlite::write_json(inj_live, file.path(CONFIG$out_dir, "stats", "injuries.json"), auto_unbox = TRUE)

written <- character()
for (d in as.character(dates)) {
  slate <- slate_for_date(schedule, d)
  if (is.null(slate) || !nrow(slate)) { message(d, ": no games"); next }
  w <- compute_windows(long, season, d)

  # Every team on the slate needs stats (at least last season's).
  have <- unique(w$team$team_id)
  missing <- setdiff(c(slate$home_id, slate$away_id), have)
  if (length(missing)) {
    message("::warning::", d, ": no stats for team id(s) ", paste(missing, collapse = ", "), "; slate not written")
    next
  }
  message("Wrote ", write_slate_json(d, season, slate, w, lines, injuries_for(d, slate)), " (", nrow(slate), " games)")
  written <- c(written, d)
}

td <- as.character(target_date)
write_stats_files(tg, long, compute_windows(long, season, td), season, td, slate = slate_for_date(schedule, td))
if (length(written)) write_index_json(latest = max(written))
# This season's point-in-time inputs, so the confidence backtest keeps growing.
write_backtest_inputs(season, tg[tg$season %in% c(season - 1, season), ])
message("Done.")
