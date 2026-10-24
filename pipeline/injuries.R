# Player availability features for every team-game, for testing injury adjustments.
#   Rscript pipeline/injuries.R 2024 2025 2026 2027
# Writes pipeline/cache/injuries_<season>.csv.gz, one row per team-game:
#   out_n, out_min       rotation players missing and their expected minutes
#   sam                  sum of missing players' ratings (BPM units), Sam's method
#   vorp                 sum of (rating + 2) x expected minutes / 48 (value over replacement)
#   pm_vorp              same with an on-court plus-minus rating
#   lineup_delta         expected lineup strength today minus the average lineup
#                        strength in this season's games so far (net points / 100 poss)
#   out_names            top missing players
#
# Player rating (BPM-style, net points per 100 possessions): Hollinger Game Score per
# 100 possessions, scaled by a regression of team net rating on team Game Score
# (fit on the season before the backtest), shrunk toward replacement (-2) with ~5
# games of prior weight, last season counting half. Only games before the date.

suppressPackageStartupMessages(library(dplyr))

REPLACEMENT <- -2
SHRINK_GAMES <- 5      # pseudo full games at replacement level
ROTATION_WINDOW <- 10  # team games to look back for the rotation
MIN_EXPECTED <- 8      # minutes; below this a player isn't counted as rotation

load_player_games <- function(seasons) {
  pb <- as.data.frame(hoopR::load_nba_player_box(seasons))
  pb <- pb[pb$season_type %in% CONFIG$season_types & suppressWarnings(as.integer(pb$team_id)) %in% 1:30, ]
  num <- function(x) { x <- suppressWarnings(as.numeric(x)); x[is.na(x)] <- 0; x }
  data.frame(
    season = as.integer(pb$season), game_id = as.character(pb$game_id), date = as.Date(pb$game_date),
    player = as.character(pb$athlete_id), name = pb$athlete_display_name, team_id = as.character(pb$team_id),
    min = num(pb$minutes), pts = num(pb$points), fga = num(pb$field_goals_attempted), fgm = num(pb$field_goals_made),
    fg3m = num(pb$three_point_field_goals_made), fta = num(pb$free_throws_attempted), ftm = num(pb$free_throws_made),
    pf = num(pb$fouls),
    oreb = num(pb$offensive_rebounds), dreb = num(pb$defensive_rebounds), ast = num(pb$assists),
    stl = num(pb$steals), blk = num(pb$blocks), tov = num(pb$turnovers),
    pm = num(sub("^\\+", "", pb$plus_minus)), stringsAsFactors = FALSE
  )
}

# Hollinger Game Score.
game_score <- function(x) with(x, pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.7 * oreb + 0.3 * dreb + stl + 0.7 * ast + 0.7 * blk - 0.4 * pf - tov)

# Team net rating per 100 possessions = int + slope x team Game Score per 100.
fit_box_weights <- function(pg_team) {
  x <- pg_team$gs / pg_team$poss * 100
  y <- pg_team$net / pg_team$poss * 100
  slope <- stats::cov(x, y) / stats::var(x)
  c(int = mean(y) - slope * mean(x), slope = slope)
}

# Contribution to team net rating for one player-game (net points / 100 poss).
player_contrib <- function(pg, b) 100 * b["slope"] * game_score(pg) / pg$poss + b["int"] * pg$min / 240

