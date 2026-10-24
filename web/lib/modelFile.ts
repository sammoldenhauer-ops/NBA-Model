import crypto from "node:crypto";
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

// Short hash of the published model.json, to check the confidence calibration
// was fitted on this exact sheet.
export function getModelHash(): string {
  const p = path.join(process.cwd(), "model.json");
  if (!fs.existsSync(p)) return "";
  return crypto.createHash("sha1").update(fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);
}
