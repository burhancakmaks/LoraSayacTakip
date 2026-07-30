/**
 * Rezerv Alanları Tarife Türü Excel import
 * - rezerv_abonelik: tüm abonelik satırları
 * - bina_tarife_ozet: bina bazlı sınıflandırma (harita renklendirme)
 * - sayac tablosuna abone_no + tarife_turu zenginleştirme
 */
import { readdirSync, readFileSync, copyFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";
import { classifyTarifeTuru, aggregateBinaTarife } from "./tarife-classify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

const SEARCH_DIRS = ["C:/Users/Surface/Downloads", DATA_DIR];

function findExcel() {
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/rezerv/i.test(f) && /tarife/i.test(f) && f.endsWith(".xlsx")) {
        return join(dir, f);
      }
    }
  }
  return null;
}

function normSayac(v) {
  return String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "").replace(/^0+/, "");
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rezerv_abonelik (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kaynak_id TEXT,
      installation_number TEXT,
      building_uavt TEXT,
      mahalle_uavt TEXT,
      abone_no TEXT,
      sayac_no TEXT,
      tarife_turu TEXT,
      tarife_grup TEXT,
      tarife_sinif TEXT,
      bina_id INTEGER,
      match_kaynak TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bina_tarife_ozet (
      bina_id INTEGER PRIMARY KEY,
      building_uavt TEXT,
      tarife_sinif TEXT NOT NULL DEFAULT 'diger',
      tarife_etiket TEXT NOT NULL DEFAULT 'Bilinmiyor',
      tarife_turu TEXT DEFAULT '',
      karma INTEGER NOT NULL DEFAULT 0,
      abone_sayisi INTEGER NOT NULL DEFAULT 0,
      mesken_sayisi INTEGER NOT NULL DEFAULT 0,
      ticarethane_sayisi INTEGER NOT NULL DEFAULT 0,
      ortak_sayisi INTEGER NOT NULL DEFAULT 0,
      resmi_sayisi INTEGER NOT NULL DEFAULT 0,
      ozel_sayisi INTEGER NOT NULL DEFAULT 0,
      sivil_sayisi INTEGER NOT NULL DEFAULT 0,
      gecici_sayisi INTEGER NOT NULL DEFAULT 0,
      tarimsal_sayisi INTEGER NOT NULL DEFAULT 0,
      atik_su_sayisi INTEGER NOT NULL DEFAULT 0,
      diger_sayisi INTEGER NOT NULL DEFAULT 0,
      rezerv_alan INTEGER NOT NULL DEFAULT 1,
      match_kaynak TEXT DEFAULT '',
      match_guven REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_rezerv_bina ON rezerv_abonelik(bina_id);
    CREATE INDEX IF NOT EXISTS idx_rezerv_uavt ON rezerv_abonelik(building_uavt);
    CREATE INDEX IF NOT EXISTS idx_rezerv_sayac ON rezerv_abonelik(sayac_no);
    CREATE INDEX IF NOT EXISTS idx_tarife_sinif ON bina_tarife_ozet(tarife_sinif);
  `);

  try { db.exec(`ALTER TABLE sayac ADD COLUMN tarife_turu TEXT DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE sayac ADD COLUMN tarife_sinif TEXT DEFAULT ''`); } catch {}
}

function incGrup(bucket, grup) {
  const key = `${grup}_sayisi`;
  if (key in bucket) bucket[key]++;
  else bucket.diger_sayisi++;
}

const excelPath = findExcel();
if (!excelPath) {
  console.error("Rezerv tarife Excel dosyasi bulunamadi.");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = join(DATA_DIR, `binalar.before-rezerv-tarife-${stamp}.db`);
copyFileSync(DB_PATH, backup);

// Excel'i data klasörüne kopyala
const destExcel = join(DATA_DIR, "rezerv-alan-tarife-turu.xlsx");
copyFileSync(excelPath, destExcel);

const wb = XLSX.read(readFileSync(excelPath), { type: "buffer" });
const sheetName = wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

const db = new DatabaseSync(DB_PATH);
ensureSchema(db);

const binaIds = new Set(db.prepare("SELECT id FROM binalar").all().map((r) => r.id));
const sayacToBina = new Map();
const sayacRowId = new Map();
for (const r of db.prepare(`SELECT id, bina_id, sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''`).all()) {
  const k = normSayac(r.sayac_id);
  if (k) {
    sayacToBina.set(k, r.bina_id);
    sayacRowId.set(k, r.id);
  }
}

const stats = {
  excel_path: excelPath,
  total_rows: rows.length,
  inserted: 0,
  matched_sayac: 0,
  matched_id: 0,
  matched_total: 0,
  with_tarife: 0,
  bina_classified: 0,
  sayac_enriched: 0,
  by_sinif: {},
};

db.exec("BEGIN IMMEDIATE");
try {
  db.exec("DELETE FROM rezerv_abonelik");
  db.exec("DELETE FROM bina_tarife_ozet");

  const insertRezerv = db.prepare(`
    INSERT INTO rezerv_abonelik (
      kaynak_id, installation_number, building_uavt, mahalle_uavt,
      abone_no, sayac_no, tarife_turu, tarife_grup, tarife_sinif,
      bina_id, match_kaynak
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateSayac = db.prepare(`
    UPDATE sayac SET
      abone_no = CASE WHEN TRIM(COALESCE(abone_no,''))='' THEN ? ELSE abone_no END,
      tarife_turu = ?,
      tarife_sinif = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const binaAgg = new Map();

  for (const r of rows) {
    const tarifeRaw = String(r.tarife_turu || "").trim();
    const classified = classifyTarifeTuru(tarifeRaw);
    const sayacNo = String(r["Sayaç Numarası"] || "").trim();
    const aboneNo = String(r["Abone No"] || "").trim();
    const kaynakId = String(r.id ?? "").trim();
    const inst = String(r.installation_number ?? "").trim();
    const uavt = String(r.building_uavt ?? "").trim();
    const mahalleUavt = String(r.mahalle_uavt ?? "").trim();

    if (tarifeRaw) stats.with_tarife++;

    let binaId = null;
    let matchKaynak = "";
    const sk = normSayac(sayacNo);
    if (sk && sayacToBina.has(sk)) {
      binaId = sayacToBina.get(sk);
      matchKaynak = "sayac";
      stats.matched_sayac++;
    } else {
      const idNum = Number(kaynakId);
      if (binaIds.has(idNum)) {
        binaId = idNum;
        matchKaynak = "bina_id";
        stats.matched_id++;
      }
    }
    if (binaId) stats.matched_total++;

    insertRezerv.run(
      kaynakId, inst, uavt, mahalleUavt,
      aboneNo, sayacNo, tarifeRaw, classified.grup, classified.sinif,
      binaId, matchKaynak || null
    );
    stats.inserted++;

    if (binaId && tarifeRaw) {
      if (!binaAgg.has(binaId)) {
        binaAgg.set(binaId, {
          building_uavt: uavt,
          tarifes: {},
          gruplar: {
            mesken_sayisi: 0, ticarethane_sayisi: 0, ortak_sayisi: 0,
            resmi_sayisi: 0, ozel_sayisi: 0, sivil_sayisi: 0,
            gecici_sayisi: 0, tarimsal_sayisi: 0, atik_su_sayisi: 0, diger_sayisi: 0,
          },
          match_kaynak: matchKaynak,
        });
      }
      const agg = binaAgg.get(binaId);
      if (uavt && !agg.building_uavt) agg.building_uavt = uavt;
      agg.tarifes[tarifeRaw] = (agg.tarifes[tarifeRaw] || 0) + 1;
      incGrup(agg.gruplar, classified.grup);
    }

    if (binaId && sk && sayacRowId.has(sk) && tarifeRaw) {
      updateSayac.run(aboneNo, tarifeRaw, classified.sinif, sayacRowId.get(sk));
      stats.sayac_enriched++;
    }
  }

  const insertOzet = db.prepare(`
    INSERT INTO bina_tarife_ozet (
      bina_id, building_uavt, tarife_sinif, tarife_etiket, tarife_turu, karma,
      abone_sayisi, mesken_sayisi, ticarethane_sayisi, ortak_sayisi,
      resmi_sayisi, ozel_sayisi, sivil_sayisi, gecici_sayisi,
      tarimsal_sayisi, atik_su_sayisi, diger_sayisi,
      rezerv_alan, match_kaynak, match_guven, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, datetime('now'))
  `);

  for (const [binaId, agg] of binaAgg) {
    const summary = aggregateBinaTarife(agg.tarifes);
    const guven = agg.match_kaynak === "sayac" ? 0.95 : 0.7;
    insertOzet.run(
      binaId,
      agg.building_uavt || "",
      summary.sinif,
      summary.etiket,
      summary.tarife_turu,
      summary.karma,
      summary.toplam,
      agg.gruplar.mesken_sayisi,
      agg.gruplar.ticarethane_sayisi,
      agg.gruplar.ortak_sayisi,
      agg.gruplar.resmi_sayisi,
      agg.gruplar.ozel_sayisi,
      agg.gruplar.sivil_sayisi,
      agg.gruplar.gecici_sayisi,
      agg.gruplar.tarimsal_sayisi,
      agg.gruplar.atik_su_sayisi,
      agg.gruplar.diger_sayisi,
      agg.match_kaynak,
      guven
    );
    stats.bina_classified++;
    stats.by_sinif[summary.sinif] = (stats.by_sinif[summary.sinif] || 0) + 1;
  }

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const reportPath = join(DATA_DIR, `rezerv-tarife-import-report-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify({ stats, backup, reportPath }, null, 2));

console.log("=== REZERV TARIFE IMPORT ===");
console.log("Yedek:", backup);
console.log("Excel:", excelPath);
console.log("Toplam satir:", stats.total_rows);
console.log("Tarifeli satir:", stats.with_tarife);
console.log("Eslesen (sayac):", stats.matched_sayac);
console.log("Eslesen (bina_id):", stats.matched_id);
console.log("Siniflandirilan bina:", stats.bina_classified);
console.log("Sayac zenginlestirme:", stats.sayac_enriched);
console.log("\nSinif dagilimi:");
Object.entries(stats.by_sinif).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
console.log("\nRapor:", reportPath);
