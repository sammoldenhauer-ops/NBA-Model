# Rscript pipeline/tests/run_tests.R   (from repo root)
suppressPackageStartupMessages({
  library(dplyr)
  library(testthat)
})
for (f in c("config.R", "stats.R", "team_games.R", "windows.R", "model.R", "export.R")) {
  source(file.path("pipeline", f))
}
res <- testthat::test_dir("pipeline/tests", reporter = "summary", stop_on_failure = TRUE)
