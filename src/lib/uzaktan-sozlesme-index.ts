import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  type UzaktanSozlesmeIndex,
  UZAKTAN_TYPE_COLORS,
} from "@/lib/uzaktan-sozlesme";

let cachedIndex: UzaktanSozlesmeIndex | null = null;
let cachedMtime = 0;

function indexPath() {
  return path.join(process.cwd(), "data", "uzaktan-sozlesme-index.json");
}

export function loadUzaktanSozlesmeIndex(): UzaktanSozlesmeIndex {
  const filePath = indexPath();
  if (!existsSync(filePath)) {
    return {
      built_at: "",
      excel_path: "",
      type_colors: UZAKTAN_TYPE_COLORS,
      stats: {
        excel_rows: 0,
        excel_unique_meters: 0,
        excel_by_type: {},
        matched_sayac: 0,
        matched_bina: 0,
        unmatched_excel_meters: 0,
        matched_by_type: {},
      },
      binalar: {},
    };
  }

  const fileStat = statSync(filePath);
  if (cachedIndex && cachedMtime === fileStat.mtimeMs) return cachedIndex;

  const raw = readFileSync(filePath, "utf8");
  cachedIndex = JSON.parse(raw) as UzaktanSozlesmeIndex;
  cachedMtime = fileStat.mtimeMs;
  return cachedIndex;
}
