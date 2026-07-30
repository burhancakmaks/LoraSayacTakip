import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(ROOT, "data/binalar.db"));

// ── 1. Yeşil (bina_bilgi) kontrolü ──
const greenCheck = db.prepare(`
  SELECT
    SUM(CASE WHEN bb.bina_id IS NOT NULL THEN 1 ELSE 0 END) as yesil,
    SUM(CASE WHEN bb.bina_id IS NULL THEN 1 ELSE 0 END) as mavi
  FROM (
    SELECT DISTINCT bina_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''
  ) s
  LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
`).get();

const etapGreen = db.prepare(`
  SELECT
    CASE
      WHEN bb.ada_parsel LIKE '5. ETAP%' THEN '5. ETAP'
      WHEN bb.ada_parsel LIKE '4. ETAP%' THEN '4. ETAP'
      ELSE 'diger'
    END as etap,
    COUNT(DISTINCT s.bina_id) as bina,
    SUM(CASE WHEN bb.bina_id IS NOT NULL THEN 1 ELSE 0 END) as yesil,
    SUM(CASE WHEN bb.bina_id IS NULL THEN 1 ELSE 0 END) as mavi
  FROM sayac s
  LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
  WHERE TRIM(COALESCE(s.sayac_id,'')) != ''
  GROUP BY etap
`).all();

const maviSayacli = db.prepare(`
  SELECT b.id, b.value, COUNT(s.id) as sc
  FROM sayac s JOIN binalar b ON b.id=s.bina_id
  LEFT JOIN bina_bilgi bb ON bb.bina_id=s.bina_id
  WHERE TRIM(COALESCE(s.sayac_id,'')) != '' AND bb.bina_id IS NULL
  GROUP BY b.id ORDER BY sc DESC LIMIT 10
`).all();

