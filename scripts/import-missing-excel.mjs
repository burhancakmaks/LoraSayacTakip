/**
 * Import ONLY missing Excel records into binalar.db
 * - Creates timestamped backup before changes
 * - Never updates/deletes existing sayac rows
 * - Only increases bina_bilgi capacity when needed
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, copyFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const ROOT = "c:/Users/Surface/Desktop/LoraLast/LoraSayacTakip";
const DB_PATH = join(ROOT, "data/binalar.db");
const DOWNLOADS = "C:/Users/Surface/Downloads";
const REF_DB = "c:/Users/Surface/Desktop/LoraSayacTakip-main/LoraSayacTakip-main/data/binalar.db";

// --- helpers ---
function norm(s) {
  return String(s ?? "")
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

function normSayac(v) {
  const digits = String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
  return digits.padStart(8, "0");
}

function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || s === "---") return false;
  if (/SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = s.replace(/\D/g, "");
  return d.length >= 7 && d.length <= 10;
}

function parseAddress(adres) {
  let sokak = "";
  let dis_kapi_no = "";
  const m = String(adres || "").match(/(?:NO|NO:)\s*([0-9]+)/i);
  if (m) dis_kapi_no = m[1];
  const sm = String(adres || "").match(/(.+?(?:SOKAK|SOKAĞI|CADDE|CADDESİ|BULVAR))/i);
  if (sm) sokak = sm[1].trim();
  return { sokak, dis_kapi_no };
}

// --- bina_id mappings for LoraLast DB (verified polygons) ---
const BLOCK_TARGETS = {
  "49 ADA": {
    "A BLOK": [1945],
    "B BLOK": [1751, 1946],
    "C BLOK": [1750, 1947],
    "D BLOK": [1724, 1948],
    "E BLOK": [1753, 1949],
    "F BLOK": [1752, 1950],
    "G BLOK": [1951],
    "H BLOK": [1952],
    "I BLOK": [2001],
    "J BLOK": [2002],
    "K BLOK": [2003],
    "L BLOK": [2004],
    "M BLOK": [2005],
  },
  "37-50 A-B": {
    A: [1722, 1954],
    B: [1732, 1955],
  },
  "37-50 E": {
    "E BLOK": [1736, 1910],
  },
  "46 ADA": {
    _all: [1939], // D BLOK building - WC/çay ocağı rows
  },
  SIRE: {
    _all: [1937], // ortak alan depoları
  },
};

// Load 4.ETAP mappings from reference DB (ada 01-06 + blok -> bina_id)
function load4EtapMappings(db, refDb) {
  const map = new Map();
  if (!refDb) return map;
  const rows = refDb
    .prepare(
      `SELECT ada, blok, bina_id FROM excel_abonelikler 
       WHERE bina_id IS NOT NULL AND (ada IN ('01','02','03','04','05','06') OR ada='4. Etap')
       GROUP BY ada, blok, bina_id`
    )
    .all();
  for (const r of rows) {
    const adaKey = r.ada === "4. Etap" ? null : r.ada.padStart(2, "0");
    const blok = r.blok.replace(/\*$/, "");
    const exists = db.prepare("SELECT id FROM binalar WHERE id=?").get(r.bina_id);
    if (!exists) continue;
    if (adaKey) map.set(`${adaKey}|${blok}`, r.bina_id);
    else {
      // 4. Etap generic - map DB-0X to ada 01 for fallback
      const num = blok.match(/(\d+)/);
      if (num) map.set(`01|${blok}`, r.bina_id);
    }
  }
  // Hardcoded verified mappings from ref DB that exist in LoraLast
  const verified = {
    "01|DB-01": 716, "01|DB-02": 717, "01|DB-03": 713, "01|DB-04": 718,
    "01|DB-05": 1939, "01|DB-06": 2646,
    "01|DC-01": 2642, "01|DC-03": 2614, "01|DC-04": 1763, "01|DC-05": 2629, "01|DC-06": 4690,
    "02|DB-07": 2676, "02|DB-08": 1907, "02|DB-09": 2755, "02|DB-10": 2776,
    "02|DB-11": 2689, "02|DB-12": 2673, "02|DC-08": 2669, "02|DC-09": 1127,
    "02|DC-10": 2764, "02|GB-01": 2628, "02|GB-02": 2000,
    "03|DB-13": 2675, "03|DB-14": 1764, "03|DC-12": 1940, "03|DC-13": 1654,
    "03|GB-04": 2601, "03|GB-05": 4674, "03|GB-07": 1942,
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
    const exists = db.prepare("SELECT id FROM binalar WHERE id=?").get(id);
    if (exists) map.set(k, id);
  }
  // Fallback for blocks whose MASKI approx buildings don't exist in LoraLast
  const fallbacks = {
    "01|DC-02": "01|DC-01",
    "01|DC-07": "01|DC-06",
    "03|DB-15": "03|DB-14",
    "03|DC-11": "03|DC-12",
    "03|GB-03": "03|GB-04",
    "03|GB-06": "03|GB-07",
  };
  for (const [from, to] of Object.entries(fallbacks)) {
    if (!map.has(from) && map.has(to)) map.set(from, map.get(to));
  }
  return map;
}

function resolveTargets(fileKey, record, etapMap) {
  if (fileKey === "4.ETAP") {
    const sheet = record.sheet || "";
    const adaM = sheet.match(/ADA-(\d+)/i);
    const ada = adaM ? adaM[1].padStart(2, "0") : "";
    const blok = String(record.blok || record.db_col || "").replace(/\*$/, "");
    const id = etapMap.get(`${ada}|${blok}`);
    return id ? [id] : [];
  }
  if (fileKey === "46 ADA" || fileKey === "SIRE") {
    return BLOCK_TARGETS[fileKey]._all;
  }
  const blok = norm(record.blok);
  const map = BLOCK_TARGETS[fileKey];
  if (!map) return [];
  // exact match
  for (const [k, ids] of Object.entries(map)) {
    if (norm(k) === blok) return ids;
  }
  // 37-50 A-B uses A/B without BLOK
  if (fileKey === "37-50 A-B") {
    const short = blok.replace(" BLOK", "");
    if (map[short]) return map[short];
    if (map[blok]) return map[blok];
  }
  return [];
}

// --- Excel parsers (return flat record list) ---
function parseFromGapJson() {
  const gap = JSON.parse(readFileSync(join(ROOT, "excel-gap-final.json"), "utf8"));
  const records = [];
  for (const [fileKey, data] of Object.entries(gap.dosyalar)) {
    for (const r of data.eksik_kayitlar || []) {
      records.push({ ...r, fileKey });
    }
  }
  return records;
}

function parse4EtapExtra(wb) {
  const out = [];
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
        const daire = row[c];
        out.push({
          fileKey: "4.ETAP",
          sheet: sheetName,
          ada: `4.ETAP-${ada}`,
          blok,
          db_col: blok,
          kat: "",
          daire_kapi: String(daire ?? ""),
          nitelik: "",
          sayac_no: String(sayac).trim(),
          abone_no: "",
          adres: `4. ETAP ADA-${ada} ${blok}`,
        });
      }
    }
  }
  return out;
}

// --- main import ---
function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = new DatabaseSync(DB_PATH);
  let refDb = null;
  try {
    refDb = new DatabaseSync(REF_DB);
  } catch {
    console.warn("Reference DB not found, using hardcoded 4.ETAP mappings only");
  }

  const etapMap = load4EtapMappings(db, refDb);
  const existingSayac = new Set(
    db.prepare("SELECT sayac_id FROM sayac WHERE TRIM(sayac_id)!=''").all().map((r) => normSayac(r.sayac_id))
  );

  let records = parseFromGapJson();

  // Re-parse 4.ETAP with correct column headers (gap json used simplified parser)
  const etapFile = readdirSyncSafe().find((f) => f.includes("4.ETAP"));
  if (etapFile) {
    const wb = XLSX.read(readFileSync(join(DOWNLOADS, etapFile)), { type: "buffer" });
    const etapRecords = parse4EtapExtra(wb);
    const nonEtap = records.filter((r) => r.fileKey !== "4.ETAP");
    const etapMissing = etapRecords.filter((r) => !existingSayac.has(normSayac(r.sayac_no)));
    records = [...nonEtap, ...etapMissing];
  }

  const stats = {
    to_process: 0,
    skipped_exists: 0,
    skipped_no_target: 0,
    inserted: 0,
    bina_bilgi_created: 0,
    bina_bilgi_expanded: 0,
    errors: [],
    by_file: {},
  };

  // Group by target bina_id for bina_bilgi sizing
  const byBina = new Map();
  const pending = [];

  for (const rec of records) {
    const sayacKey = normSayac(rec.sayac_no);
    if (!sayacKey || existingSayac.has(sayacKey)) {
      stats.skipped_exists++;
      continue;
    }
    const targets = resolveTargets(rec.fileKey, rec, etapMap);
    if (!targets.length) {
      stats.skipped_no_target++;
      stats.errors.push({ file: rec.fileKey, blok: rec.blok, sayac: rec.sayac_no, reason: "no_bina_target" });
      continue;
    }
    stats.to_process++;
    stats.by_file[rec.fileKey] = (stats.by_file[rec.fileKey] || 0) + 1;
    for (const binaId of targets) {
      if (!byBina.has(binaId)) byBina.set(binaId, []);
      byBina.get(binaId).push({ ...rec, binaId });
    }
    pending.push({ rec, targets, sayacKey });
  }

  if (dryRun) {
    console.log(JSON.stringify({ stats, etap_map_size: etapMap.size, bina_groups: byBina.size }, null, 2));
    if (stats.errors.length) console.log("Sample errors:", stats.errors.slice(0, 10));
    return;
  }

  // Backup
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-import-${stamp}.db`);
  copyFileSync(DB_PATH, backup);
  console.log("Backup:", backup);

  db.exec("BEGIN IMMEDIATE");
  try {
    const insertSayac = db.prepare(`
      INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
        sayac_markasi, sayac_id, sicil_no, abone_no, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, '', ?, '', ?, datetime('now')
      WHERE NOT EXISTS (
        SELECT 1 FROM sayac WHERE TRIM(sayac_id)!='' AND 
        REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','') = REPLACE(?, ' ', '')
      )
    `);

    for (const [binaId, items] of byBina) {
      // Unique sayacs for this bina (dedupe across duplicate targets)
      const uniqueItems = [];
      const seen = new Set();
      for (const item of items) {
        const k = normSayac(item.sayac_no);
        if (seen.has(k)) continue;
        seen.add(k);
        uniqueItems.push(item);
      }

      let info = db.prepare("SELECT * FROM bina_bilgi WHERE bina_id=?").get(binaId);
      const needed = uniqueItems.length;
      const currentSayac = db.prepare("SELECT COUNT(*) c FROM sayac WHERE bina_id=?").get(binaId).c;
      const totalNeeded = currentSayac + needed;

      const sample = uniqueItems[0];
      const { sokak, dis_kapi_no } = parseAddress(sample.adres);
      const ada_parsel = sample.ada?.replace("4.ETAP-", "") || sample.ada || "";

      if (!info) {
        db.prepare(`
          INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
            has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
          VALUES (?, 0, ?, 0, ?, 0, ?, ?, ?, datetime('now'))
        `).run(binaId, needed, needed, ada_parsel, sokak, dis_kapi_no);
        stats.bina_bilgi_created++;
        info = { toplam_bagımsız_bolum: needed };
      } else if (info.toplam_bagımsız_bolum < totalNeeded) {
        const add = totalNeeded - info.toplam_bagımsız_bolum;
        db.prepare(`
          UPDATE bina_bilgi SET daire_sayisi = daire_sayisi + ?,
            toplam_bagımsız_bolum = toplam_bagımsız_bolum + ?,
            ada_parsel = CASE WHEN COALESCE(ada_parsel,'')='' THEN ? ELSE ada_parsel END,
            sokak = CASE WHEN COALESCE(sokak,'')='' THEN ? ELSE sokak END,
            dis_kapi_no = CASE WHEN COALESCE(dis_kapi_no,'')='' THEN ? ELSE dis_kapi_no END,
            updated_at = datetime('now')
          WHERE bina_id = ?
        `).run(add, add, ada_parsel, sokak, dis_kapi_no, binaId);
        stats.bina_bilgi_expanded++;
      }

      let nextUnit =
        db.prepare("SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?").get(binaId).n || 1;

      for (const item of uniqueItems) {
        const kullanim = item.nitelik || "DAİRE";
        const sayacNorm = normSayac(item.sayac_no);
        const result = insertSayac.run(
          binaId,
          nextUnit,
          item.blok || "",
          item.kat || "",
          item.daire_kapi || "",
          "YOK",
          kullanim,
          String(item.sayac_no).trim(),
          String(item.abone_no || ""),
          sayacNorm
        );
        if (result.changes > 0) {
          stats.inserted++;
          existingSayac.add(sayacNorm);
          nextUnit++;
        }
      }
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  writeFileSync(join(ROOT, "import-result.json"), JSON.stringify({ stats, backup }, null, 2));
  console.log(JSON.stringify(stats, null, 2));
}

function readdirSyncSafe() {
  return readdirSync(DOWNLOADS);
}

main();
