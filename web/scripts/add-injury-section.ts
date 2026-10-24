// Add the Injuries section to the published model.json (once).
//   cd web && npx tsx scripts/add-injury-section.ts
import fs from "node:fs";
import type { SheetModel } from "../lib/sheet";
import { addInjurySection } from "../lib/sheetTemplate";
const m = JSON.parse(fs.readFileSync("model.json", "utf8")) as SheetModel;
const adj = addInjurySection(m);
fs.writeFileSync("model.json", JSON.stringify(m, null, 1) + "\n");
console.log(`Injuries section ends at row ${adj}; B4 = ${m.cells.B4}; B5 = ${m.cells.B5}`);
