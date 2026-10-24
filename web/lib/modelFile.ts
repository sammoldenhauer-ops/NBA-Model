import fs from "node:fs";
import path from "node:path";
import type { SheetModel } from "./sheet";
import { buildTemplate } from "./sheetTemplate";

// The published model sheet: web/model.json in the repo. Edit it on the Model page,
// download, and commit to publish. Falls back to the starting template.
export function getModel(): SheetModel {
  const p = path.join(process.cwd(), "model.json");
  if (fs.existsSync(p)) {
    const m = JSON.parse(fs.readFileSync(p, "utf8")) as SheetModel;
    if (m.version === 2) return m;
  }
  return buildTemplate();
}