build_injury_features <- function(season, pg_all, b) {
  cur <- pg_all[pg_all$season == season, ]
  prior <- pg_all[pg_all$season == season - 1 & pg_all$min > 0, ]
  pr <- prior |> group_by(player) |> summarise(c0 = sum(contrib), m0 = sum(min) / 48, p0 = sum(pm), mins0 = mean(min), .groups = "drop")

  played <- cur[cur$min > 0, ]
  played <- played[order(played$player, played$date), ]
  # Cumulative totals after each game, per player.
  played <- played |>
    group_by(player) |>
    mutate(cC = cumsum(contrib), cM = cumsum(min) / 48, cP = cumsum(pm), k = row_number()) |>
    ungroup() |>
    left_join(pr, by = "player")
  played[is.na(played$c0), c("c0", "m0", "p0")] <- 0
  by_player <- split(played, played$player)

  rating_asof <- function(p, d) {
    x <- by_player[[p]]
    pri <- pr[pr$player == p, ]
    c0 <- if (nrow(pri)) pri$c0 else 0
    m0 <- if (nrow(pri)) pri$m0 else 0
    p0 <- if (nrow(pri)) pri$p0 else 0
    i <- if (is.null(x)) 0 else findInterval(as.numeric(d) - 0.5, as.numeric(x$date))
    cC <- if (i > 0) x$cC[i] else 0
    cM <- if (i > 0) x$cM[i] else 0
    cP <- if (i > 0) x$cP[i] else 0
    lastmins <- if (i > 0) mean(utils::tail(x$min[seq_len(i)], 5)) else if (nrow(pri)) pri$mins0 else 0
    c(r = (cC + 0.5 * c0 + SHRINK_GAMES * REPLACEMENT) / (cM + 0.5 * m0 + SHRINK_GAMES),
      pmr = (cP + 0.5 * p0) / (cM + 0.5 * m0 + 2 * SHRINK_GAMES),
      expmin = lastmins)
  }

  games <- cur |> distinct(game_id, date, team_id) |> arrange(team_id, date)
  last_team <- played |> group_by(player) |> arrange(date) |> summarise(dates = list(date), teams = list(team_id), .groups = "drop")
  lt <- stats::setNames(lapply(seq_len(nrow(last_team)), function(i) list(d = last_team$dates[[i]], t = last_team$teams[[i]])), last_team$player)

  out <- vector("list", nrow(games))
  for (team in unique(games$team_id)) {
    tgm <- games[games$team_id == team, ]
    strengths <- numeric(0)
    for (j in seq_len(nrow(tgm))) {
      gid <- tgm$game_id[j]
      d <- tgm$date[j]
      prev <- if (j > 1) tgm$game_id[max(1, j - ROTATION_WINDOW):(j - 1)] else character(0)
      cand <- unique(played$player[played$game_id %in% prev & played$team_id == team])
      # Still on this team: their most recent game before today was for this team.
      cand <- cand[vapply(cand, function(p) { x <- lt[[p]]; k <- sum(x$d < d); k > 0 && x$t[k] == team }, logical(1))]
      now <- played[played$game_id == gid & played$team_id == team, ]
      r <- if (length(cand)) t(vapply(cand, function(p) rating_asof(p, d), numeric(3))) else matrix(numeric(0), 0, 3, dimnames = list(NULL, c("r", "pmr", "expmin")))
      absent <- if (length(cand)) !(cand %in% now$player) & r[, "expmin"] >= MIN_EXPECTED else logical(0)
      # Expected lineup strength today: available rotation players (plus anyone
      # playing who wasn't in the recent rotation), minutes scaled to 240.
      avail <- setdiff(union(cand[!absent], now$player), character(0))
      ra <- if (length(avail)) t(vapply(avail, function(p) rating_asof(p, d), numeric(3))) else NULL
      today <- if (!is.null(ra) && sum(ra[, "expmin"]) > 0) sum(ra[, "r"] * ra[, "expmin"] * 240 / sum(ra[, "expmin"])) / 48 else NA
      base <- if (length(strengths)) mean(strengths) else NA
      out[[which(games$game_id == gid & games$team_id == team)]] <- data.frame(
        game_id = gid, team_id = team, date = d,
        out_n = sum(absent), out_min = sum(r[absent, "expmin"]),
        sam = sum(r[absent, "r"]),
        vorp = sum((r[absent, "r"] - REPLACEMENT) * r[absent, "expmin"] / 48),
        pm_vorp = sum(r[absent, "pmr"] * r[absent, "expmin"] / 48),
        lineup_delta = if (is.na(today) || is.na(base)) 0 else today - base,
        out_names = paste(utils::head(rownames(r)[absent][order(-(r[absent, "r"] - REPLACEMENT) * r[absent, "expmin"])], 3), collapse = ";")
      )
      # Actual lineup strength this game (with today's ratings), for later baselines.
      if (nrow(now)) {
        rn <- t(vapply(now$player, function(p) rating_asof(p, d), numeric(3)))
        strengths <- c(strengths, sum(rn[, "r"] * now$min) / 48)
      }
    }
  }
  res <- do.call(rbind, out)
  nm <- stats::setNames(pg_all$name, pg_all$player)
  res$out_names <- vapply(strsplit(res$out_names, ";"), function(ids) paste(nm[ids], collapse = "; "), character(1))
  res
}

# Ratings and expected minutes for every player as of a date (games before it).
player_ratings_asof <- function(season, pg_all, d) {
  d <- as.Date(d)
  cur <- pg_all[pg_all$season == season & pg_all$min > 0 & pg_all$date < d, ]
  prior <- pg_all[pg_all$season == season - 1 & pg_all$min > 0, ]
  pr <- prior |> group_by(player) |> summarise(c0 = sum(contrib), m0 = sum(min) / 48, mins0 = mean(min), team0 = last(team_id), .groups = "drop")
  cr <- cur |> arrange(date) |> group_by(player) |>
    summarise(cC = sum(contrib), cM = sum(min) / 48, mins = mean(utils::tail(min, 5)), team = last(team_id), name = last(name), .groups = "drop")
  full_join(cr, pr, by = "player") |>
    mutate(across(c(cC, cM, c0, m0), ~ ifelse(is.na(.x), 0, .x)),
           rating = (cC + 0.5 * c0 + SHRINK_GAMES * REPLACEMENT) / (cM + 0.5 * m0 + SHRINK_GAMES),
           expmin = ifelse(is.na(mins), mins0, mins),
           team = ifelse(is.na(team), team0, team)) |>
    select(player, team, rating, expmin)
}

