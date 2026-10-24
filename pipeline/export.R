# Slate JSON for the website: one file per date, plus latest.json and index.json.
# Each file holds the games and the stat inputs as of that date (games before it):
# both teams' values for every window, and the league averages. No model math;
# the site evaluates Sam's formulas (web/model.json) against these.

clean_num <- function(x, digits = 6) {
  x <- signif(x, digits)
  x[!is.finite(x)] <- NA
  x
}

window_block <- function(rows) {
  vals <- clean_num(rows$value[match(STAT_DEFS$id, rows$stat)])
  stats::setNames(as.list(vals), STAT_DEFS$label)
}

team_inputs <- function(windows, team_id) {
  tid <- team_id
  rows <- windows$team[windows$team$team_id == tid, ]
  out <- lapply(names(STATS_WINDOWS), function(w) {
    r <- rows[rows$window == w, ]
    list(games = if (nrow(r)) max(r$n) else 0L, stats = window_block(r))
  })
  stats::setNames(out, unname(STATS_WINDOWS))
}

league_inputs <- function(windows) {
  out <- lapply(names(STATS_WINDOWS), function(w) window_block(windows$league[windows$league$window == w, ]))
  stats::setNames(out, unname(STATS_WINDOWS))
}

game_json <- function(g) {
  team <- function(p) list(
    id = g[[paste0(p, "_id")]], abbr = g[[paste0(p, "_abbr")]], name = g[[paste0(p, "_name")]],
    color = g[[paste0(p, "_color")]], logo = g[[paste0(p, "_logo")]],
    final = if (is.na(g[[paste0(p, "_final")]])) NULL else g[[paste0(p, "_final")]]
  )
  list(game_id = g$game_id, tip_time = g$tip_time, status = g$status, neutral = g$neutral,
       home = team("home"), away = team("away"))
}

write_slate_json <- function(date, season, slate, windows, out_dir = CONFIG$out_dir) {
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  ids <- unique(c(slate$home_id, slate$away_id))
  payload <- list(
    date         = as.character(date),
    season       = season,
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    games        = lapply(seq_len(nrow(slate)), function(i) game_json(as.list(slate[i, ]))),
    teams        = stats::setNames(lapply(ids, function(id) team_inputs(windows, id)), ids),
    league       = league_inputs(windows)
  )
  path <- file.path(out_dir, paste0(date, ".json"))
  jsonlite::write_json(payload, path, auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = FALSE)
  path
}

write_index_json <- function(out_dir = CONFIG$out_dir, latest = NULL) {
  dates <- sort(sub("\\.json$", "", list.files(out_dir, pattern = "^\\d{4}-\\d{2}-\\d{2}\\.json$")))
  jsonlite::write_json(list(dates = dates), file.path(out_dir, "index.json"), auto_unbox = FALSE)
  if (!is.null(latest)) file.copy(file.path(out_dir, paste0(latest, ".json")), file.path(out_dir, "latest.json"), overwrite = TRUE)
  invisible(dates)
}
