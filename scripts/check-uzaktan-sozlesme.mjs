import { readFileSync, existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { DatabaseSync } from "node:sqlite";

const excelPath =
  process.argv[2] ||
  "C:/Users/Surface/Downloads/uzaktan okuma sözleşme.xlsx";

const wb = XLSX.readFile(excelPath);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const meters = new Map();
const types = {};
for (const r of rows) {
  const m = String(r.meter_number ?? "").trim();
  const v = String(r.value ?? "").trim() || "BILINMIYOR";
  if (!m) continue;
  types[v] = (types[v] || 0) + 1;
  if (!meters.has(m)) meters.set(m, v);
}

console.log("Unique meters in excel:", meters.size);
console.log("Types:", types);

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
const sayacRows = db
  .prepare("SELECT sayac_id, bina_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''")
  .all();

const bySayac = new Map();
const byDigits = new Map();
for (const r of sayacRows) {
  const id = String(r.sayac_id).trim();
  const digits = id.replace(/\D/g, "");
  bySayac.set(id, r.bina_id);
  if (digits) byDigits.set(digits, r.bina_id);
}

let matched = 0;
const matchedBina = new Set();
for (const [m] of meters) {
  const digits = m.replace(/\D/g, "");
  const bina = bySayac.get(m) ?? byDigits.get(digits);
  if (bina) {
    matched++;
    matchedBina.add(bina);
  }
}

console.log("Matched sayac in DB:", matched);
console.log("Matched buildings:", matchedBina.size);
