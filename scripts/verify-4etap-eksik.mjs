import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(ROOT, "data/binalar.db"));

// Geçerli sayaçların üzerine eksik yazıldı mı?
const overwritten = db.prepare(`
  SELECT b.value, s.blok_no, s.kapi_no, s.sayac_id, s.sayac_durum, s.updated_at
  FROM sayac s JOIN binalar b ON b.id = s.bina_id
  WHERE (s.blok_no GLOB 'DB-*' OR s.blok_no GLOB 'GB-*' OR s.blok_no GLOB 'DC-*')
    AND COALESCE(s.sayac_durum,'gecerli') = 'eksik'
    AND EXISTS (
      SELECT 1 FROM sayac s2
      WHERE s2.bina_id = s.bina_id AND s2.kapi_no = s.kapi_no AND s2.blok_no = s.blok_no
        AND s2.id != s.id AND TRIM(COALESCE(s2.sayac_id,'')) != ''
        AND COALESCE(s2.sayac_durum,'gecerli') = 'gecerli'
    )
`).all();

// KD satırları ne?
const kdCount = db.prepare(`
  SELECT COUNT(*) c FROM sayac
  WHERE COALESCE(sayac_durum,'gecerli')='eksik'
    AND (blok_no GLOB 'DB-*' OR blok_no GLOB 'GB-*' OR blok_no GLOB 'DC-*')
    AND kapi_no = 'KD'
`).get().c;

// ŞİRE eksikleri (4 etap dışı)
const sireEksik = db.prepare(`
  SELECT b.value, s.blok_no, s.kapi_no, s.kullanilis_sekli
  FROM sayac s JOIN binalar b ON b.id = s.bina_id
  WHERE COALESCE(s.sayac_durum,'gecerli')='eksik'
    AND NOT (s.blok_no GLOB 'DB-*' OR s.blok_no GLOB 'GB-*' OR s.blok_no GLOB 'DC-*')
`).all();

// Excel'de aynı blok+daire için hem - hem geçerli sayaç var mı?
const excelPath = (() => {
  for (const dir of ["C:/Users/Surface/Downloads", join(ROOT, "data")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.toUpperCase().includes("4.ETAP") && f.toUpperCase().includes("SAY"))
        return join(dir, f);
    }
  }
  return null;
})();

const wb = XLSX.read(readFileSync(excelPath), { type: "buffer" });
let dashWithValidElsewhere = 0;
for (const sheetName of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
  const headerRow = rows[1] || [];
  const colBlok = {};
  for (let c = 1; c < headerRow.length; c++) {
    const h = String(headerRow[c] ?? "").trim();
    if (h && /^(DB|DC|GB)-/.test(h)) colBlok[c] = h.replace(/\*$/, "");
  }
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    for (const [cStr, blok] of Object.entries(colBlok)) {
      const c = Number(cStr);
      const daire = String(row[c] ?? "").trim();
      const raw = String(row[c + 1] ?? "").trim();
      if (raw !== "-" && raw !== "---") continue;
      // aynı blokta başka satırda aynı daire geçerli sayaç?
      for (let r2 = 3; r2 < rows.length; r2++) {
        if (r2 === r) continue;
        if (String(rows[r2][c] ?? "").trim() === daire) {
          const other = String(rows[r2][c + 1] ?? "").trim();
          if (other && other !== "-" && !/^-+$/.test(other) && /\d{6,}/.test(other.replace(/\D/g, ""))) {
            dashWithValidElsewhere++;
          }
        }
      }
    }
  }
}

console.log(JSON.stringify({
  overwritten_valid_sayac: overwritten.length,
  kd_eksik_count: kdCount,
  sire_eksik: sireEksik,
  excel_dash_rows: 85,
  total_eksik_db: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE COALESCE(sayac_durum,'gecerli')='eksik'`).get().c,
}, null, 2));
