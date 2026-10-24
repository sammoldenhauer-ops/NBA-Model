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

  return {
    version: 2,
    cols: 14,
    rows: row + 20,
    cells,
    formats,
    styles,
    widths: { A: 210 },
    outputs: { home_score: "B4", away_score: "B5" },
  };
}
