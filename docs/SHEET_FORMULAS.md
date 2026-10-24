# Spreadsheet formulas (reverse-engineered)

Source: `Main Model - Team v Team.csv` (LAL home vs BKN away), saved as
`docs/sheet_export_lal_bkn.csv`. The export holds values only, so each formula was recovered by
recomputing every cell from the sheet's own inputs and finding the formula that matches (270+
cells, the score, spread, total and stat line all reproduced).

The pipeline no longer computes the model. Projections now come from formulas built on the
site's Model page (`web/model.json`). Use this page as a reference when rebuilding the sheet there.

## Layer 1: windows and league averages

| Item | Sheet behaviour | Spec said |
|---|---|---|
| Window weights | **Three sets, by section:** pace (Poss, Points, Off/Def Eff, Opp Points) 40/25/30/5; volume (FGA, 3PA, FTA and their Opp.) 60/15/20/5; everything else 65/10/20/5 | 40/25/30/5 everywhere |
| L3 with < 3 games | Uses the games played (LAL's L3 = its 1 game) | Window missing |
| League average | Simple average of the 30 teams' values (e.g. 35.3667 = x/30; H/A averages divide by 8 and 16, the number of teams with home/away games) | Pooled league totals |
| Box Score +/- | Not in the sheet | Stat #34 |

## Layer 2: weighted and adjusted

```
Weighted_Team = Σ (weight × team value) / 100      a missing window ("--") counts as 0
Weighted_Lg   = Σ (weight × league avg) / 100      all four windows always included
Adj           = Weighted_Team / Weighted_Lg
```

**Missing windows are not renormalised.** BKN has no away games, so its H/A cell is `--`.
That window contributes 0 to the team side but the full league average to the league side,
which cuts every BKN weighted value by roughly 30% (Poss 104.5 → 73.0, Points 103 → 72.2). This one
rule is why BKN projects at 58.5. The per-window Adjusted and Difference columns are display only.

## Layer 3: expected values

56 of the 66 Expected cells follow the spec formula exactly:

```
Exp_X(team) = Adj_X(team) × Adj_OppX(opponent) × Weighted_Lg_X(team)
```

Exceptions:

| Cell | Sheet value | What it computes | Spec formula would give |
|---|---|---|---|
| Points/Game, home | 79.5 | Adj_Pts(LAL) × Adj_OppPts(BKN) × **away H/A league avg of points (107.9)** | 84.1 |
| Points/Game, away | 49.3 | Adj_Pts(BKN) × **Adj_OppPts(BKN)** × Weighted_Lg_OppPts(BKN) | 68.1 |
| FGA/Game, home | 68.2 | Holds the away Opp. FGA formula | 68.0 |
| Opp. FGA/Game, away | 68.0 | Holds the home FGA formula | 68.2 |
| FTA/Game, home | 11.8 | Holds the away Opp. FTA formula | 11.9 |
| Opp. FTA/Game, both | 11.8 / 19.0 | Home and away cells swapped | 19.0 / 11.8 |
| Rebound Rate, both | 56.6% / 28.6% | Adj × Adj × Weighted_Lg of the same team (paired with itself) | no mirror |
| FT%, Block%, STL/Def. Play | = weighted value | Weighted team value | no mirror |
| Poss./Game | 88.3 | (Weighted_H + Weighted_A) / 2 | same |

The two Points cells drive the score. They look like cell references pointing at the wrong row
or team.

## Layer 4: score and stat line

- Score = MROUND((Exp_Pts(team) + Exp_OppPts(opponent)) / 2, 0.5). Spread and total as in the spec. All match.
- Stat line FGA/3PA/FTA/AST/TO = **the team's own Expected value**, not the average of the two estimates.
- Stat line REB, OFF REBs, BLKs, STLs: **can't be recovered from values.** Hundreds of formulas fit
  one game's numbers. BLKs is 5.0 for both teams and STLs are whole numbers, which suggests rounding or
  another source. An `.xlsx` download (File → Download → Microsoft Excel) keeps the formulas.

## Other things the export shows

- **Away league averages in the pace section** (YTD and L3 for Poss, Points, Off/Def Eff, Opp Points)
  differ from the home column (e.g. points YTD 112.8 home vs 114.2 away), while every other section
  has identical home/away YTD and L3 averages. They look like they come from a different range or
  date. The pipeline uses one league average for both teams.
- Prior season is labelled 2022 in the sheet.
- The injury rows (BPM, Home/Away Pts) are all 0 and don't feed the score.

## Effect of the sheet's quirks

Same LAL–BKN inputs with the quirks on (sheet) or off (clean / renormalized missing windows):

| expected_formula | missing_window | LAL | BKN | Spread | Total | Poss |
|---|---|---|---|---|---|---|
| sheet | zero | 82.5 | 58.5 | −24.0 | 141.0 | 88.3 |
| clean | zero | 85.0 | 67.5 | −17.5 | 152.5 | 88.3 |
| sheet | renormalize | 118.0 | 96.5 | −21.5 | 214.5 | 104.0 |
| clean | renormalize | 121.5 | 95.5 | −26.0 | 217.0 | 104.0 |
