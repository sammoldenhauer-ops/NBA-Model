// Starting layout for the Model sheet, mirroring Sam's "Team v Team" tab:
// score + stat line at the top, then one block per stat (YTD, L3, H/A, Prior, Weighted)
// with columns Home | Away | Weight | League Average (H, A) | Difference | Adjusted | Expected.
// Every cell is an ordinary editable formula.

import type { CellFormat, SheetModel } from "./sheet";

type Def = { id: string; label: string; fmt: CellFormat; mirror?: string; poss?: boolean };

const SECTIONS: Def[][] = [
  [
    { id: "poss", label: "Poss./Game", fmt: "dec1", poss: true },
    { id: "pts", label: "Points/Game", fmt: "dec1", mirror: "opp_pts" },
    { id: "off_eff", label: "Off. Efficiency", fmt: "dec3", mirror: "def_eff" },
    { id: "opp_pts", label: "Opp. Points/Game", fmt: "dec1", mirror: "pts" },
    { id: "def_eff", label: "Def. Efficiency", fmt: "dec3", mirror: "off_eff" },
  ],
  [
    { id: "fga", label: "FGA/Game", fmt: "dec1", mirror: "opp_fga" },
    { id: "opp_fga", label: "Opp. FGA/Game", fmt: "dec1", mirror: "fga" },
    { id: "fg3a", label: "3PA/Game", fmt: "dec1", mirror: "opp_fg3a" },
    { id: "opp_fg3a", label: "Opp. 3PA/Game", fmt: "dec1", mirror: "fg3a" },
    { id: "fta", label: "FTA/Game", fmt: "dec1", mirror: "opp_fta" },
    { id: "opp_fta", label: "Opp. FTA/Game", fmt: "dec1", mirror: "fta" },
  ],
  [
    { id: "efg", label: "EFG%", fmt: "pct", mirror: "opp_efg" },
    { id: "opp_efg", label: "Opp. EFG%", fmt: "pct", mirror: "efg" },
    { id: "fg2_rate", label: "2PT Rate", fmt: "pct", mirror: "opp_fg2_rate" },
    { id: "opp_fg2_rate", label: "Opp. 2PT Rate", fmt: "pct", mirror: "fg2_rate" },
    { id: "fg3_pct", label: "3 Point %", fmt: "pct", mirror: "opp_fg3_pct" },
    { id: "opp_fg3_pct", label: "Opp. 3 Point %", fmt: "pct", mirror: "fg3_pct" },
    { id: "fg3_rate", label: "3PT Rate", fmt: "pct", mirror: "opp_fg3_rate" },
    { id: "opp_fg3_rate", label: "Opp. 3PT Rate", fmt: "pct", mirror: "fg3_rate" },
    { id: "ft_pct", label: "FT%", fmt: "pct" },
  ],
  [
    { id: "oreb_pct", label: "Off. Rebound%", fmt: "pct", mirror: "opp_oreb_pct" },
    { id: "opp_oreb_pct", label: "Opp. Off. Rebound%", fmt: "pct", mirror: "oreb_pct" },
    { id: "dreb_pct", label: "Def. Rebound%", fmt: "pct", mirror: "opp_dreb_pct" },
    { id: "opp_dreb_pct", label: "Opp. Def. Rebound%", fmt: "pct", mirror: "dreb_pct" },
    { id: "reb_rate", label: "Rebound Rate", fmt: "pct" },
  ],
  [
    { id: "blk_pct", label: "Block%", fmt: "pct" },
    { id: "stl_pct", label: "STL/Def. Play", fmt: "pct" },
    { id: "tov", label: "TO/Game", fmt: "dec1", mirror: "opp_tov" },
    { id: "opp_tov", label: "Opp. TO/Game", fmt: "dec1", mirror: "tov" },
    { id: "ast", label: "Ass./Game", fmt: "dec1", mirror: "opp_ast" },
    { id: "opp_ast", label: "Opp. Ass./Game", fmt: "dec1", mirror: "ast" },
    { id: "ast_to", label: "Ass./TO Ratio", fmt: "dec3", mirror: "opp_ast_to" },
    { id: "opp_ast_to", label: "Opp. Ass./TO Ratio", fmt: "dec3", mirror: "ast_to" },
  ],
  [
    { id: "reb", label: "Rebounds/Game", fmt: "dec1", mirror: "opp_reb" },
    { id: "opp_reb", label: "Opp. Rebounds/Game", fmt: "dec1", mirror: "reb" },
    { id: "oreb", label: "Off. Rebounds/Game", fmt: "dec1", mirror: "opp_oreb" },
    { id: "opp_oreb", label: "Opp. Off. Rebounds/Game", fmt: "dec1", mirror: "oreb" },
    { id: "blk", label: "Blocks/Game", fmt: "dec1", mirror: "opp_blk" },
    { id: "opp_blk", label: "Opp. Blocks/Game", fmt: "dec1", mirror: "blk" },
    { id: "stl", label: "Steals/Game", fmt: "dec1", mirror: "opp_stl" },
    { id: "opp_stl", label: "Opp. Steals/Game", fmt: "dec1", mirror: "stl" },
  ],
];

