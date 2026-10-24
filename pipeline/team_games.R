# One row per team per game, with the opponent's box score joined on.

BOX_COLS <- c(
  pts  = "team_score",
  fgm  = "field_goals_made",
  fga  = "field_goals_attempted",
  fg3m = "three_point_field_goals_made",
  fg3a = "three_point_field_goals_attempted",
  ftm  = "free_throws_made",
  fta  = "free_throws_attempted",
  oreb = "offensive_rebounds",
  dreb = "defensive_rebounds",
  reb  = "total_rebounds",
  ast  = "assists",
  stl  = "steals",
  blk  = "blocks",
  # hoopR has turnovers (player), team_turnovers, and total_turnovers (both).
  # Possession estimates normally use the total.
  tov  = "total_turnovers"
)

# Team possession estimate (spec #1).
poss_estimate <- function(fga, oreb, tov, fta) fga - oreb + tov + 0.44 * fta

build_team_games <- function(box, season_types = CONFIG$season_types) {
  missing <- setdiff(c("game_id", "season", "season_type", "game_date", "team_id",
                       "team_abbreviation", "team_home_away", BOX_COLS), names(box))
  if (length(missing)) stop("Box score is missing columns: ", paste(missing, collapse = ", "))

  if (!"team_display_name" %in% names(box)) box$team_display_name <- box$team_abbreviation

  b <- box |>
    dplyr::filter(season_type %in% season_types) |>
    dplyr::transmute(
      season    = as.integer(season),
      game_id   = as.character(game_id),
      game_date = as.Date(game_date),
      team_id   = as.character(team_id),
      team      = team_abbreviation,
      team_name = team_display_name,
      home_away = tolower(team_home_away),
      dplyr::across(dplyr::all_of(unname(BOX_COLS)), as.numeric)
    ) |>
    dplyr::rename(dplyr::all_of(BOX_COLS)) |>
    dplyr::distinct(game_id, team_id, .keep_all = TRUE) |>
    # ESPN's 30 franchises have ids 1-30; drop All-Star teams (WORLD, STARS, ...),
    # which hoopR labels as regular season.
    dplyr::filter(suppressWarnings(as.integer(team_id)) %in% 1:30)

  # Drop games without a complete box for both teams (postponed / partial rows).
  complete <- stats::complete.cases(b[, names(BOX_COLS)])
  b <- b[complete, ]
  b <- b |> dplyr::group_by(game_id) |> dplyr::filter(dplyr::n() == 2) |> dplyr::ungroup()

  opp <- b |>
    dplyr::select(game_id, opp_team_id = team_id, opp_team = team, dplyr::all_of(names(BOX_COLS))) |>
    dplyr::rename_with(~ paste0("opp_", .x), dplyr::all_of(names(BOX_COLS)))

  b |>
    dplyr::inner_join(opp, by = "game_id", relationship = "many-to-many") |>
    dplyr::filter(team_id != opp_team_id) |>
    dplyr::mutate(
      poss_own = poss_estimate(fga, oreb, tov, fta),
      poss_opp = poss_estimate(opp_fga, opp_oreb, opp_tov, opp_fta),
      # Both teams in a game share one possession number. CHECK vs sheet source.
      poss     = (poss_own + poss_opp) / 2
    ) |>
    dplyr::arrange(game_date, game_id, home_away)
}
