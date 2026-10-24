// Regenerate web/model.json from the starting template (overwrites your edits!).
//   npx tsx scripts/build-model-template.ts
import fs from "node:fs";
import { buildTemplate } from "../lib/sheetTemplate";

fs.writeFileSync("model.json", JSON.stringify(buildTemplate(), null, 1) + "\n");
console.log("Wrote model.json");
