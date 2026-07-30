/**
 * Import 5. ETAP sayaç Excel into binalar.db
 * - Parses GB/DB/DC sheets (sicak su, kalorimetre, soguk su, kazan sayaclari)
 * - Maps sheet names to bina_id via building name (G05, D05, C07, ...)
 * - Creates backup before write; never duplicates existing sayac_id
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
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

// KML'de G03/G04/C11 vb. yok; yakin poligonlara manuel esleme
const MANUAL_SHEET_OVERRIDES = {
  GB3: 1790, // C (G1/G2 kompleksi)
  GB4: 1804, // D
  GB6: 1800, // F
  GB7: 1795, // H
  DC11: 1099, // D12
  DC12: 1068, // E04
  DC13: 1100, // B03
  DC14: 1066, // F04
  DC15: 1089, // D13
};

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

function pickCanonical(db, name) {
  const hits = db
    .prepare(`SELECT id, value, oda_id, kml_id FROM binalar WHERE UPPER(TRIM(value)) = ?`)
    .all(name.toUpperCase());
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const bad = (x) => (x.kml_id === 1542 || x.kml_id === 1545 || x.kml_id === 1546) ? 1 : 0;
    if (bad(a) !== bad(b)) return bad(a) - bad(b);
    return (b.oda_id || 0) - (a.oda_id || 0);
  });
  return hits[0];
}

function buildSheetMapping(db) {
  const mapping = {};
  for (const [prefix, max, letter] of [
    ["GB", 7, "G"],
    ["DB", 11, "D"],
    ["DC", 15, "C"],
  ]) {
    for (let n = 1; n <= max; n++) {
      const sheet = `${prefix}${n}`;
      const targets = [`${letter}${String(n).padStart(2, "0")}`, `${letter}${n}`, sheet];
      for (const t of targets) {
        const b = pickCanonical(db, t);
        if (b) {
          mapping[sheet] = b.id;
          break;
        }
      }
    }
  }
  for (const [sheet, binaId] of Object.entries(MANUAL_SHEET_OVERRIDES)) {
    mapping[sheet] = binaId;
  }
  return mapping;
}

function parseExcel(path) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < rows.length; r++) {
      const row = rows[r];
      const daire = String(row[0] ?? "").trim();
      if (!daire) continue;
      for (const col of COLS) {
        const sayac = row[col.idx];
        if (!isValidSayac(sayac)) continue;
        records.push({
          sheet,
          daire,
          tip: col.tip,
          sayac_no: String(sayac).trim(),
        });
      }
    }
  }
  return records;
}

function resolveExcelPath() {
  for (const p of EXCEL_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error("5. ETAP Excel dosyasi bulunamadi");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const excelPath = resolveExcelPath();
  const db = new DatabaseSync(DB_PATH);
  const sheetToBina = buildSheetMapping(db);

  const existingSayac = new Set(
    db.prepare(`SELECT sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''`).all().map((r) => normSayac(r.sayac_id))
  );

  const records = parseExcel(excelPath);
  const stats = {
    excel_path: excelPath,
    total_parsed: records.length,
    mapped_sheets: Object.keys(sheetToBina).length,
    to_insert: 0,
    skipped_exists: 0,
    skipped_no_target: 0,
    inserted: 0,
    bina_bilgi_created: 0,
    bina_bilgi_expanded: 0,
    by_sheet: {},
    unmapped_sheets: [],
    errors: [],
  };

  const byBina = new Map();

  for (const rec of records) {
    const binaId = sheetToBina[rec.sheet];
    if (!binaId) {
      stats.skipped_no_target++;
      if (!stats.unmapped_sheets.includes(rec.sheet)) stats.unmapped_sheets.push(rec.sheet);
      continue;
    }
    const sayacKey = normSayac(rec.sayac_no);
    if (!sayacKey || existingSayac.has(sayacKey)) {
      stats.skipped_exists++;
      continue;
    }
    stats.to_insert++;
    stats.by_sheet[rec.sheet] = (stats.by_sheet[rec.sheet] || 0) + 1;
    if (!byBina.has(binaId)) byBina.set(binaId, []);
    byBina.get(binaId).push({ ...rec, binaId, sayacKey });
  }

  stats.unmapped_sheets.sort();

  if (dryRun) {
    console.log(JSON.stringify({ stats, sheet_mapping: sheetToBina }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-5etap-import-${stamp}.db`);
  copyFileSync(DB_PATH, backup);
  console.log("Backup:", backup);

  db.exec("BEGIN IMMEDIATE");
  try {
    const insertSayac = db.prepare(`
      INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
        sayac_markasi, sayac_id, sicil_no, abone_no, updated_at)
      SELECT ?, ?, ?, '', ?, 'YOK', ?, '', ?, '', '', datetime('now')
      WHERE NOT EXISTS (
        SELECT 1 FROM sayac WHERE TRIM(sayac_id)!='' AND
        REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','') = REPLACE(?, ' ', '')
      )
    `);

    for (const [binaId, items] of byBina) {
      const uniqueItems = [];
      const seen = new Set();
      for (const item of items) {
        if (seen.has(item.sayacKey)) continue;
        seen.add(item.sayacKey);
        uniqueItems.push(item);
      }

      const currentSayac = db.prepare(`SELECT COUNT(*) c FROM sayac WHERE bina_id=?`).get(binaId).c;
      const needed = uniqueItems.length;
      const totalNeeded = currentSayac + needed;

      let info = db.prepare(`SELECT * FROM bina_bilgi WHERE bina_id=?`).get(binaId);
      const sampleSheet = uniqueItems[0]?.sheet || "";
      const ada_parsel = "5. ETAP";
      const sokak = `5. ETAP ${sampleSheet}`;

      if (!info) {
        db.prepare(`
          INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
            has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
          VALUES (?, 0, ?, 0, ?, 0, ?, ?, '', datetime('now'))
        `).run(binaId, needed, needed, ada_parsel, sokak);
        stats.bina_bilgi_created++;
      } else if (info.toplam_bagımsız_bolum < totalNeeded) {
        const add = totalNeeded - info.toplam_bagımsız_bolum;
        db.prepare(`
          UPDATE bina_bilgi SET daire_sayisi = daire_sayisi + ?,
            toplam_bagımsız_bolum = toplam_bagımsız_bolum + ?,
            ada_parsel = CASE WHEN COALESCE(ada_parsel,'')='' THEN ? ELSE ada_parsel END,
            sokak = CASE WHEN COALESCE(sokak,'')='' THEN ? ELSE sokak END,
            updated_at = datetime('now')
          WHERE bina_id = ?
        `).run(add, add, ada_parsel, sokak, binaId);
        stats.bina_bilgi_expanded++;
      }

      let nextUnit = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`).get(binaId).n || 1;

      for (const item of uniqueItems) {
        const result = insertSayac.run(
          binaId,
          nextUnit,
          item.sheet,
          item.daire,
          item.tip,
          String(item.sayac_no).trim(),
          item.sayacKey
        );
        if (result.changes > 0) {
          stats.inserted++;
          existingSayac.add(item.sayacKey);
          nextUnit++;
        }
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  console.log(JSON.stringify({ stats, backup }, null, 2));
}

main();
