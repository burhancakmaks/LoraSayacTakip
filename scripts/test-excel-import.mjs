import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(import.meta.dirname, "..");
const DB = join(ROOT, "data/binalar.db");

// Dynamic import of TS not available - inline minimal test via xlsx only
function normHeader(s) {
  return String(s ?? "").toLocaleUpperCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const files = [
  ...readdirSync(join(ROOT, "data")).filter((f) => /\.xlsx?$/i.test(f)).map((f) => join(ROOT, "data", f)),
  ...readdirSync(join(ROOT, "data/uploads")).filter((f) => f.endsWith(".xlsx")).map((f) => join(ROOT, "data/uploads", f)),
].slice(0, 8);

for (const path of files) {
  const buf = readFileSync(path);
  const wb = XLSX.read(buf, { type: "buffer" });
  const name = path.split(/[/\\]/).pop();
  console.log("\n---", name, "---");
  console.log("sheets:", wb.SheetNames.slice(0, 5).join(", "));
  for (const sn of wb.SheetNames.slice(0, 2)) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: "" });
    for (let i = 0; i < Math.min(5, data.length); i++) {
      console.log(`  row${i}:`, JSON.stringify((data[i] || []).slice(0, 8)));
    }
  }
}
