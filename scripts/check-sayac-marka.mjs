import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const cols = db.prepare("PRAGMA table_info(sayac)").all().map((c) => c.name);

const marka = db
  .prepare(
    `SELECT TRIM(COALESCE(sayac_markasi,'')) AS marka, COUNT(*) AS c FROM sayac GROUP BY marka ORDER BY c DESC`
  )
  .all();

const numaraliMarka = db
  .prepare(
    `
    SELECT TRIM(COALESCE(sayac_markasi,'')) AS marka, COUNT(*) AS c
    FROM sayac
    WHERE TRIM(COALESCE(sayac_id,'')) != ''
    GROUP BY marka ORDER BY c DESC
  `
  )
  .all();

let maskiTip = [];
try {
  const maski = JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "maski-arama-index.json"), "utf8")
  );
  const tipMap = new Map();
  for (const r of maski.records || []) {
    const tip = String(r.sayac_tipi || "").trim() || "(boş)";
    tipMap.set(tip, (tipMap.get(tip) || 0) + 1);
  }
  maskiTip = [...tipMap.entries()]
    .map(([tip, c]) => ({ tip, c }))
    .sort((a, b) => b.c - a.c);
} catch {
  maskiTip = [];
}

console.log(
  JSON.stringify(
    {
      sayac_tablo_kolonlari: cols,
      veritabani_marka_tum: marka,
      veritabani_marka_numarali: numaraliMarka,
      excel_sayac_tipi: maskiTip,
    },
    null,
    2
  )
);
