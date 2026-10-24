# Reproduce Sam's spreadsheet. Drop the export into
# pipeline/tests/fixtures/sheet_game.json with this shape:
# {
#   "home": { "<stat_id>": { "team": [ytd, l3, ha, prior], "lg": [ytd, l3, ha, prior] }, ... },
#   "away": { ... },
#   "expected_out": {
#     "home": { "<stat_id>": { "weighted_team": .., "weighted_lg": .., "adj": .., "expected": .. } },
#     "away": { ... },
#     "score": { "home": .., "away": .., "home_spread": .., "total": .. }
#   }
# }
# Stat ids are listed in pipeline/stats.R. Missing stats default to NA.

fixture <- file.path("pipeline", "tests", "fixtures", "sheet_game.json")

test_that("model reproduces the spreadsheet export", {
  skip_if_not(file.exists(fixture), "No spreadsheet export yet (pipeline/tests/fixtures/sheet_game.json)")
  fx <- jsonlite::read_json(fixture, simplifyVector = TRUE)

  to_table <- function(side) {
    tbl <- tibble::tibble(stat = STAT_DEFS$id)
    for (j in seq_along(WINDOWS)) {
      w <- WINDOWS[j]
      tbl[[paste0("team_", w)]] <- vapply(tbl$stat, function(s) as.numeric(side[[s]]$team[j] %||% NA), numeric(1))
      tbl[[paste0("lg_", w)]]   <- vapply(tbl$stat, function(s) as.numeric(side[[s]]$lg[j] %||% NA), numeric(1))
    }
    tbl
  }
  p <- project_matchup(to_table(fx$home), to_table(fx$away))

  for (side in c("home", "away")) {
    for (s in names(fx$expected_out[[side]])) {
      want <- fx$expected_out[[side]][[s]]
      got <- p[[side]][p[[side]]$stat == s, ]
      for (col in names(want)) {
        expect_equal(got[[col]], want[[col]], tolerance = 1e-3, label = paste(side, s, col))
      }
    }
  }
  sc <- fx$expected_out$score
  for (k in names(sc)) expect_equal(p$score[[k]], sc[[k]], label = paste("score", k))
})