export const DEFAULT_WEIGHTS = [10, 0, 0, 90]; // YTD, L3, H/A, Prior

const TOP_HEADERS = ["Score", "Spread", "Total", "FGAs", "3PAs", "FTAs", "REBs", "OFF REBs", "ASSISTs", "BLKs", "STLs", "TOs"];
const SECTION_HEADERS: Record<string, string> = {
  B: "Home", C: "Away", D: "Weight", E: "League Average", G: "Difference", I: "Adjusted", K: "Expected",
};

export function buildTemplate(weights = DEFAULT_WEIGHTS): SheetModel {
  const cells: Record<string, string> = {};
  const formats: Record<string, CellFormat> = {};
  const styles: Record<string, "header" | "bold"> = {};
  const set = (a: string, v: string, f?: CellFormat) => {
    cells[a] = v;
    if (f) formats[a] = f;
  };

  // Rows 3-6: score and stat line.
  styles["3"] = "header";
  styles["6"] = "header";
  set("A3", "Home");
  set("A6", "Away");
  TOP_HEADERS.forEach((h, i) => {
    const col = String.fromCharCode(66 + i); // B..M
    set(`${col}3`, h);
    set(`${col}6`, h);
  });
  set("A4", "=[Home Team]");
  set("A5", "=[Away Team]");

  // Stat blocks.
  const weightedRow: Record<string, number> = {};
  let row = 7;
  const blocks: { def: Def; r: number; w: number }[] = [];
  for (const section of SECTIONS) {
    styles[String(row)] = "header";
    for (const [col, h] of Object.entries(SECTION_HEADERS)) set(`${col}${row}`, h);
    row++;
    const w = row; // weights live in the section's first block
    for (const def of section) {
      blocks.push({ def, r: row, w });
      weightedRow[def.id] = row + 4;
      row += 5;
    }
  }

  const wins = ["YTD", "L3", "H/A", "Prior"];
  const lgHome = ["YTD", "L3", "Home", "Prior"];
  const lgAway = ["YTD", "L3", "Away", "Prior"];
  for (const { def, r, w } of blocks) {
    const L = def.label;
    const f = def.fmt;
    wins.forEach((win, i) => {
      const n = r + i;
      set(`A${n}`, `${L} ${win}`);
      set(`B${n}`, `=[Home ${win} ${L}]`, f);
      set(`C${n}`, `=[Away ${win} ${L}]`, f);
      if (r === w) set(`D${n}`, String(weights[i]), "int");
      set(`E${n}`, `=[League ${lgHome[i]} ${L}]`, f);
      set(`F${n}`, `=[League ${lgAway[i]} ${L}]`, f);
      set(`G${n}`, `=B${n}-E${n}`, f);
      set(`H${n}`, `=C${n}-F${n}`, f);
      set(`I${n}`, `=B${n}/E${n}`, "dec4");
      set(`J${n}`, `=C${n}/F${n}`, "dec4");
    });
    const x = r + 4;
    const wr = `$D$${w}:$D$${w + 3}`;
    styles[String(x)] = "bold";
    set(`A${x}`, `Weighted ${L}`);
    for (const col of ["B", "C", "E", "F"]) set(`${col}${x}`, `=SUMPRODUCT(${wr},${col}${r}:${col}${r + 3})/100`, f);
    set(`I${x}`, `=B${x}/E${x}`, "dec4");
    set(`J${x}`, `=C${x}/F${x}`, "dec4");
    if (def.poss) {
      set(`K${x}`, `=(B${x}+C${x})/2`, f);
    } else if (def.mirror) {
      const m = weightedRow[def.mirror];
      set(`K${x}`, `=I${x}*J${m}*E${x}`, f); // home adj x away's mirror adj x home weighted league avg
      set(`L${x}`, `=J${x}*I${m}*F${x}`, f);
    } else {
      set(`K${x}`, `=B${x}`, f);
      set(`L${x}`, `=C${x}`, f);
    }
  }

  // Score, spread, total, stat line.
  const pts = weightedRow.pts;
  const opp = weightedRow.opp_pts;
  set("B4", `=MROUND((K${pts}+L${opp})/2,0.5)`, "dec1");
  set("B5", `=MROUND((L${pts}+K${opp})/2,0.5)`, "dec1");
  set("C4", "=B5-B4", "dec1");
  set("C5", "=B4-B5", "dec1");
  set("D4", "=B4+B5", "dec1");
  set("D5", "=B4+B5", "dec1");
  const line: [string, string][] = [
    ["E", "fga"], ["F", "fg3a"], ["G", "fta"], ["H", "reb"], ["I", "oreb"],
    ["J", "ast"], ["K", "blk"], ["L", "stl"], ["M", "tov"],
  ];
  for (const [col, id] of line) {
    set(`${col}4`, `=K${weightedRow[id]}`, "dec1");
    set(`${col}5`, `=L${weightedRow[id]}`, "dec1");
  }

  const model: SheetModel = {
    version: 2,
    cols: 14,
    rows: row + 20,
    cells,
    formats,
    styles,
    widths: { A: 210 },
    outputs: { home_score: "B4", away_score: "B5" },
  };
  addInjurySection(model);
  addPlayerProjection(model, addHomeCourt(model));
  return model;
}

