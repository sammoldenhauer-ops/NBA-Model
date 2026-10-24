# Data loading. hoopR's bulk loaders pull pre-built release files from GitHub
# (updated daily ~11:30 UTC), so no live stats.nba.com calls are needed.

fetch_box <- function(seasons) {
  box <- hoopR::load_nba_team_box(seasons = seasons)
  as.data.frame(box)
}

fetch_schedule <- function(season) {
  as.data.frame(hoopR::load_nba_schedule(seasons = season))
}

# Completed games the schedule knows about but the bulk box file doesn't have yet
# get pulled one at a time from ESPN.
fill_missing_box <- function(box, schedule, before, season_types = CONFIG$season_types) {
  done <- schedule[schedule$status_type_completed %in% TRUE &
                     schedule$season_type %in% season_types &
                     as.Date(schedule$game_date) < as.Date(before), ]
  missing_ids <- setdiff(as.character(done$game_id), as.character(box$game_id))
  if (!length(missing_ids)) return(box)

  message("Bulk box file is missing ", length(missing_ids), " completed game(s); fetching from ESPN.")
  extra <- lapply(missing_ids, function(id) {
    tryCatch(as.data.frame(hoopR::espn_nba_team_box(game_id = id)),
             error = function(e) { message("  could not fetch ", id, ": ", conditionMessage(e)); NULL })
  })
  extra <- dplyr::bind_rows(Filter(Negate(is.null), extra))
  if (!nrow(extra)) return(box)
  extra$game_id <- as.integer(extra$game_id)
  box$game_id <- as.integer(box$game_id)
  dplyr::bind_rows(box, extra[, intersect(names(box), names(extra))])
}

# Games on a date, normalised to one row per game.
slate_for_date <- function(schedule, date, season_types = CONFIG$season_types) {
  date <- as.Date(date)
  s <- schedule[as.Date(schedule$game_date) == date & schedule$season_type %in% season_types, ]
  if (nrow(s)) {
    return(tibble::tibble(
      game_id    = as.character(s$game_id),
      game_date  = as.character(date),
      tip_time   = s$date,
      status     = s$status_type_name,
      neutral    = s$neutral_site %in% TRUE,
      home_id    = as.character(s$home_id),
      home_abbr  = s$home_abbreviation,
      home_name  = s$home_display_name,
      home_color = s$home_color,
      home_logo  = s$home_logo,
      home_final = ifelse(s$status_type_completed %in% TRUE, as.numeric(s$home_score), NA_real_),
      away_id    = as.character(s$away_id),
      away_abbr  = s$away_abbreviation,
      away_name  = s$away_display_name,
      away_color = s$away_color,
      away_logo  = s$away_logo,
      away_final = ifelse(s$status_type_completed %in% TRUE, as.numeric(s$away_score), NA_real_)
    ) |> dplyr::arrange(tip_time))
  }

  # Schedule file not updated for this date: fall back to the live scoreboard.
  message("No games for ", date, " in schedule file; trying ESPN scoreboard.")
  sb <- tryCatch(as.data.frame(hoopR::espn_nba_scoreboard(season = format(date, "%Y%m%d"))),
                 error = function(e) NULL)
  if (is.null(sb) || !nrow(sb)) return(NULL)
  sb <- sb[sb$season_type %in% season_types, ]
  final <- sb$status_name == "STATUS_FINAL"
  tibble::tibble(
    game_id    = as.character(sb$game_id),
    game_date  = as.character(date),
    tip_time   = sb$start_date,
    status     = sb$status_name,
    neutral    = FALSE,
    home_id    = as.character(sb$home_team_id),
    home_abbr  = sb$home_team_abb,
    home_name  = sb$home_team_full_name,
    home_color = sb$home_team_color,
    home_logo  = sb$home_team_logo,
    home_final = ifelse(final, as.numeric(sb$home_score), NA_real_),
    away_id    = as.character(sb$away_team_id),
    away_abbr  = sb$away_team_abb,
    away_name  = sb$away_team_full_name,
    away_color = sb$away_team_color,
    away_logo  = sb$away_team_logo,
    away_final = ifelse(final, as.numeric(sb$away_score), NA_real_)
  ) |> dplyr::arrange(tip_time)
}
