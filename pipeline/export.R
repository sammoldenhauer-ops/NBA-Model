# JSON output for the website: one file per date, plus latest.json and index.json.

clean_num <- function(x, digits = 6) {
  x <- round(x, digits)
  x[!is.finite(x)] <- NA
  x
}

stat_rows_json <- function(h, a) {
  lapply(seq_len(nrow(STAT_DEFS)), function(i) {
    s <- STAT_DEFS$id[i]
    side <- function(tbl) {
      r <- tbl[tbl$stat == s, ]
      windows <- lapply(WINDOWS, function(w) list(
        team = clean_num(r[[paste0("team_", w)]]),
        lg   = clean_num(r[[paste0("lg_", w)]]),
        diff = clean_num(r[[paste0("diff_", w)]]),
        n    = r[[paste0("n_", w)]]
      ))
      names(windows) <- WINDOWS
      list(
        windows       = windows,
        weighted_team = clean_num(r$weighted_team),
        weighted_lg   = clean_num(r$weighted_lg),
        weight_sum    = r$weight_sum,
        adj           = clean_num(r$adj),
        expected      = clean_num(r$expected)
      )
    }
    list(
      id = s, label = STAT_DEFS$label[i], fmt = STAT_DEFS$fmt[i],
      weights = as.list(stat_weights(s)[1, WINDOWS]),
      mirror = if (is.na(STAT_DEFS$mirror[i])) NULL else STAT_DEFS$mirror[i],
      home = side(h), away = side(a)
    )
  })
}

game_json <- function(g, proj) {
  team <- function(p) list(
    id = g[[paste0(p, "_id")]], abbr = g[[paste0(p, "_abbr")]], name = g[[paste0(p, "_name")]],
    color = g[[paste0(p, "_color")]], logo = g[[paste0(p, "_logo")]],
    final = if (is.na(g[[paste0(p, "_final")]])) NULL else g[[paste0(p, "_final")]]
  )
  list(
    game_id  = g$game_id,
    tip_time = g$tip_time,
    status   = g$status,
    neutral  = g$neutral,
    home     = team("home"),
    away     = team("away"),
    projection = list(
      home_score  = proj$score$home,
      away_score  = proj$score$away,
      home_spread = proj$score$home_spread,
      away_spread = proj$score$away_spread,
      total       = proj$score$total,
      raw_home    = clean_num(proj$score$raw_home),
      raw_away    = clean_num(proj$score$raw_away),
      possessions = clean_num(proj$possessions)
    ),
    lines = list(home = as.list(clean_num(proj$lines$home)), away = as.list(clean_num(proj$lines$away))),
    stats = stat_rows_json(proj$home, proj$away)
  )
}

write_slate_json <- function(date, season, games, out_dir = CONFIG$out_dir) {
  dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)
  payload <- list(
    date         = as.character(date),
    season       = season,
    generated_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
    settings     = list(missing_window = CONFIG$missing_window, expected_formula = CONFIG$expected_formula,
                        league_avg = CONFIG$league_avg, rate_method = CONFIG$rate_method),
    games        = games
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
