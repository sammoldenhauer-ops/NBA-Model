// Add the Injuries and Home court sections to the published model.json (once each).
//   cd web && npx tsx scripts/add-injury-section.ts
import fs from "node:fs";
import type { SheetModel } from "../lib/sheet";
import { addHomeCourt, addInjurySection, addPlayerProjection } from "../lib/sheetTemplate";
const m = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const adj = addInjurySection(m);
addPlayerProjection(m, addHomeCourt(m));
fs.writeFileSync("model.json", JSON.stringify(m, null, 1) + "\n");
console.log(`Injuries section ends at row ${adj}; B4 = ${m.cells.B4}; B5 = ${m.cells.B5}`);
