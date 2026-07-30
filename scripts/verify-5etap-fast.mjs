import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const db = new DatabaseSync("data/binalar.db");
const wb = XLSX.read(readFileSync("data/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx"), { type: "buffer" });

const SHEETS = [];
for (const p of ["GB", "DB", "DC"]) {
  const max = p === "GB" ? 7 : p === "DB" ? 11 : 15;
  for (let i = 1; i <= max; i++) SHEETS.push(`${p}${i}`);
}

const COLS = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

const MANUAL = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

function norm(v) {
  return String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "").padStart(8, "0");
}
function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  return s.replace(/\D/g, "").length >= 6;
}

const dbMap = new Map();
for (const r of db.prepare(`SELECT s.sayac_id,s.blok_no,s.kullanilis_sekli,s.bina_id,b.value FROM sayac s JOIN binalar b ON b.id=s.bina_id WHERE TRIM(s.sayac_id)!=''`).all()) {
  dbMap.set(norm(r.sayac_id), r);
}

let total = 0, ok = 0;
const issues = [];
const sheetStats = {};

for (const sheet of SHEETS) {
  sheetStats[sheet] = { excel: 0, ok: 0, missing: 0, mismatch: 0 };
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  for (let r = 2; r < rows.length; r++) {
    const daire = String(rows[r][0] ?? "").trim();
    if (!daire || daire === "KAPICI") continue;
    for (const col of COLS) {
      const raw = rows[r][col.idx];
      if (!isValidSayac(raw)) continue;
      total++;
      sheetStats[sheet].excel++;
      const key = norm(raw);
      const row = dbMap.get(key);
      if (!row) {
        sheetStats[sheet].missing++;
        issues.push({ sheet, sayac: String(raw).trim(), problem: "DB'de yok" });
        continue;
      }
      const probs = [];
      if (row.blok_no !== sheet) probs.push(`blok=${row.blok_no}`);
      if (row.kullanilis_sekli !== col.tip) probs.push(`tip=${row.kullanilis_sekli}`);
      if (row.bina_id !== MANUAL[sheet]) probs.push(`bina=${row.bina_id}(${row.value})`);
      if (probs.length) {
        sheetStats[sheet].mismatch++;
        issues.push({ sheet, sayac: row.sayac_id, problem: probs.join(", ") });
      } else {
        ok++;
        sheetStats[sheet].ok++;
      }
    }
  }
}

console.log("=== 5. ETAP SAYAC DOGRULAMA ===");
console.log("Toplam Excel kayit:", total);
console.log("Tam dogru:", ok, `(${((ok/total)*100).toFixed(1)}%)`);
console.log("Eksik:", issues.filter(i=>i.problem==="DB'de yok").length);
console.log("Uyumsuz:", issues.filter(i=>i.problem!=="DB'de yok").length);

const badSheets = Object.entries(sheetStats).filter(([,s]) => s.missing || s.mismatch);
if (badSheets.length) {
  console.log("\nSorunlu bloklar:");
  badSheets.forEach(([k,v]) => console.log(`  ${k}: excel=${v.excel} ok=${v.ok} eksik=${v.missing} uyumsuz=${v.mismatch}`));
}

if (issues.length) {
  console.log("\nDetay (ilk 15):");
  issues.slice(0, 15).forEach(i => console.log(`  ${i.sheet} ${i.sayac}: ${i.problem}`));
}

console.log("\nOrnekler:");
["80088615","80087705","80061475","80078490","80061574"].forEach(no => {
  const r = dbMap.get(norm(no));
  console.log(`  ${no} -> ${r ? `${r.blok_no} ${r.kullanilis_sekli} bina=${r.value}` : "YOK"}`);
});
