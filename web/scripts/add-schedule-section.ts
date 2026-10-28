// Add the Schedule, rest & rating section to the published model.json (or reset its settings).
//   cd web && npx tsx scripts/add-schedule-section.ts
// Settings are the ones research8.ts picked on held-out seasons.
import fs from "node:fs";
import type { SheetModel } from "../lib/sheet";
import { addScheduleRating, MARGIN_DEFAULTS } from "../lib/sheetTemplate";
const m = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const adj = addScheduleRating(m, MARGIN_DEFAULTS);
fs.writeFileSync("model.json", JSON.stringify(m, null, 1) + "\n");
console.log(`Schedule section ends at row ${adj}; B4 = ${m.cells.B4}; B5 = ${m.cells.B5}`);
