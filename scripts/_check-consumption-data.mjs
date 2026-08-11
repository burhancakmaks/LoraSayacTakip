import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import * as XLSX from "xlsx";

const db = new DatabaseSync("data/binalar.db");

console.log("=== rezerv_abonelik sample ===");
console.log(db.prepare("SELECT * FROM rezerv_abonelik LIMIT 2").all());

console.log("\n=== bildirim sample ===");
try {
  console.log(db.prepare("SELECT * FROM bildirim LIMIT 3").all());
} catch {}

console.log("\n=== saha_gorev ===");
try {
  const cols = db.prepare("PRAGMA table_info(saha_gorev)").all().map((c) => c.name);
  console.log("cols:", cols.join(", "));
  console.log(db.prepare("SELECT * FROM saha_gorev LIMIT 2").all());
} catch {}

const downloads = "C:/Users/Surface/Downloads";
const maski = readdirSync(downloads).find((f) => /MASKI_Abonelik_Yonetim/i.test(f) && f.endsWith(".xlsx"));
if (maski) {
  const wb = XLSX.read(readFileSync(`${downloads}/${maski}`));
  const sh = wb.SheetNames.find((s) => /master|veri/i.test(s)) || wb.SheetNames[2] || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { defval: "" });
  console.log("\n=== MASKI excel sheet:", sh, "rows:", rows.length, "===");
  if (rows[0]) console.log("columns:", Object.keys(rows[0]).slice(0, 30).join(" | "));
  console.log("sample row:", JSON.stringify(rows[0]).slice(0, 500));
}
