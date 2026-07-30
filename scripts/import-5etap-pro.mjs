/**
 * 5. ETAP profesyonel import
 * - Dogrulanmis blok -> bina_id eslemesi (cografi kume analizi)
 * - Adres: ada_parsel + sokak (bina adi ile)
 * - Cakisan sayaclari dogru binaya tasir
 * - bina_bilgi olusturur -> haritada yesil
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const ROOT = "c:/Users/Surface/Desktop/LoraLast/LoraSayacTakip";
const DB_PATH = join(ROOT, "data/binalar.db");
const EXCEL_PATHS = [
  join(ROOT, "data/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx"),
  "C:/Users/Surface/Downloads/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx",
];

const COLS = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

// Cografi analiz + isim eslemesi ile dogrulanmis bina_id'ler
const SHEET_TO_BINA = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59,
  DB5: 1064, DB6: 1071, DB7: 1065, DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

const SHEET_NAMES = Object.keys(SHEET_TO_BINA);
const BLOK_PATTERN = /^(GB|DB|DC)\d+$/;

function normSayac(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .padStart(8, "0");
}

function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = s.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 10;
}

function resolveExcelPath() {
  for (const p of EXCEL_PATHS) if (existsSync(p)) return p;
  throw new Error("5. ETAP Excel dosyasi bulunamadi");
}

function parseExcel(path) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheet of wb.SheetNames) {
    if (!SHEET_TO_BINA[sheet]) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < rows.length; r++) {
      const daire = String(rows[r][0] ?? "").trim();
      if (!daire || daire === "KAPICI") continue;
      for (const col of COLS) {
        const sayac = rows[r][col.idx];
        if (!isValidSayac(sayac)) continue;
        records.push({
          sheet,
          binaId: SHEET_TO_BINA[sheet],
          daire,
          tip: col.tip,
          sayac_no: String(sayac).trim(),
          sayacKey: normSayac(sayac),
        });
      }
    }
  }
  return records;
}

function buildAddress(db, sheet, binaId) {
  const b = db.prepare(`SELECT value, layer FROM binalar WHERE id=?`).get(binaId);
  const name = String(b?.value ?? "").trim() || `Bina ${binaId}`;
  return {
    ada_parsel: "5. ETAP",
    sokak: `MALATYA MERKEZ 5. ETAP - ${sheet} (${name})`,
    building_name: name,
    layer: b?.layer || "",
  };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const excelPath = resolveExcelPath();
  const db = new DatabaseSync(DB_PATH);
  const records = parseExcel(excelPath);

  const stats = {
    excel_path: excelPath,
    total_excel: records.length,
    removed_old: 0,
    relocated: 0,
    inserted: 0,
    updated: 0,
    bina_bilgi_created: 0,
    bina_bilgi_updated: 0,
    by_sheet: {},
    addresses: {},
    errors: [],
  };

  for (const sheet of SHEET_NAMES) {
    const addr = buildAddress(db, sheet, SHEET_TO_BINA[sheet]);
    stats.addresses[sheet] = addr;
  }

  if (dryRun) {
    console.log(JSON.stringify({ stats, sheet_mapping: SHEET_TO_BINA }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-5etap-pro-${stamp}.db`);
  copyFileSync(DB_PATH, backup);

  db.exec("BEGIN IMMEDIATE");
  try {
    // 1) Eski 5. ETAP importunu temizle (GB1/DB5/DC7 formati)
    const oldIds = db.prepare(`
      SELECT id FROM sayac WHERE blok_no GLOB 'GB[0-9]*' OR blok_no GLOB 'DB[0-9]*' OR blok_no GLOB 'DC[0-9]*'
    `).all().map((r) => r.id);
    if (oldIds.length) {
      const chunks = [];
      for (let i = 0; i < oldIds.length; i += 500) {
        chunks.push(oldIds.slice(i, i + 500));
      }
      for (const chunk of chunks) {
        db.prepare(`DELETE FROM sayac WHERE id IN (${chunk.map(() => "?").join(",")})`).run(...chunk);
      }
      stats.removed_old = oldIds.length;
    }

    // 2) Bos kalan 5. ETAP bina_bilgi kayitlarini sil
    db.prepare(`DELETE FROM bina_bilgi WHERE ada_parsel='5. ETAP' AND bina_id NOT IN (
      SELECT DISTINCT bina_id FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''
    )`).run();

    const excelByKey = new Map();
    for (const rec of records) {
      if (excelByKey.has(rec.sayacKey)) {
        stats.errors.push(`Cift sayac: ${rec.sayac_no} ${excelByKey.get(rec.sayacKey).sheet} vs ${rec.sheet}`);
      }
      excelByKey.set(rec.sayacKey, rec);
    }

    // Excel'deki tum sayaclari once sil (yanlis binadaki kopyalar dahil)
    const keys = [...excelByKey.keys()];
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      const placeholders = chunk.map(() => "?").join(",");
      db.prepare(`
        DELETE FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''
          AND REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','') IN (${placeholders})
      `).run(...chunk);
    }

    const byBina = new Map();
    for (const rec of excelByKey.values()) {
      if (!byBina.has(rec.binaId)) byBina.set(rec.binaId, []);
      byBina.get(rec.binaId).push(rec);
    }

    for (const [binaId, items] of byBina) {
      const sheet = items[0].sheet;
      const addr = buildAddress(db, sheet, binaId);
      const unique = [...items];

      let info = db.prepare(`SELECT * FROM bina_bilgi WHERE bina_id=?`).get(binaId);
      if (!info) {
        db.prepare(`
          INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
            has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
          VALUES (?, 0, ?, 0, ?, 0, ?, ?, '', datetime('now'))
        `).run(binaId, unique.length, unique.length, addr.ada_parsel, addr.sokak);
        stats.bina_bilgi_created++;
      } else {
        db.prepare(`
          UPDATE bina_bilgi SET
            ada_parsel = ?,
            sokak = ?,
            daire_sayisi = CASE WHEN COALESCE(daire_sayisi,0) < ? THEN ? ELSE daire_sayisi END,
            toplam_bagımsız_bolum = CASE WHEN COALESCE(toplam_bagımsız_bolum,0) < ? THEN ? ELSE toplam_bagımsız_bolum END,
            updated_at = datetime('now')
          WHERE bina_id = ?
        `).run(addr.ada_parsel, addr.sokak, unique.length, unique.length, unique.length, unique.length, binaId);
        stats.bina_bilgi_updated++;
      }

      let nextUnit = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`).get(binaId).n || 1;

      const insertSayac = db.prepare(`
        INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
          sayac_markasi, sayac_id, sicil_no, abone_no, updated_at)
        VALUES (?, ?, ?, '', ?, 'YOK', ?, '', ?, '', '', datetime('now'))
      `);

      for (const item of unique) {
        insertSayac.run(
          item.binaId, nextUnit, item.sheet, item.daire, item.tip, item.sayac_no
        );
        stats.inserted++;
        nextUnit++;
        stats.by_sheet[item.sheet] = (stats.by_sheet[item.sheet] || 0) + 1;
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const reportPath = join(ROOT, `data/5etap-import-report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ stats, backup, addresses: stats.addresses }, null, 2));
  console.log(JSON.stringify({ stats, backup, reportPath }, null, 2));
}

main();
