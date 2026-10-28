// Add the Motivation section (tanking penalty) to the published model.json (or reset its settings).
//   cd web && npx tsx scripts/add-motivation-section.ts
// Settings are the ones research9.ts picked on held-out seasons.
import fs from "node:fs";
import type { SheetModel } from "../lib/sheet";
import { addMotivation, MOTIVATION_DEFAULTS } from "../lib/sheetTemplate";
const m = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const adj = addMotivation(m, MOTIVATION_DEFAULTS);
fs.writeFileSync("model.json", JSON.stringify(m, null, 1) + "\n");
console.log(`Motivation section ends at row ${adj}; B4 = ${m.cells.B4}; B5 = ${m.cells.B5}`);
