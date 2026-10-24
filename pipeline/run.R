# Entry point.
#   Rscript pipeline/run.R                      # today's slate (Eastern date)
#   Rscript pipeline/run.R --date=2026-10-23    # a specific date
#   Rscript pipeline/run.R --backfill           # every slate this season up to the date
#
# Run from the repo root. Exits non-zero (and writes nothing) if any sanity check fails.

suppressPackageStartupMessages({
  library(dplyr)
})

script_dir <- local({
  f <- sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE))
  if (length(f)) dirname(normalizePath(f)) else "pipeline"
})
for (f in c("config.R", "stats.R", "team_games.R", "windows.R", "model.R", "fetch.R", "export.R")) {
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

sanity_errors <- function(g, proj) {
  errs <- character()
  label <- paste0(g$away_abbr, " @ ", g$home_abbr)
  sc <- proj$score
  nums <- c(sc$raw_home, sc$raw_away, sc$home, sc$away, sc$total, proj$possessions)
  if (any(!is.finite(nums))) errs <- c(errs, paste(label, "has NaN/Inf/NA in score or possessions"))
  if (all(is.finite(c(sc$home, sc$away)))) {
    if (sc$home > sc$away && !(sc$home_spread < 0)) errs <- c(errs, paste(label, "spread sign does not match scores"))
    if (sc$away > sc$home && !(sc$away_spread < 0)) errs <- c(errs, paste(label, "spread sign does not match scores"))
    if (sc$home_spread != -sc$away_spread) errs <- c(errs, paste(label, "spreads are not opposite"))
  }
  if (is.finite(proj$possessions) &&
      (proj$possessions < CONFIG$poss_range[1] || proj$possessions > CONFIG$poss_range[2])) {
    errs <- c(errs, sprintf("%s possessions %.1f outside %d-%d", label, proj$possessions,
                            CONFIG$poss_range[1], CONFIG$poss_range[2]))
  }
  errs
}

outputs <- list()
problems <- character()
for (d in as.character(dates)) {
  slate <- slate_for_date(schedule, d)
  if (is.null(slate) || !nrow(slate)) { message(d, ": no games"); next }

  w <- compute_windows(long, season, d)
  games <- lapply(seq_len(nrow(slate)), function(i) {
    g <- as.list(slate[i, ])
    proj <- project_matchup(team_window_table(w, g$home_id, "home"),
                            team_window_table(w, g$away_id, "away"))
    errs <- sanity_errors(g, proj)
    if (length(errs)) problems <<- c(problems, paste0(d, ": ", errs))
    message(sprintf("  %s %-4s %5.1f @ %-4s %5.1f  spread %+5.1f  total %5.1f  poss %.1f", d,
                    g$away_abbr, proj$score$away, g$home_abbr, proj$score$home,
                    proj$score$home_spread, proj$score$total, proj$possessions))
    game_json(g, proj)
  })
  if (backfill && any(startsWith(problems, paste0(d, ": ")))) {
    message("  ", d, ": skipped, sanity checks failed")   # backfill keeps the dates that pass
  } else {
    outputs[[d]] <- games
  }
}

if (length(problems) && !backfill) {
  message("\nSanity checks FAILED; nothing written:\n  ", paste(problems, collapse = "\n  "))
  quit(status = 1)
}
if (length(problems)) message("\nSkipped dates:\n  ", paste(problems, collapse = "\n  "))
if (!length(outputs)) {
  message("No games on any requested date; nothing written.")
  quit(status = 0)
}

for (d in names(outputs)) message("Wrote ", write_slate_json(d, season, outputs[[d]]))
write_index_json(latest = max(names(outputs)))
message("Done.")
