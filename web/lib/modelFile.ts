import fs from "node:fs";
import path from "node:path";
import type { Model } from "./model";

// The published model: web/model.json in the repo. Edit it on the Model page,
// download, and commit to publish.
export function getModel(): Model {
  const p = path.join(process.cwd(), "model.json");
  if (!fs.existsSync(p)) return { rows: [] };
  return JSON.parse(fs.readFileSync(p, "utf8")) as Model;
}