// Injuries section: who's out, their value, and a score adjustment that the score
// cells add. Method 1 (default) = value lost x scale, split between the two scores
// (tested best by backtest); 2 = Sam's method, BPM/2 off the team and BPM/2 to the
// opponent; 0 = off. Returns the row of the adjustment cells.
export function addInjurySection(m: SheetModel): number {
  const existing = Object.entries(m.cells).find(([, v]) => v === "Injuries");
  if (existing) return Number(existing[0].slice(1)) + 9;
  const maxRow = Math.max(...Object.keys(m.cells).map((a) => Number(a.replace(/^[A-Z]+/, ""))));
  const r = maxRow + 2;
  const set = (a: string, v: string, f?: CellFormat) => {
    m.cells[a] = v;
    if (f) m.formats[a] = f;
  };
  m.styles[String(r)] = "header";
  set(`A${r}`, "Injuries");
  set(`B${r}`, "Home");
  set(`C${r}`, "Away");
  set(`D${r}`, "Notes");
  const rows: [string, string, CellFormat | undefined][] = [
    ["Out", "List", undefined],
    ["Day-to-day (not counted)", "DTD", undefined],
    ["Players out", "Count", "int"],
    ["Minutes out", "Minutes", "dec1"],
    ["Value lost (net pts)", "Value", "dec2"],
    ["Sum of BPM out", "BPM", "dec1"],
  ];
  rows.forEach(([label, field, f], i) => {
    set(`A${r + 1 + i}`, label);
    set(`B${r + 1 + i}`, `=[Home Injury ${field}]`, f);
    set(`C${r + 1 + i}`, `=[Away Injury ${field}]`, f);
  });
  const val = r + 5, bpm = r + 6, method = r + 7, scale = r + 8, adj = r + 9;
  set(`A${method}`, "Method");
  set(`B${method}`, "1", "int");
  set(`D${method}`, "1 = value lost x scale (tested best) · 2 = BPM/2 off team, BPM/2 to opponent · 0 = off");
  set(`A${scale}`, "Scale (method 1)");
  set(`B${scale}`, "0.4", "dec2");
  set(`D${scale}`, "0.4 fit best alongside the player-based blend (0.6 on its own); teammates absorb part of the loss");
  m.styles[String(adj)] = "bold";
  set(`A${adj}`, "Score adjustment");
  set(`B${adj}`, `=IF($B$${method}=1,($C$${val}-$B$${val})*$B$${scale}/2,IF($B$${method}=2,($C$${bpm}-$B$${bpm})/2,0))`, "dec2");
  set(`C${adj}`, `=IF($B$${method}=1,($B$${val}-$C$${val})*$B$${scale}/2,IF($B$${method}=2,($B$${bpm}-$C$${bpm})/2,0))`, "dec2");
  m.widths = { ...m.widths, D: Math.max(m.widths.D ?? 84, 84) };
  m.rows = Math.max(m.rows, adj + 10);
  // Score cells add the adjustment: =MROUND(x,0.5) -> =MROUND(x+B<adj>,0.5)
  for (const [cell, col] of [["B4", "B"], ["B5", "C"]] as const) {
    const f = m.cells[cell] ?? "";
    const mm = /^=MROUND\((.*),0\.5\)$/.exec(f.replace(/\s+/g, ""));
    if (mm && !f.includes(`${col}${adj}`)) m.cells[cell] = `=MROUND(${mm[1]}+${col}${adj},0.5)`;
  }
  return adj;
}