// ── 2. Overlay kopya poligon ──
function centroid(j) {
  const c = JSON.parse(j);
  let la = 0, ln = 0, n = 0;
  for (const p of c) for (const [a, b] of p) la += a, ln += b, n++;
  return n ? [la / n, ln / n] : null;
}
function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * 111000;
}
const all = db.prepare(`SELECT id, value, coordinates FROM binalar`).all().map((b) => ({
  ...b,
  name: String(b.value ?? "").trim().toUpperCase(),
  c: centroid(b.coordinates),
  cfg: !!db.prepare(`SELECT 1 FROM bina_bilgi WHERE bina_id=?`).get(b.id),
  sc: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE bina_id=? AND TRIM(COALESCE(sayac_id,''))!=''`).get(b.id).c,
}));
const overlays = [];
for (const b of all) {
  if (!b.c || b.cfg || b.sc > 0) continue;
  if (!b.name) continue;
  const sibling = all.find(
    (o) => o.id !== b.id && o.name === b.name && o.c && (o.cfg || o.sc > 0) && dist(b.c, o.c) < 80
  );
  if (sibling) overlays.push({ empty_id: b.id, empty_name: b.value, configured_id: sibling.id, configured_name: sibling.value, sc: sibling.sc });
}

// ── 3. 5. ETAP doğrulama (özet) ──
const excel5 = join(ROOT, "data/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx");
let etap5 = { ok: false, msg: "Excel bulunamadi" };
if (existsSync(excel5)) {
  const wb = XLSX.read(readFileSync(excel5), { type: "buffer" });
  const SHEETS = [];
  for (const p of ["GB", "DB", "DC"]) {
    const max = p === "GB" ? 7 : p === "DB" ? 11 : 15;
    for (let i = 1; i <= max; i++) SHEETS.push(`${p}${i}`);
  }
  const MANUAL = {
    GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
    DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
    DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
    DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
    DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
    DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
  };
  const norm = (v) => String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "").padStart(8, "0");
  const isValid = (v) => {
    const s = String(v ?? "").trim();
    if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
    return s.replace(/\D/g, "").length >= 6;
  };
  const COLS = [1, 2, 3, 4, 5];
  const dbMap = new Map();
  for (const r of db.prepare(`SELECT s.sayac_id,s.blok_no,s.bina_id,b.value FROM sayac s JOIN binalar b ON b.id=s.bina_id WHERE TRIM(s.sayac_id)!=''`).all()) {
    dbMap.set(norm(r.sayac_id), r);
  }
  let total = 0, ok = 0, missing = 0, wrongBina = 0;
  const wrongSamples = [];
  for (const sheet of SHEETS) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < rows.length; r++) {
      const daire = String(rows[r][0] ?? "").trim();
      if (!daire || daire === "KAPICI") continue;
      for (const ci of COLS) {
        const raw = rows[r][ci];
        if (!isValid(raw)) continue;
        total++;
        const row = dbMap.get(norm(raw));
        if (!row) { missing++; continue; }
        if (row.bina_id !== MANUAL[sheet]) {
          wrongBina++;
          if (wrongSamples.length < 5) wrongSamples.push({ sayac: raw, sheet, bina: `${row.bina_id}(${row.value})` });
        } else ok++;
      }
    }
  }
  etap5 = { total, ok, missing, wrongBina, pct: ((ok / total) * 100).toFixed(1), wrongSamples };
}

// ── 4. ETAP doğrulama ──
function find4Etap() {
  for (const dir of ["C:/Users/Surface/Downloads", join(ROOT, "data")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (f.toUpperCase().includes("4.ETAP") && f.toUpperCase().includes("SAY")) return join(dir, f);
    }
  }
  return null;
}
const VERIFIED_4 = {
  "01|DB-01": 716, "01|DB-02": 717, "01|DB-03": 713, "01|DB-04": 718,
  "01|DB-05": 1939, "01|DB-06": 2646, "01|DC-01": 2642, "01|DC-02": 2642,
  "01|DC-03": 2614, "01|DC-04": 1763, "01|DC-05": 2629, "01|DC-06": 4690,
  "01|DC-07": 4690, "02|DB-07": 2676, "02|DB-08": 1907, "02|DB-09": 2755,
  "02|DB-10": 2776, "02|DB-11": 2689, "02|DB-12": 2673, "02|DC-08": 2669,
  "02|DC-09": 1127, "02|DC-10": 2764, "02|GB-01": 2628, "02|GB-02": 2000,
  "03|DB-13": 2675, "03|DB-14": 1764, "03|DB-15": 1764, "03|DC-11": 1940,
  "03|DC-12": 1940, "03|DC-13": 1654, "03|GB-03": 2601, "03|GB-04": 2601,
  "03|GB-05": 4674, "03|GB-06": 1942, "03|GB-07": 1942, "04|DB-16": 2767,
  "04|DB-17": 4692, "04|DB-18": 8, "04|DB-19": 300, "04|DB-20": 2777,
  "04|DB-21": 2602, "04|DC-14": 302, "04|DC-15": 1722, "04|DC-16": 1985,
  "04|DC-17": 2663, "04|DC-18": 2609, "04|DC-19": 1941, "05|DB-22": 1752,
  "05|DB-23": 716, "05|DC-20": 2001, "05|DC-21": 2610, "05|DC-22": 2631,
  "05|GB-08": 4669, "05|GB-09": 1103, "05|GB-10": 2002, "06|DB-24": 2772,
  "06|DB-25": 1998, "06|DB-26": 2685, "06|DB-27": 1999, "06|DB-28": 303,
  "06|DB-29": 2622, "06|DC-23": 1997, "06|DC-24": 4686, "06|DC-25": 1753,
  "06|DC-26": 2604, "06|DC-27": 4677, "06|GB-11": 1724, "06|GB-12": 2670,
  "06|GB-13": 4696, "06|GB-14": 623, "06|GB-15": 2606, "06|GB-16": 1714,
};
const norm4 = (v) => String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "").padStart(8, "0");
const isValid4 = (v) => {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = s.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 10;
};
let etap4 = { ok: false, msg: "Excel bulunamadi" };
const excel4 = find4Etap();
if (excel4) {
  const wb = XLSX.read(readFileSync(excel4), { type: "buffer" });
  const dbMap = new Map();
  for (const r of db.prepare(`SELECT s.sayac_id,s.blok_no,s.bina_id,b.value FROM sayac s JOIN binalar b ON b.id=s.bina_id WHERE TRIM(s.sayac_id)!=''`).all()) {
    dbMap.set(norm4(r.sayac_id), r);
  }
  let total = 0, ok = 0, missing = 0, wrongBlok = 0, wrongBina = 0;
  const wrongSamples = [];
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
        if (!isValid4(sayac)) continue;
        total++;
        const key = norm4(sayac);
        const dbRow = dbMap.get(key);
        const expectBina = VERIFIED_4[`${ada}|${blok}`];
        if (!dbRow) { missing++; continue; }
        let bad = false;
        if (dbRow.blok_no !== blok) { wrongBlok++; bad = true; }
        if (expectBina && dbRow.bina_id !== expectBina) { wrongBina++; bad = true; }
        if (!bad) ok++;
        else if (wrongSamples.length < 5) wrongSamples.push({ sayac, blok, ada, db_blok: dbRow.blok_no, bina: `${dbRow.bina_id}(${dbRow.value})`, expect: expectBina });
      }
    }
  }
  etap4 = { excel: excel4, total, ok, missing, wrongBlok, wrongBina, pct: ((ok / total) * 100).toFixed(1), wrongSamples };
}

// ── 5. Çift sayaç (aynı no iki binada) ──
const dupes = db.prepare(`
  SELECT sayac_id, COUNT(DISTINCT bina_id) as bina_cnt, GROUP_CONCAT(DISTINCT bina_id) as binalar
  FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''
  GROUP BY REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ','')
  HAVING bina_cnt > 1
  LIMIT 10
`).all();

// ── 6. 5 ETAP bina_bilgi yeşil mi ──
const etap5Bina = db.prepare(`
  SELECT b.id, b.value, bb.ada_parsel, COUNT(s.id) as sc,
    CASE WHEN bb.bina_id IS NOT NULL THEN 1 ELSE 0 END as yesil
  FROM binalar b
  LEFT JOIN bina_bilgi bb ON bb.bina_id=b.id
  LEFT JOIN sayac s ON s.bina_id=b.id AND TRIM(COALESCE(s.sayac_id,''))!=''
  WHERE bb.ada_parsel LIKE '5. ETAP%' OR b.id IN (1788,1787,1790,1804,1075,1800,1795,552,58,545,59,1064,1071,1065,57,1090,47,1098,1265,1268,558,1271,1193,1263,1070,1094,159,1079,1099,1068,1100,1066,1089)
  GROUP BY b.id
`).all();
const etap5NotGreen = etap5Bina.filter((b) => !b.yesil && b.sc > 0);

console.log(JSON.stringify({
  ozet: {
    sayacli_bina_toplam: greenCheck.yesil + greenCheck.mavi,
    hepsi_yesil: greenCheck.mavi === 0,
    mavi_kalan: greenCheck.mavi,
    overlay_kopya_poligon: overlays.length,
  },
  etap_yesil: etapGreen,
  mavi_sayacli_ornekler: maviSayacli,
  etap5_dogrulama: etap5,
  etap4_dogrulama: etap4,
  cift_sayac_no: dupes,
  overlay_ornekler: overlays.slice(0, 8),
  etap5_yesil_olmayan: etap5NotGreen,
}, null, 2));