# Today's ESPN injury report joined to player ratings, summarised per team:
# value = sum of (rating + 2) x expected minutes / 48 over players listed Out.
live_injury_report <- function(season, pg_all, d) {
  rat <- player_ratings_asof(season, pg_all, d)
  names_by_id <- stats::setNames(pg_all$name, pg_all$player)
  js <- tryCatch(jsonlite::fromJSON("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", simplifyVector = FALSE),
                 error = function(e) NULL)
  if (is.null(js)) return(NULL)
  rows <- list()
  for (t in js$injuries) {
    for (i in t$injuries) {
      href <- if (length(i$athlete$links)) i$athlete$links[[1]]$href else ""
      id <- sub(".*/id/([0-9]+).*", "\\1", href)
      rows[[length(rows) + 1]] <- data.frame(team_id = as.character(t$id), player = id, name = i$athlete$displayName,
                                             status = i$status %||% "", stringsAsFactors = FALSE)
    }
  }
  if (!length(rows)) return(NULL)
  rep <- do.call(rbind, rows) |> left_join(rat[, c("player", "rating", "expmin")], by = "player")
  rep$rating[is.na(rep$rating)] <- REPLACEMENT
  rep$expmin[is.na(rep$expmin)] <- 0
  out <- rep[rep$status %in% c("Out", "Suspension"), ]
  out$value <- (out$rating - REPLACEMENT) * out$expmin / 48
  out <- out[order(-out$value), ]
  teams <- unique(rep$team_id)
  stats::setNames(lapply(teams, function(tid) {
    o <- out[out$team_id == tid, ]
    dtd <- rep[rep$team_id == tid & rep$status == "Day-To-Day", ]
    list(value = sum(o$value), bpm = sum(o$rating[o$expmin >= MIN_EXPECTED]), minutes = sum(o$expmin), count = sum(o$expmin >= MIN_EXPECTED),
         names = paste(o$name[o$expmin >= MIN_EXPECTED], collapse = ", "), dtd = paste(dtd$name, collapse = ", "))
  }), teams)
}

# Player game data with contributions, for the current pipeline run.
prepare_player_games <- function(seasons, tg) {
  pg <- load_player_games(seasons) |>
    inner_join(tg[, c("game_id", "team_id", "poss", "pts", "opp_pts")] |> rename(team_pts = pts), by = c("game_id", "team_id"))
  pg$gs <- game_score(pg)
  fit_rows <- pg[pg$season == min(seasons), ] |> group_by(game_id, team_id) |>
    summarise(gs = sum(gs), poss = first(poss), net = first(team_pts) - first(opp_pts), .groups = "drop")
  b <- fit_box_weights(fit_rows)
  pg$contrib <- player_contrib(pg, b)
  list(pg = pg, b = b)
}

write_injury_cache <- function(season, res) {
  out <- file.path("pipeline", "cache", sprintf("injuries_%d.csv.gz", season))
  con <- gzfile(out, "w"); utils::write.csv(res, con, row.names = FALSE); close(con)
  out
}

if (sys.nframe() == 0) {
  for (f in c("config.R", "stats.R", "team_games.R", "fetch.R")) source(file.path("pipeline", f))
  seasons <- as.integer(commandArgs(trailingOnly = TRUE))
  if (!length(seasons)) seasons <- 2024:2027
  first <- min(seasons) - 1
  tg <- build_team_games(fetch_box(first:max(seasons)))
  pg <- load_player_games(first:max(seasons)) |>
    inner_join(tg[, c("game_id", "team_id", "poss", "pts", "opp_pts")] |> rename(team_pts = pts), by = c("game_id", "team_id"))
  pg$gs <- game_score(pg)
  fit_rows <- pg[pg$season == first, ] |> group_by(game_id, team_id) |>
    summarise(gs = sum(gs), poss = first(poss), net = first(team_pts) - first(opp_pts), .groups = "drop")
  b <- fit_box_weights(fit_rows)
  message("Game Score -> net rating (fit on ", first, "): int ", round(b["int"], 2), ", slope ", round(b["slope"], 3))
  pg$contrib <- player_contrib(pg, b)
  for (s in seasons) {
    t0 <- Sys.time()
    res <- build_injury_features(s, pg, b)
    out <- file.path("pipeline", "cache", sprintf("injuries_%d.csv.gz", s))
    con <- gzfile(out, "w"); utils::write.csv(res, con, row.names = FALSE); close(con)
    message(sprintf("%d: %d team-games, %.0f%% with someone out -> %s (%.0fs)", s, nrow(res), 100 * mean(res$out_n > 0), out,
                    as.numeric(difftime(Sys.time(), t0, units = "secs"))))
  }
}