// Home court: points added to the home margin (half to the home score, half off the
// away score). 1.5 fit best on 2023-26 held-out seasons (the sheet otherwise
// under-projects home teams by ~1.5).
// Returns the row of the home-court value cell (B).
export function addHomeCourt(m: SheetModel): number {
  const existing = Object.entries(m.cells).find(([, v]) => v === "Home court (pts)");
  if (existing) return Number(existing[0].slice(1));
  const maxRow = Math.max(...Object.keys(m.cells).map((a) => Number(a.replace(/^[A-Z]+/, ""))));
  const r = maxRow + 2;
  m.styles[String(r)] = "header";
  m.cells[`A${r}`] = "Home court";
  m.cells[`B${r}`] = "Home";
  m.cells[`C${r}`] = "Away";
  m.cells[`A${r + 1}`] = "Home court (pts)";
  m.cells[`B${r + 1}`] = "1.5";
  m.formats[`B${r + 1}`] = "dec1";
  m.cells[`D${r + 1}`] = "1.5 fit best on 2023-26 held-out seasons";
  m.styles[String(r + 2)] = "bold";
  m.cells[`A${r + 2}`] = "Score adjustment";
  m.cells[`B${r + 2}`] = `=$B$${r + 1}/2`;
  m.cells[`C${r + 2}`] = `=-$B$${r + 1}/2`;
  m.formats[`B${r + 2}`] = "dec2";
  m.formats[`C${r + 2}`] = "dec2";
  m.rows = Math.max(m.rows, r + 12);
  for (const [cell, col] of [["B4", "B"], ["B5", "C"]] as const) {
    const f = (m.cells[cell] ?? "").replace(/\s+/g, "");
    const mm = /^=MROUND\((.*),0\.5\)$/.exec(f);
    if (mm && !f.includes(`${col}${r + 2}`)) m.cells[cell] = `=MROUND(${mm[1]}+${col}${r + 2},0.5)`;
  }
  return r + 1;
}

// Player-based projection: lineup strength (ratings x projected minutes) for each
// team, the margin it implies, and a blend weight that moves the score cells toward
// it. 0.3 (with injury scale 0.4) fit best on 2023-26 held-out seasons: average
// margin miss 11.19 -> 11.13.
export function addPlayerProjection(m: SheetModel, hcaRow: number): number {
  const existing = Object.entries(m.cells).find(([, v]) => v === "Player-based projection");
  if (existing) return Number(existing[0].slice(1)) + 6;
  const maxRow = Math.max(...Object.keys(m.cells).map((a) => Number(a.replace(/^[A-Z]+/, ""))));
  const r = maxRow + 2;
  const set = (a: string, v: string, f?: CellFormat) => {
    m.cells[a] = v;
    if (f) m.formats[a] = f;
  };
  m.styles[String(r)] = "header";
  set(`A${r}`, "Player-based projection");
  set(`B${r}`, "Home");
  set(`C${r}`, "Away");
  set(`D${r}`, "Notes");
  set(`A${r + 1}`, "Lineup strength (net / 100)");
  set(`B${r + 1}`, "=[Home Lineup Strength]", "dec2");
  set(`C${r + 1}`, "=[Away Lineup Strength]", "dec2");
  set(`D${r + 1}`, "Available players' ratings x projected minutes (injury report applied)");
  set(`A${r + 2}`, "Player-based home margin");
  set(`B${r + 2}`, `=IFERROR((B${r + 1}-C${r + 1})*K12/100+$B$${hcaRow},0)`, "dec1");
  set(`D${r + 2}`, "Strength difference x expected possessions + home court");
  set(`A${r + 3}`, "Sheet home margin");
  set(`B${r + 3}`, "=(K17+L27)/2-(L17+K27)/2", "dec1");
  set(`A${r + 4}`, "Blend weight");
  set(`B${r + 4}`, "0.3", "dec2");
  set(`D${r + 4}`, "0 = sheet only, 1 = player-based only; 0.3 fit best on 2023-26 held-out seasons (with injury scale 0.4)");
  m.styles[String(r + 5)] = "bold";
  set(`A${r + 5}`, "Score adjustment");
  set(`B${r + 5}`, `=IFERROR(ISNUMBER(B${r + 1})*ISNUMBER(C${r + 1})*$B$${r + 4}*(B${r + 2}-$B$${hcaRow}-B${r + 3})/2,0)`, "dec2");
  set(`C${r + 5}`, `=-B${r + 5}`, "dec2");
  m.rows = Math.max(m.rows, r + 15);
  for (const [cell, col] of [["B4", "B"], ["B5", "C"]] as const) {
    const f = (m.cells[cell] ?? "").replace(/\s+/g, "");
    const mm = /^=MROUND\((.*),0\.5\)$/.exec(f);
    if (mm && !f.includes(`${col}${r + 5}`)) m.cells[cell] = `=MROUND(${mm[1]}+${col}${r + 5},0.5)`;
  }
  return r + 5;
}

