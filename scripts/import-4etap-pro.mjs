import { readdirSync, existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = "c:/Users/Surface/Desktop/LoraLast/LoraSayacTakip";
const DB_PATH = join(ROOT, "data/binalar.db");
const REF_DB = "c:/Users/Surface/Desktop/LoraSayacTakip-main/LoraSayacTakip-main/data/binalar.db";

const SEARCH_DIRS = [
  "C:/Users/Surface/Downloads",
  join(ROOT, "data"),
];

function find4EtapFile() {
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.toUpperCase().includes("4.ETAP") && f.toUpperCase().includes("SAY")) {
        return join(dir, f);
      }
    }
  }
  return null;
}

function normSayac(v) {
  return String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "").padStart(8, "0");
}

function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = s.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 10;
}

function load4EtapMappings(db) {
  const map = new Map();
  let refDb = null;
  try { refDb = new DatabaseSync(REF_DB); } catch {}
  if (refDb) {
    const rows = refDb.prepare(`
      SELECT ada, blok, bina_id FROM excel_abonelikler
      WHERE bina_id IS NOT NULL AND (ada IN ('01','02','03','04','05','06') OR ada='4. Etap')
      GROUP BY ada, blok, bina_id
    `).all();
    for (const r of rows) {
      const adaKey = r.ada === "4. Etap" ? null : String(r.ada).padStart(2, "0");
      const blok = String(r.blok).replace(/\*$/, "");
      const exists = db.prepare("SELECT id FROM binalar WHERE id=?").get(r.bina_id);
      if (!exists) continue;
      if (adaKey) map.set(`${adaKey}|${blok}`, r.bina_id);
    }
  }
  const verified = {
    "01|DB-01": 716, "01|DB-02": 717, "01|DB-03": 713, "01|DB-04": 718,
    "01|DB-05": 1939, "01|DB-06": 2646,
    "01|DC-01": 2642, "01|DC-02": 2642, "01|DC-03": 2614, "01|DC-04": 1763,
    "01|DC-05": 2629, "01|DC-06": 4690, "01|DC-07": 4690,
    "02|DB-07": 2676, "02|DB-08": 1907, "02|DB-09": 2755, "02|DB-10": 2776,
    "02|DB-11": 2689, "02|DB-12": 2673, "02|DC-08": 2669, "02|DC-09": 1127,
    "02|DC-10": 2764, "02|GB-01": 2628, "02|GB-02": 2000,
    "03|DB-13": 2675, "03|DB-14": 1764, "03|DB-15": 1764,
    "03|DC-11": 1940, "03|DC-12": 1940, "03|DC-13": 1654,
    "03|GB-03": 2601, "03|GB-04": 2601, "03|GB-05": 4674,
    "03|GB-06": 1942, "03|GB-07": 1942,
    "04|DB-16": 2767, "04|DB-17": 4692, "04|DB-18": 8, "04|DB-19": 300,
    "04|DB-20": 2777, "04|DB-21": 2602, "04|DC-14": 302, "04|DC-15": 1722,
    "04|DC-16": 1985, "04|DC-17": 2663, "04|DC-18": 2609, "04|DC-19": 1941,
    "05|DB-22": 1752, "05|DB-23": 716, "05|DC-20": 2001, "05|DC-21": 2610,
    "05|DC-22": 2631, "05|GB-08": 4669, "05|GB-09": 1103, "05|GB-10": 2002,
    "06|DB-24": 2772, "06|DB-25": 1998, "06|DB-26": 2685, "06|DB-27": 1999,
    "06|DB-28": 303, "06|DB-29": 2622, "06|DC-23": 1997, "06|DC-24": 4686,
    "06|DC-25": 1753, "06|DC-26": 2604, "06|DC-27": 4677,
    "06|GB-11": 1724, "06|GB-12": 2670, "06|GB-13": 4696, "06|GB-14": 623,
    "06|GB-15": 2606, "06|GB-16": 1714,
  };
  for (const [k, id] of Object.entries(verified)) {
    if (db.prepare("SELECT id FROM binalar WHERE id=?").get(id)) map.set(k, id);
  }
  return map;
}

function parse4Etap(path) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
    const adaM = sheetName.match(/ADA-(\d+)/i);
    const ada = adaM ? adaM[1].padStart(2, "0") : "";
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
        const sayac = row[c + 1];
        if (!isValidSayac(sayac)) continue;
        const daire = String(row[c] ?? "").trim();
        records.push({
          ada, sheet: sheetName, blok,
          daire,
          sayac_no: String(sayac).trim(),
          sayacKey: normSayac(sayac),
          adres: `4. ETAP ADA-${ada} ${blok}`,
        });
      }
    }
  }
  return records;
}

