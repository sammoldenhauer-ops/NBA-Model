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
for (f in c("config.R", "stats.R", "team_games.R", "windows.R", "fetch.R", "export.R", "stats_export.R")) {
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
  message("Wrote ", write_slate_json(d, season, slate, w), " (", nrow(slate), " games)")
  written <- c(written, d)
}

td <- as.character(target_date)
write_stats_files(tg, long, compute_windows(long, season, td), season, td, slate = slate_for_date(schedule, td))
if (length(written)) write_index_json(latest = max(written))
message("Done.")