// Schedule, rest & rating section, replacing the player-based blend weight: the home
// margin becomes a weighted mix of the sheet's stat margin, the player-based margin and a
// schedule-adjusted rating (YTD point margin + SOS, shrunk early in the season), plus a
// back-to-back penalty. Weights fit on 2023-26 held-out seasons (scripts/research8.ts).
export type MarginParams = { homeCourt: number; wStat: number; wPlayer: number; wRating: number; b2b: number; shrink: number };
export const MARGIN_DEFAULTS: MarginParams = { homeCourt: 2, wStat: 0.3, wPlayer: 0.35, wRating: 0.4, b2b: 2, shrink: 10 };
const SCHEDULE_HEADER = "Schedule, rest & rating";

export function addScheduleRating(m: SheetModel, p: MarginParams = MARGIN_DEFAULTS): number {
  const rowOf = (label: string) => {
    const hit = Object.entries(m.cells).find(([a, v]) => /^A\d+$/.test(a) && v === label);
    return hit ? Number(hit[0].slice(1)) : null;
  };
  const set = (a: string, v: string, f?: CellFormat) => {
    m.cells[a] = v;
    if (f) m.formats[a] = f;
  };
  const hca = rowOf("Home court (pts)"), str = rowOf("Lineup strength (net / 100)");
  const player = rowOf("Player-based home margin"), sheet = rowOf("Sheet home margin");
  if (!hca || !str || !player || !sheet) throw new Error("Add the Home court and Player-based sections first");
  set(`B${hca}`, String(p.homeCourt));
  set(`D${hca}`, "2 fit best on 2023-26 held-out seasons alongside the Schedule, rest & rating section");

  const existing = rowOf(SCHEDULE_HEADER);
  if (existing) {
    const r = existing;
    set(`B${r + 2}`, String(p.b2b));
    set(`B${r + 7}`, String(p.shrink));
    set(`B${r + 9}`, String(p.wStat));
    set(`B${r + 10}`, String(p.wPlayer));
    set(`B${r + 11}`, String(p.wRating));
    return r + 13;
  }

  // The old blend weight + its score adjustment are replaced by the weights below.
  const blend = rowOf("Blend weight");
  if (blend) {
    for (const c of "ABCD") {
      delete m.cells[`${c}${blend}`];
      delete m.cells[`${c}${blend + 1}`];
    }
    delete m.styles[String(blend + 1)];
    m.cells.B4 = m.cells.B4.replace(`+B${blend + 1}`, "");
    m.cells.B5 = m.cells.B5.replace(`+C${blend + 1}`, "");
  }

  const maxRow = Math.max(...Object.keys(m.cells).map((a) => Number(a.replace(/^[A-Z]+/, ""))));
  const r = maxRow + 2;
  m.styles[String(r)] = "header";
  set(`A${r}`, SCHEDULE_HEADER);
  set(`B${r}`, "Home");
  set(`C${r}`, "Away");
  set(`D${r}`, "Notes");
  set(`A${r + 1}`, "Rest days");
  set(`B${r + 1}`, `=IFERROR([Home YTD Rest Days],"--")`, "int");
  set(`C${r + 1}`, `=IFERROR([Away YTD Rest Days],"--")`, "int");
  set(`D${r + 1}`, "Days since the team's last game; 1 = second night of a back-to-back");
  set(`A${r + 2}`, "Back-to-back penalty (pts)");
  set(`B${r + 2}`, String(p.b2b), "dec1");
  set(`D${r + 2}`, "Taken off a team on the second night of a back-to-back");
  set(`A${r + 3}`, "Point margin YTD");
  set(`B${r + 3}`, "=IFERROR([Home YTD Points/Game]-[Home YTD Opp. Points/Game],0)", "dec1");
  set(`C${r + 3}`, "=IFERROR([Away YTD Points/Game]-[Away YTD Opp. Points/Game],0)", "dec1");
  set(`A${r + 4}`, "Schedule strength (SOS)");
  set(`B${r + 4}`, "=IFERROR(IF(ISNUMBER([Home YTD SOS]),[Home YTD SOS],0),0)", "dec1");
  set(`C${r + 4}`, "=IFERROR(IF(ISNUMBER([Away YTD SOS]),[Away YTD SOS],0),0)", "dec1");
  set(`D${r + 4}`, "Average point margin of the opponents faced so far");
  set(`A${r + 5}`, "Games played");
  set(`B${r + 5}`, "=[Home YTD Games]", "int");
  set(`C${r + 5}`, "=[Away YTD Games]", "int");
  set(`A${r + 6}`, "Rating (margin + SOS)");
  set(`B${r + 6}`, `=B${r + 3}+B${r + 4}`, "dec1");
  set(`C${r + 6}`, `=C${r + 3}+C${r + 4}`, "dec1");
  set(`D${r + 6}`, "Schedule-adjusted point margin per game");
  set(`A${r + 7}`, "Rating shrink (games)");
  set(`B${r + 7}`, String(p.shrink), "int");
  set(`C${r + 7}`, `=AVERAGE(B${r + 5},C${r + 5})/(AVERAGE(B${r + 5},C${r + 5})+B${r + 7})`, "dec2");
  set(`D${r + 7}`, "C = how much the rating counts: G/(G + shrink); the rest of its weight goes to the sheet stats");
  m.styles[String(r + 8)] = "header";
  set(`A${r + 8}`, "Margin blend");
  set(`B${r + 8}`, "Weight");
  set(`D${r + 8}`, "Notes");
  set(`A${r + 9}`, "Sheet stats");
  set(`B${r + 9}`, String(p.wStat), "dec2");
  set(`D${r + 9}`, `Sheet home margin (row ${sheet})`);
  set(`A${r + 10}`, "Player-based");
  set(`B${r + 10}`, String(p.wPlayer), "dec2");
  set(`D${r + 10}`, `Player-based home margin less home court (row ${player}); with no lineup data its weight goes to the sheet stats`);
  set(`A${r + 11}`, "Rating");
  set(`B${r + 11}`, String(p.wRating), "dec2");
  set(`D${r + 11}`, "Home rating minus away rating (early season: mostly the sheet stats instead)");
  set(`A${r + 12}`, "Blended home margin");
  set(`B${r + 12}`,
    `=IF(ISNUMBER(B${str})*ISNUMBER(C${str}),B${r + 9}*B${sheet}+B${r + 10}*(B${player}-$B$${hca}),(B${r + 9}+B${r + 10})*B${sheet})+B${r + 11}*(C${r + 7}*(B${r + 6}-C${r + 6})+(1-C${r + 7})*B${sheet})`, "dec1");
  set(`D${r + 12}`, "Before home court, injuries and rest. The weights add to more than 1 on purpose: each piece alone runs too narrow");
  m.styles[String(r + 13)] = "bold";
  set(`A${r + 13}`, "Score adjustment");
  set(`B${r + 13}`, `=(B${r + 12}-B${sheet})/2+IF(B${r + 1}=1,-$B$${r + 2}/2,0)+IF(C${r + 1}=1,$B$${r + 2}/2,0)`, "dec2");
  set(`C${r + 13}`, `=-B${r + 13}`, "dec2");
  m.rows = Math.max(m.rows, r + 20);
  for (const [cell, col] of [["B4", "B"], ["B5", "C"]] as const) {
    const f = (m.cells[cell] ?? "").replace(/\s+/g, "");
    const mm = /^=MROUND\((.*),0\.5\)$/.exec(f);
    if (mm && !f.includes(`${col}${r + 13}`)) m.cells[cell] = `=MROUND(${mm[1]}+${col}${r + 13},0.5)`;
  }
  return r + 13;
}

