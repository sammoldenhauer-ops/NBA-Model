# Reproduce Sam's spreadsheet (LAL vs BKN export, "Main Model - Team v Team").
# The sheet's window values and league averages are fed in as inputs; every
# weighted, league, adjusted and expected cell, the stat line, and the score
# must match the sheet to its display precision.

fixture <- test_path("fixtures", "sheet_lal_bkn.csv")

# Order of the 33 stat blocks in the sheet.
SHEET_STAT_ORDER <- c(
  "poss", "pts", "off_eff", "opp_pts", "def_eff",
  "fga", "opp_fga", "fg3a", "opp_fg3a", "fta", "opp_fta",
  "efg", "opp_efg", "fg2_rate", "opp_fg2_rate", "fg3_pct", "opp_fg3_pct",
  "fg3_rate", "opp_fg3_rate", "ft_pct",
  "oreb_pct", "opp_oreb_pct", "dreb_pct", "opp_dreb_pct", "reb_rate",
  "blk_pct", "stl_pct", "tov", "opp_tov", "ast", "opp_ast", "ast_to", "opp_ast_to"
)

sheet_num <- function(x) {
  x <- trimws(x)
  out <- rep(NA_real_, length(x))
  ok <- !(x %in% c("", "--", "#VALUE!"))
  pct <- ok & grepl("%$", x)
  out[ok & !pct] <- as.numeric(x[ok & !pct])
  out[pct] <- as.numeric(sub("%$", "", x[pct])) / 100
  out
}

# Allowed gap between our value and a displayed cell: half a unit in the last
# displayed digit, plus slack for inputs that are themselves rounded for display.
sheet_tol <- function(cell) {
  cell <- trimws(cell)
  dec <- ifelse(grepl("\\.", cell), nchar(sub("^[^.]*\\.", "", sub("%$", "", cell))), 0)
  unit <- 10^-dec * ifelse(grepl("%$", cell), 0.01, 1)
  0.5 * unit + 0.004 * abs(sheet_num(cell))
}

read_sheet <- function(path) {
  rows <- utils::read.csv(path, header = FALSE, colClasses = "character", na.strings = character())
  body <- rows[8:176, ]
  body <- body[!(body$V1 == "" & body$V2 == "Home"), ]
  stopifnot(nrow(body) == 5 * length(SHEET_STAT_ORDER))
  blocks <- split(body, rep(seq_along(SHEET_STAT_ORDER), each = 5))
  names(blocks) <- SHEET_STAT_ORDER
  list(blocks = blocks, top = rows[4:5, ])
}

side_table <- function(blocks, team_col, lg_col) {
  tbl <- tibble::tibble(stat = STAT_DEFS$id)
  for (j in seq_along(WINDOWS)) {
    w <- WINDOWS[j]
    tbl[[paste0("team_", w)]] <- vapply(tbl$stat, function(s) sheet_num(blocks[[s]][[team_col]][j]), numeric(1))
    tbl[[paste0("lg_", w)]]   <- vapply(tbl$stat, function(s) sheet_num(blocks[[s]][[lg_col]][j]), numeric(1))
  }
  tbl
}

test_that("model reproduces every cell of the spreadsheet export", {
  skip_if_not(file.exists(fixture), "sheet export missing")
  sh <- read_sheet(fixture)
  b <- sh$blocks

  p <- project_matchup(side_table(b, "V2", "V5"), side_table(b, "V3", "V6"),
                       weights = list(pace   = c(ytd = 40, l3 = 25, ha = 30, prior = 5),
                                      volume = c(ytd = 60, l3 = 15, ha = 20, prior = 5),
                                      rate   = c(ytd = 65, l3 = 10, ha = 20, prior = 5)),
                       formula = "sheet", missing = "zero")

  # Weighted row columns: V2/V3 weighted team, V5/V6 weighted lg, V9/V10 adj, V11/V12 expected.
  cols <- list(weighted_team = c("V2", "V3"), weighted_lg = c("V5", "V6"),
               adj = c("V9", "V10"), expected = c("V11", "V12"))
  checked <- 0
  for (s in SHEET_STAT_ORDER) {
    wrow <- b[[s]][5, ]
    for (field in names(cols)) {
      for (k in 1:2) {
        cell <- wrow[[cols[[field]][k]]]
        if (is.na(sheet_num(cell))) next
        got <- p[[c("home", "away")[k]]][[field]][p[[c("home", "away")[k]]]$stat == s]
        expect_lte(abs(got - sheet_num(cell)), sheet_tol(cell),
                   label = sprintf("%s %s %s: got %.4f, sheet %s", s, c("home", "away")[k], field, got, cell))
        checked <- checked + 1
      }
    }
  }
  expect_gte(checked, 260)

  # Top of sheet: score, spread, total, and the stat line.
  top <- sh$top
  expect_equal(p$score$home, sheet_num(top$V2[1]))
  expect_equal(p$score$away, sheet_num(top$V2[2]))
  expect_equal(p$score$home_spread, sheet_num(top$V3[1]))
  expect_equal(p$score$away_spread, sheet_num(top$V3[2]))
  expect_equal(p$score$total, sheet_num(top$V4[1]))
  line_cols <- c(fga = "V5", fg3a = "V6", fta = "V7", ast = "V10", tov = "V13")
  for (s in names(line_cols)) {
    expect_lte(abs(p$lines$home[[s]] - sheet_num(top[[line_cols[[s]]]][1])), 0.06, label = paste("home line", s))
    expect_lte(abs(p$lines$away[[s]] - sheet_num(top[[line_cols[[s]]]][2])), 0.06, label = paste("away line", s))
  }
})

test_that("window adjusted and difference columns match the sheet", {
  skip_if_not(file.exists(fixture), "sheet export missing")
  b <- read_sheet(fixture)$blocks
  for (s in SHEET_STAT_ORDER) {
    for (j in 1:4) {
      r <- b[[s]][j, ]
      for (k in 1:2) {
        tc <- r[[c("V2", "V3")[k]]]; lc <- r[[c("V5", "V6")[k]]]
        ac <- r[[c("V9", "V10")[k]]]; dc <- r[[c("V7", "V8")[k]]]
        t <- sheet_num(tc); l <- sheet_num(lc)
        if (is.na(t)) next
        # The inputs are themselves rounded for display; propagate that rounding.
        ratio_tol <- (t / l) * (sheet_tol(tc) / t + sheet_tol(lc) / l) + sheet_tol(ac)
        expect_lte(abs(t / l - sheet_num(ac)), ratio_tol, label = paste(s, j, k, "window adj"))
        expect_lte(abs(t - l - sheet_num(dc)), sheet_tol(tc) + sheet_tol(lc) + sheet_tol(dc),
                   label = paste(s, j, k, "window diff"))
      }
    }
  }
})