function buildAddress(db, ada, blok, binaId) {
  const b = db.prepare("SELECT value FROM binalar WHERE id=?").get(binaId);
  const name = String(b?.value ?? "").trim() || `Bina ${binaId}`;
  return {
    ada_parsel: `4. ETAP ADA-${ada}`,
    sokak: `MALATYA MERKEZ 4. ETAP ADA-${ada} - ${blok} (${name})`,
    building_name: name,
  };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const excelPath = find4EtapFile();
  if (!excelPath) throw new Error("4.ETAP Excel dosyasi bulunamadi (Downloads veya data klasorune koyun)");

  const db = new DatabaseSync(DB_PATH);
  const etapMap = load4EtapMappings(db);
  const raw = parse4Etap(excelPath);

  const stats = {
    excel_path: excelPath,
    total_parsed: raw.length,
    mapped: 0,
    unmapped: 0,
    inserted: 0,
    removed_old: 0,
    bina_bilgi_created: 0,
    bina_bilgi_updated: 0,
    duplicate_in_excel: 0,
    by_ada: {},
    unmapped_bloks: [],
    addresses: {},
    errors: [],
  };

  const excelByKey = new Map();
  for (const rec of raw) {
    const binaId = etapMap.get(`${rec.ada}|${rec.blok}`);
    if (!binaId) {
      stats.unmapped++;
      if (!stats.unmapped_bloks.includes(`${rec.ada}|${rec.blok}`)) {
        stats.unmapped_bloks.push(`${rec.ada}|${rec.blok}`);
      }
      continue;
    }
    rec.binaId = binaId;
    stats.mapped++;
    stats.by_ada[rec.ada] = (stats.by_ada[rec.ada] || 0) + 1;
    if (excelByKey.has(rec.sayacKey)) {
      stats.duplicate_in_excel++;
      stats.errors.push(`Cift sayac: ${rec.sayac_no} ${excelByKey.get(rec.sayacKey).blok} vs ${rec.blok}`);
    }
    excelByKey.set(rec.sayacKey, rec);
    const addrKey = `${rec.ada}|${rec.blok}`;
    if (!stats.addresses[addrKey]) stats.addresses[addrKey] = buildAddress(db, rec.ada, rec.blok, binaId);
  }

  if (dryRun) {
    console.log(JSON.stringify({ stats, map_size: etapMap.size, sample: [...excelByKey.values()].slice(0, 5) }, null, 2));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-4etap-pro-${stamp}.db`);
  copyFileSync(DB_PATH, backup);

  db.exec("BEGIN IMMEDIATE");
  try {
    // Eski 4.ETAP import (DB-01 formati) temizle
    const old = db.prepare(`SELECT id FROM sayac WHERE blok_no GLOB 'D[B]-*' OR blok_no GLOB 'G[B]-*' OR blok_no GLOB 'DC-*'`).all();
    if (old.length) {
      const ids = old.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        db.prepare(`DELETE FROM sayac WHERE id IN (${chunk.map(() => "?").join(",")})`).run(...chunk);
      }
      stats.removed_old = old.length;
    }

    const keys = [...excelByKey.keys()];
    // Sadece onceki 4.ETAP import kayitlarini sil (5. ETAP GB1/DB5 formatina dokunma)
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      db.prepare(`
        DELETE FROM sayac WHERE (blok_no GLOB 'D[B]-*' OR blok_no GLOB 'G[B]-*' OR blok_no GLOB 'DC-*')
          AND REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','') IN (${chunk.map(() => "?").join(",")})
      `).run(...chunk);
    }

    const byBina = new Map();
    for (const rec of excelByKey.values()) {
      if (!byBina.has(rec.binaId)) byBina.set(rec.binaId, []);
      byBina.get(rec.binaId).push(rec);
    }

    const insertSayac = db.prepare(`
      INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
        sayac_markasi, sayac_id, sicil_no, abone_no, updated_at)
      VALUES (?, ?, ?, '', ?, 'YOK', 'SOGUK SU', '', ?, '', '', datetime('now'))
    `);

    for (const [binaId, items] of byBina) {
      const sample = items[0];
      const addr = buildAddress(db, sample.ada, sample.blok, binaId);
      const info = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id=?").get(binaId);
      if (!info) {
        db.prepare(`
          INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
            has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
          VALUES (?, 0, ?, 0, ?, 0, ?, ?, '', datetime('now'))
        `).run(binaId, items.length, items.length, addr.ada_parsel, addr.sokak);
        stats.bina_bilgi_created++;
      } else {
        db.prepare(`
          UPDATE bina_bilgi SET ada_parsel=?, sokak=?,
            daire_sayisi=CASE WHEN COALESCE(daire_sayisi,0)< ? THEN ? ELSE daire_sayisi END,
            toplam_bagımsız_bolum=CASE WHEN COALESCE(toplam_bagımsız_bolum,0)< ? THEN ? ELSE toplam_bagımsız_bolum END,
            updated_at=datetime('now') WHERE bina_id=?
        `).run(addr.ada_parsel, addr.sokak, items.length, items.length, items.length, items.length, binaId);
        stats.bina_bilgi_updated++;
      }

      let nextUnit = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`).get(binaId).n || 1;
      const existsStmt = db.prepare(`
        SELECT id, blok_no FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''
          AND REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','') = REPLACE(?, ' ', '')
        LIMIT 1
      `);
      for (const item of items) {
        const existing = existsStmt.get(item.sayacKey);
        if (existing) {
          // 5. ETAP veya baska kaynakta varsa dokunma
          if (!/^(DB|GB|DC)-/.test(existing.blok_no || "")) continue;
          db.prepare(`UPDATE sayac SET bina_id=?, birim_no=?, blok_no=?, kapi_no=?, updated_at=datetime('now') WHERE id=?`)
            .run(binaId, nextUnit++, item.blok, item.daire, existing.id);
          stats.inserted++;
          continue;
        }
        insertSayac.run(binaId, nextUnit++, item.blok, item.daire, item.sayac_no);
        stats.inserted++;
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const reportPath = join(ROOT, `data/4etap-import-report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ stats, backup }, null, 2));
  console.log(JSON.stringify({ stats, backup, reportPath }, null, 2));
}

main();