// Motivation section: a team outside the play-in spots (conference seed 11+) late in the
// season (65+ games) has finished ~4.5 points worse than the stats say on 2023-26: it is
// playing for lottery odds. Penalty fit on held-out seasons (scripts/research9.ts).
export type MotivationParams = { tank: number; seedFrom: number; minGames: number };
export const MOTIVATION_DEFAULTS: MotivationParams = { tank: 4.5, seedFrom: 11, minGames: 65 };
const MOTIVATION_HEADER = "Motivation";

export function addMotivation(m: SheetModel, p: MotivationParams = MOTIVATION_DEFAULTS): number {
  const set = (a: string, v: string, f?: CellFormat) => {
    m.cells[a] = v;
    if (f) m.formats[a] = f;
  };
  const hit = Object.entries(m.cells).find(([a, v]) => /^A\d+$/.test(a) && v === MOTIVATION_HEADER);
  if (hit) {
    const r = Number(hit[0].slice(1));
    set(`B${r + 4}`, String(p.tank));
    set(`B${r + 5}`, String(p.seedFrom));
    set(`B${r + 6}`, String(p.minGames));
    return r + 7;
  }
  const maxRow = Math.max(...Object.keys(m.cells).map((a) => Number(a.replace(/^[A-Z]+/, ""))));
  const r = maxRow + 2;
  m.styles[String(r)] = "header";
  set(`A${r}`, MOTIVATION_HEADER);
  set(`B${r}`, "Home");
  set(`C${r}`, "Away");
  set(`D${r}`, "Notes");
  set(`A${r + 1}`, "Conference seed");
  set(`B${r + 1}`, `=IFERROR(IF(ISNUMBER([Home YTD Conference Seed]),[Home YTD Conference Seed],"--"),"--")`, "int");
  set(`C${r + 1}`, `=IFERROR(IF(ISNUMBER([Away YTD Conference Seed]),[Away YTD Conference Seed],"--"),"--")`, "int");
  set(`D${r + 1}`, "Place in the conference by win % (no tiebreakers)");
  set(`A${r + 2}`, "Games played");
  set(`B${r + 2}`, "=[Home YTD Games]", "int");
  set(`C${r + 2}`, "=[Away YTD Games]", "int");
  set(`A${r + 3}`, "Out of the play-in (tanking)");
  set(`B${r + 3}`, `=IF(ISNUMBER(B${r + 1}),(B${r + 1}>=$B$${r + 5})*(B${r + 2}>=$B$${r + 6}),0)`, "int");
  set(`C${r + 3}`, `=IF(ISNUMBER(C${r + 1}),(C${r + 1}>=$B$${r + 5})*(C${r + 2}>=$B$${r + 6}),0)`, "int");
  set(`D${r + 3}`, "1 = playing for lottery odds: the stats overrate these teams late in the season");
  set(`A${r + 4}`, "Tanking penalty (pts)");
  set(`B${r + 4}`, String(p.tank), "dec1");
  set(`D${r + 4}`, "Fit on 2023-26 held-out seasons; tanking teams finished ~4.5 pts worse than the stats");
  set(`A${r + 5}`, "Seed at or below");
  set(`B${r + 5}`, String(p.seedFrom), "int");
  set(`A${r + 6}`, "Games played at least");
  set(`B${r + 6}`, String(p.minGames), "int");
  m.styles[String(r + 7)] = "bold";
  set(`A${r + 7}`, "Score adjustment");
  set(`B${r + 7}`, `=(C${r + 3}-B${r + 3})*$B$${r + 4}/2`, "dec2");
  set(`C${r + 7}`, `=-B${r + 7}`, "dec2");
  m.rows = Math.max(m.rows, r + 14);
  for (const [cell, col] of [["B4", "B"], ["B5", "C"]] as const) {
    const f = (m.cells[cell] ?? "").replace(/\s+/g, "");
    const mm = /^=MROUND\((.*),0\.5\)$/.exec(f);
    if (mm && !f.includes(`${col}${r + 7}`)) m.cells[cell] = `=MROUND(${mm[1]}+${col}${r + 7},0.5)`;
  }
  return r + 7;
}
