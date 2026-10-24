# Betting lines from ESPN's pick center (DraftKings), cached per game so each game
# is only fetched once. The cache is committed: pipeline/cache/lines.csv
#
#   home_spread  line for the home team (negative = home favored)
#   total        over/under
#   home_ml, away_ml  moneylines

LINES_CACHE <- file.path("pipeline", "cache", "lines.csv")
LINE_COLS <- c("game_id", "provider", "home_spread", "total", "home_ml", "away_ml", "fetched_at")

read_lines_cache <- function(path = LINES_CACHE) {
  if (!file.exists(path)) {
    return(stats::setNames(data.frame(matrix(ncol = length(LINE_COLS), nrow = 0)), LINE_COLS))
  }
  utils::read.csv(path, colClasses = c(game_id = "character", provider = "character", fetched_at = "character"))
}

fetch_game_line <- function(game_id) {
  x <- tryCatch(hoopR::espn_nba_betting(game_id = game_id), error = function(e) NULL)
  pc <- x$pickcenter
  if (is.null(pc) || !nrow(pc)) {
    return(data.frame(game_id = game_id, provider = NA, home_spread = NA, total = NA, home_ml = NA, away_ml = NA))
  }
  pc <- as.data.frame(pc)[1, ]
  num <- function(col) if (col %in% names(pc)) suppressWarnings(as.numeric(pc[[col]])) else NA_real_
  data.frame(
    game_id = game_id,
    provider = if ("provider_name" %in% names(pc)) pc$provider_name else NA,
    home_spread = num("spread"),
    total = num("over_under"),
    home_ml = num("home_team_odds_money_line"),
    away_ml = num("away_team_odds_money_line")
  )
}

# Fetch lines for games not yet cached (or cached without a line and refetch = TRUE).
update_lines <- function(game_ids, path = LINES_CACHE, refetch_missing = FALSE, refetch_ids = character()) {
  cache <- read_lines_cache(path)
  have <- cache$game_id[if (refetch_missing) !is.na(cache$home_spread) else rep(TRUE, nrow(cache))]
  todo <- union(setdiff(unique(as.character(game_ids)), have), intersect(refetch_ids, game_ids))
  if (!length(todo)) return(invisible(cache))
  message("Fetching lines for ", length(todo), " game(s)")
  dir.create(dirname(path), recursive = TRUE, showWarnings = FALSE)
  for (i in seq_along(todo)) {
    row <- fetch_game_line(todo[i])
    row$fetched_at <- format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC")
    cache <- rbind(cache[cache$game_id != todo[i], LINE_COLS], row[, LINE_COLS])
    if (i %% 100 == 0 || i == length(todo)) {
      utils::write.csv(cache[order(cache$game_id), ], path, row.names = FALSE, na = "")
      message("  ", i, "/", length(todo))
    }
  }
  invisible(cache)
}
