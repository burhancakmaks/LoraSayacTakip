/**
 * Sayaç durumlarını günceller + Excel'deki OKUNMADI / eksik (-) kayıtlarını ekler
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const REF_DB = join(ROOT, "../LoraSayacTakip-main/LoraSayacTakip-main/data/binalar.db");

const SEARCH_DIRS = ["C:/Users/Surface/Downloads", join(ROOT, "data")];

const MANUAL_5ETAP = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

const COLS_5ETAP = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

const VERIFIED_4ETAP = {
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

function classify(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "eksik";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s)) return "eksik";
  const digits = s.replace(/^2025-/i, "").replace(/\D/g, "");
  if (digits.length >= 6 && digits.length <= 12) return "gecerli";
  return "hatali";
}

function find4EtapFile() {
  const candidates = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.toUpperCase().includes("4.ETAP") && f.toUpperCase().includes("SAY")) {
        candidates.push(join(dir, f));
      }
    }
  }
  return candidates.sort().at(-1) || null;
}

function load4EtapMappings(db) {
  const map = new Map();
  let refDb = null;
  try {
    if (existsSync(REF_DB)) refDb = new DatabaseSync(REF_DB);
  } catch {}
  if (refDb) {
    const rows = refDb
      .prepare(
        `SELECT ada, blok, bina_id FROM excel_abonelikler
         WHERE bina_id IS NOT NULL AND (ada IN ('01','02','03','04','05','06') OR ada='4. Etap')
         GROUP BY ada, blok, bina_id`
      )
      .all();
    for (const r of rows) {
      const adaKey = r.ada === "4. Etap" ? null : String(r.ada).padStart(2, "0");
      const blok = String(r.blok).replace(/\*$/, "");
      if (!db.prepare("SELECT id FROM binalar WHERE id=?").get(r.bina_id)) continue;
      if (adaKey) map.set(`${adaKey}|${blok}`, r.bina_id);
    }
  }
  for (const [k, id] of Object.entries(VERIFIED_4ETAP)) {
    if (db.prepare("SELECT id FROM binalar WHERE id=?").get(id)) map.set(k, id);
  }
  return map;
}

function parse4EtapProblems(path, etapMap) {
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
        const daire = String(row[c] ?? "").trim();
        const raw = String(row[c + 1] ?? "").trim();
        if (!daire) continue;

        let durum = null;
        let sayacId = raw;
        if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(raw)) {
          durum = "okunmadi";
          sayacId = "OKUNMADI";
        } else if (raw === "-" || raw === "---" || /^-+$/.test(raw)) {
          durum = "eksik";
          sayacId = "";
        }
        if (!durum) continue;

        const binaId = etapMap.get(`${ada}|${blok}`);
        if (!binaId) continue;

        records.push({
          binaId,
          ada,
          blok,
          daire,
          sayacId,
          durum,
          kullanilis_sekli: "SOGUK SU",
        });
      }
    }
  }
  return records;
}

function importProblemRows(db, records, stats, label) {
  const findByUnit = db.prepare(`
    SELECT birim_no, sayac_id FROM sayac
    WHERE bina_id = ? AND kapi_no = ? AND blok_no = ?
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, kullanilis_sekli, sayac_id, sayac_durum, updated_at)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(bina_id, birim_no) DO UPDATE SET
      sayac_id = excluded.sayac_id,
      sayac_durum = excluded.sayac_durum,
      blok_no = excluded.blok_no,
      kapi_no = excluded.kapi_no,
      kullanilis_sekli = excluded.kullanilis_sekli,
      updated_at = datetime('now')
  `);
  const nextBirim = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`);

  for (const rec of records) {
    const existing = findByUnit.get(rec.binaId, rec.daire, rec.blok);
    if (existing && classify(existing.sayac_id) === "gecerli") continue;

    const birimNo = existing?.birim_no ?? nextBirim.get(rec.binaId).n;
    insert.run(
      rec.binaId,
      birimNo,
      rec.blok,
      rec.daire,
      rec.kullanilis_sekli,
      rec.sayacId,
      rec.durum
    );
    if (rec.durum === "okunmadi") stats.okunmadi_imported++;
    else if (rec.durum === "eksik") stats.eksik_imported++;
    stats[label] = (stats[label] || 0) + 1;
  }
}

const db = new DatabaseSync(DB_PATH);
try {
  db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`);
} catch {}

const stats = {
  reclassified: 0,
  okunmadi_imported: 0,
  eksik_imported: 0,
  etap4_okunmadi: 0,
  etap4_eksik: 0,
  etap4_unmapped: 0,
  etap4_excel: null,
  counts: { gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 },
};

db.exec("BEGIN IMMEDIATE");
try {
  // 5 ETAP OKUNMADI
  const excel5 = join(ROOT, "data/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx");
  if (existsSync(excel5)) {
    const wb = XLSX.read(readFileSync(excel5), { type: "buffer" });
    const records5 = [];
    for (const sheet of wb.SheetNames) {
      const binaId = MANUAL_5ETAP[sheet];
      if (!binaId) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
      for (let r = 2; r < rows.length; r++) {
        const daire = String(rows[r][0] ?? "").trim();
        if (!daire || daire === "KAPICI") continue;
        for (const col of COLS_5ETAP) {
          const raw = String(rows[r][col.idx] ?? "").trim();
          if (!/OKUNMADI/i.test(raw)) continue;
          records5.push({
            binaId,
            blok: sheet,
            daire,
            sayacId: "OKUNMADI",
            durum: "okunmadi",
            kullanilis_sekli: col.tip,
          });
        }
      }
    }
    importProblemRows(db, records5, stats, "etap5");
  }

  // 4 ETAP OKUNMADI + eksik (-)
  const excel4 = find4EtapFile();
  stats.etap4_excel = excel4;
  if (excel4) {
    const etapMap = load4EtapMappings(db);
    const allProblems = parse4EtapProblems(excel4, etapMap);
    const wb = XLSX.read(readFileSync(excel4), { type: "buffer" });
    let unmapped = 0;
    // count unmapped for report
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
      const adaM = sheetName.match(/ADA-(\d+)/i);
      const ada = adaM ? adaM[1].padStart(2, "0") : "";
      const headerRow = rows[1] || [];
      for (let c = 1; c < headerRow.length; c++) {
        const h = String(headerRow[c] ?? "").trim();
        if (!h || !/^(DB|DC|GB)-/.test(h)) continue;
        const blok = h.replace(/\*$/, "");
        if (!etapMap.has(`${ada}|${blok}`)) unmapped++;
      }
    }
    stats.etap4_unmapped_bloks = unmapped;

    const okunmadi4 = allProblems.filter((r) => r.durum === "okunmadi");
    const eksik4 = allProblems.filter((r) => r.durum === "eksik");
    importProblemRows(db, okunmadi4, stats, "etap4_okunmadi");
    importProblemRows(db, eksik4, stats, "etap4_eksik");
  }

  const rows = db.prepare(`SELECT id, sayac_id FROM sayac`).all();
  const upd = db.prepare(`UPDATE sayac SET sayac_durum = ? WHERE id = ?`);
  stats.counts = { gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 };
  for (const row of rows) {
    const durum = classify(row.sayac_id);
    upd.run(durum, row.id);
    stats.counts[durum]++;
    stats.reclassified++;
  }

  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log("=== SAYAC DURUM SENKRON ===");
console.log(JSON.stringify(stats, null, 2));
