/**
 * Tüm Excel kaynaklarındaki okunan (geçerli) + sorunlu sayaçları otomatik aktarır.
 * Dosya değişmediyse atlar ( --force ile zorla ).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const STATE_PATH = join(ROOT, "data/sync-state.json");
const SEARCH_DIRS = ["C:/Users/Surface/Downloads", join(ROOT, "data")];

const FILE_KEYS = ["etap5", "etap4", "ada49", "ada3750ab", "ada3750e", "ada41134", "ada46", "ada51", "ada53", "sire"];

/** Kullanıcının belirttiği güncel Excel dosyaları (varsa öncelikli kullanılır) */
const EXPLICIT_FILES = {
  etap5: "C:/Users/Surface/Downloads/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx",
  etap4: "C:/Users/Surface/Downloads/4.ETAP TS SAYAÇ NO (3).xlsx",
  ada49: "C:/Users/Surface/Downloads/49 ADA 301 ADET  MASKİ ABONELİK (4).xlsx",
  ada3750ab: "C:/Users/Surface/Downloads/37-50 ADA A-B BLOK 344 ADETMASKİ ABONELİK (2).xlsx",
  ada3750e: "C:/Users/Surface/Downloads/37-50 ADA E BLOK 72 ADET MASKİ ABONELİK (5).XLS",
  ada41134: "C:/Users/Surface/Downloads/41-134   341 ADET  maski abonelik (2).xlsx",
  ada46: "C:/Users/Surface/Downloads/46 ADA KONUT MASKİ ABONELERİ (2).xlsx",
  ada51: "C:/Users/Surface/Downloads/51 ADA MASKİ ABONELİK.xlsx",
  ada53: "C:/Users/Surface/Downloads/53 ADA MASKİ ABONELERİ (2).xlsx",
  sire: "C:/Users/Surface/Downloads/ŞİRE PAZARI MASKİ ABONELİKLERİ (2).xlsx",
};

const SHEET_5ETAP = {
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

const BLOCK_TARGETS = {
  "49 ADA": {
    "A BLOK": [1945], "B BLOK": [1751, 1946], "C BLOK": [1750, 1947], "D BLOK": [1724, 1948],
    "E BLOK": [1753, 1949], "F BLOK": [1752, 1950], "G BLOK": [1951], "H BLOK": [1952],
    "I BLOK": [2001], "J BLOK": [2002], "K BLOK": [2003], "L BLOK": [2004], "M BLOK": [2005],
  },
  "37-50 A-B": { A: [1722, 1954], B: [1732, 1955] },
  "37-50 E": { "E BLOK": [1736, 1910] },
  "46 ADA": { _all: [1939] },
  SIRE: { _all: [1937] },
};

/** Dogrulanmis bina eslesmeleri (kopya poligonlari atlar) */
const VERIFIED_51ADA = {
  "A BLOK": 1723,
  "B BLOK": 1749,
  "C BLOK": 2016,
  OTOPARK: 2600,
};
const VERIFIED_SIRE = {
  "A BLOK": 1935,
  "B BLOK": 1938,
  "C BLOK": 1936,
  "D BLOK": 1937,
};

const ADA_PARSel_MAP = {
  "49 ADA": "49",
  "37-50 A-B": "37-50",
  "37-50 E": "37-50",
  "46 ADA": "46",
  SIRE: "ŞİRE",
};

function normBlok(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normSayacKey(v) {
  return extractDigits(v);
}

function classify(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "eksik";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s)) return "eksik";
  const digits = extractDigits(s);
  if (digits.length >= 6 && digits.length <= 12) return "gecerli";
  return "hatali";
}

function extractDigits(v) {
  return String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "");
}

function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = extractDigits(s);
  return d.length >= 6 && d.length <= 10;
}

function parseSayacCell(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) {
    return { sayacId: "OKUNMADI", durum: "okunmadi" };
  }
  if (s === "-" || s === "---" || /^-+$/.test(s)) {
    return { sayacId: "", durum: "eksik" };
  }
  if (isValidSayac(s)) {
    return { sayacId: s, durum: "gecerli" };
  }
  return null;
}

function findExcel(pattern) {
  const candidates = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (pattern(f)) candidates.push(join(dir, f));
    }
  }
  return candidates.sort().at(-1) || null;
}

const FILE_FINDERS = {
  etap5: () => findExcel((f) => f.includes("5. ETAP") && /SAY/i.test(f)),
  etap4: () => findExcel((f) => f.toUpperCase().includes("4.ETAP") && /SAY/i.test(f)),
  ada49: () => findExcel((f) => f.includes("49 ADA")),
  ada3750ab: () => findExcel((f) => f.includes("37-50") && /A-B/i.test(f)),
  ada3750e: () => findExcel((f) => f.includes("37-50") && /E BLOK/i.test(f)),
  ada41134: () => findExcel((f) => f.includes("41-134")),
  ada46: () => findExcel((f) => f.includes("46 ADA")),
  ada51: () => findExcel((f) => f.includes("51 ADA")),
  ada53: () => findExcel((f) => f.includes("53 ADA")),
  sire: () => findExcel((f) => /ŞİRE|SIRE|İRE/i.test(f) && /PAZAR/i.test(f)),
};

function resolveFilePath(key) {
  const explicit = EXPLICIT_FILES[key];
  if (explicit && existsSync(explicit)) return explicit;
  return FILE_FINDERS[key]?.() || null;
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { files: {}, last_sync: null, last_stats: null };
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function fileFingerprint(path) {
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  return { path, mtime: st.mtimeMs, size: st.size };
}

function filesChanged(current, prev) {
  if (!prev?.files) return true;
  for (const key of FILE_KEYS) {
    const c = current[key];
    const p = prev.files[key];
    if (!c && !p) continue;
    if (!c || !p) return true;
    if (c.mtime !== p.mtime || c.size !== p.size || c.path !== p.path) return true;
  }
  return false;
}

function buildBlokResolver(db) {
  const map = new Map();

  for (const [blok, binaId] of Object.entries(VERIFIED_51ADA)) {
    map.set(`51|${normBlok(blok)}`, { binaId, score: 20000 });
  }
  for (const [blok, binaId] of Object.entries(VERIFIED_SIRE)) {
    map.set(`ŞİRE|${normBlok(blok)}`, { binaId, score: 20000 });
  }

  for (const r of db.prepare(`
    SELECT bb.ada_parsel, s.blok_no, s.bina_id,
      (SELECT COUNT(*) FROM bina_bilgi bi WHERE bi.bina_id = s.bina_id) AS configured,
      COUNT(*) AS cnt
    FROM sayac s
    JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
    WHERE bb.ada_parsel IS NOT NULL AND TRIM(bb.ada_parsel) != ''
    GROUP BY bb.ada_parsel, s.blok_no, s.bina_id
  `).all()) {
    const key = `${r.ada_parsel}|${normBlok(r.blok_no)}`;
    const score = (r.configured ? 1000 : 0) + r.cnt;
    const prev = map.get(key);
    if (!prev || score > prev.score) map.set(key, { binaId: r.bina_id, score });
  }

  for (const [adaKey, blocks] of Object.entries(BLOCK_TARGETS)) {
    const adaParsel = ADA_PARSel_MAP[adaKey] ?? adaKey;
    for (const [blok, ids] of Object.entries(blocks)) {
      if (blok === "_all") continue;
      const key = `${adaParsel}|${normBlok(blok)}`;
      if (!map.has(key) && ids.length) map.set(key, { binaId: ids[0], score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '46 ADA%'`).all()) {
    const m = String(r.value).match(/46 ADA\s+(.+)/i);
    if (m) {
      const key = `46|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '53 ADA%'`).all()) {
    const m = String(r.value).match(/53 ADA\s+(.+)/i);
    if (m) {
      const key = `53|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '51 ADA%'`).all()) {
    const m = String(r.value).match(/51 ADA\s+(.+)/i);
    if (m) {
      const key = `51|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE 'ŞİRE%'`).all()) {
    const m = String(r.value).match(/ŞİRE\s+(.+)/i);
    if (m) {
      const key = `ŞİRE|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`
    SELECT s.bina_id, s.blok_no
    FROM sayac s JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
    WHERE bb.ada_parsel = '41-134'
    GROUP BY s.bina_id, s.blok_no
  `).all()) {
    const key = `41-134|${normBlok(r.blok_no)}`;
    if (!map.has(key)) map.set(key, { binaId: r.bina_id, score: 0 });
  }

  return (adaParsel, blok) => {
    const b = normBlok(blok);
    const keys = [`${adaParsel}|${b}`];
    if (!/BLOK$/i.test(b)) keys.push(`${adaParsel}|${b} BLOK`);
    const short = b.replace(/\s+BLOK$/i, "");
    if (short !== b) keys.push(`${adaParsel}|${short}`);
    for (const key of keys) {
      if (map.has(key)) return map.get(key).binaId;
    }
    return null;
  };
}

function pickDataSheet(wb, preferCarsaf = false) {
  if (preferCarsaf) {
    const carsaf = wb.SheetNames.find((s) => /ÇARŞAF|CARSAF/i.test(s));
    if (carsaf) return carsaf;
  }
  const birim = wb.SheetNames.find((s) => /Bağ[ıi]ms[ıi]z\s+Birim/i.test(s));
  if (birim) return birim;
  return wb.SheetNames.at(-1);
}

function parse5EtapValid(path) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const rows = [];
  for (const sheet of wb.SheetNames) {
    const binaId = SHEET_5ETAP[sheet];
    if (!binaId) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < data.length; r++) {
      const daire = String(data[r][0] ?? "").trim();
      if (!daire || daire === "KAPICI") continue;
      for (const col of COLS_5ETAP) {
        const parsed = parseSayacCell(data[r][col.idx]);
        if (!parsed || parsed.durum !== "gecerli") continue;
        rows.push({ binaId, blok: sheet, daire, tip: col.tip, sayacId: parsed.sayacId, durum: "gecerli" });
      }
    }
  }
  return rows;
}

function parse4EtapValid(path, etapMap) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const rows = [];
  for (const sheetName of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
    const adaM = sheetName.match(/ADA-(\d+)/i);
    const ada = adaM ? adaM[1].padStart(2, "0") : "";
    const headerRow = data[1] || [];
    const colBlok = {};
    for (let c = 1; c < headerRow.length; c++) {
      const h = String(headerRow[c] ?? "").trim();
      if (h && /^(DB|DC|GB)-/.test(h)) colBlok[c] = h.replace(/\*$/, "");
    }
    for (let r = 3; r < data.length; r++) {
      const row = data[r];
      for (const [cStr, blok] of Object.entries(colBlok)) {
        const c = Number(cStr);
        const daire = String(row[c] ?? "").trim();
        const parsed = parseSayacCell(row[c + 1]);
        if (!daire || !parsed || parsed.durum !== "gecerli") continue;
        const binaId = etapMap.get(`${ada}|${blok}`);
        if (!binaId) continue;
        rows.push({ binaId, blok, daire, tip: "SOGUK SU", sayacId: parsed.sayacId, durum: "gecerli" });
      }
    }
  }
  return rows;
}

function parse4EtapProblems(path, etapMap) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheetName of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
    const adaM = sheetName.match(/ADA-(\d+)/i);
    const ada = adaM ? adaM[1].padStart(2, "0") : "";
    const headerRow = data[1] || [];
    const colBlok = {};
    for (let c = 1; c < headerRow.length; c++) {
      const h = String(headerRow[c] ?? "").trim();
      if (h && /^(DB|DC|GB)-/.test(h)) colBlok[c] = h.replace(/\*$/, "");
    }
    for (let r = 3; r < data.length; r++) {
      const row = data[r];
      for (const [cStr, blok] of Object.entries(colBlok)) {
        const c = Number(cStr);
        const daire = String(row[c] ?? "").trim();
        const parsed = parseSayacCell(row[c + 1]);
        if (!daire || !parsed || parsed.durum === "gecerli") continue;
        const binaId = etapMap.get(`${ada}|${blok}`);
        if (!binaId) continue;
        records.push({ binaId, blok, daire, sayacId: parsed.sayacId, durum: parsed.durum, tip: "SOGUK SU" });
      }
    }
  }
  return records;
}

function parse5EtapProblems(path) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheet of wb.SheetNames) {
    const binaId = SHEET_5ETAP[sheet];
    if (!binaId) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < data.length; r++) {
      const daire = String(data[r][0] ?? "").trim();
      if (!daire || daire === "KAPICI") continue;
      for (const col of COLS_5ETAP) {
        const parsed = parseSayacCell(data[r][col.idx]);
        if (!parsed || parsed.durum !== "okunmadi") continue;
        records.push({ binaId, blok: sheet, daire, sayacId: parsed.sayacId, durum: parsed.durum, tip: col.tip });
      }
    }
  }
  return records;
}

function isBlokRow(blok) {
  return /^[A-Z0-9]+(\s+BLOK)?$/i.test(normBlok(blok));
}

function parseBagimsizBirim(path, adaParsel, resolveBina, stats) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheet = pickDataSheet(wb);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const headerIdx = findHeaderRow(data);
  const headerRow = data[headerIdx] || [];
  const cBlok = colIndex(headerRow, [/BLOK/]);
  const cKapi = colIndex(headerRow, [/BAGIMSIZ/, /KAPI/, /BOLUM/]);
  const cTip = colIndex(headerRow, [/NITEL/, /KULLAN/]);
  const cSayac = colIndex(headerRow, [/SAYAC/, /UZAKTAN/]);
  const rows = [];
  for (let r = headerIdx + 1; r < data.length; r++) {
    const row = data[r];
    const blok = String(row[cBlok >= 0 ? cBlok : 0] ?? "").trim();
    if (!blok || !isBlokRow(blok)) continue;
    const daire = String(row[cKapi >= 0 ? cKapi : 1] ?? "").trim();
    const tip = cTip >= 0 ? String(row[cTip] ?? "DAİRE").trim() || "DAİRE" : "DAİRE";
    const parsed = parseSayacCell(cSayac >= 0 ? row[cSayac] : row[5]);
    if (!daire || !parsed) continue;
    const binaId = resolveBina(adaParsel, blok);
    if (!binaId) {
      stats.unmapped++;
      continue;
    }
    rows.push({ binaId, blok, daire, tip, sayacId: parsed.sayacId, durum: parsed.durum });
  }
  return rows;
}

function parse3750(path, resolveBina, stats) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheet = pickDataSheet(wb, true);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const rows = [];
  for (let r = 2; r < data.length; r++) {
    const row = data[r];
    if (!row[0] || isNaN(Number(row[0]))) continue;
    const blok = String(row[3] ?? "").trim();
    const daire = String(row[4] ?? "").trim();
    const tip = String(row[6] ?? "DAİRE").trim() || "DAİRE";
    const parsed = parseSayacCell(row[7]);
    if (!blok || !daire || !parsed) continue;
    const binaId = resolveBina("37-50", blok);
    if (!binaId) {
      stats.unmapped++;
      continue;
    }
    rows.push({ binaId, blok, daire, tip, sayacId: parsed.sayacId, durum: parsed.durum });
  }
  return rows;
}

function normHeader(s) {
  return String(s ?? "")
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function findHeaderRow(data) {
  for (let i = 0; i < Math.min(12, data.length); i++) {
    const row = data[i].map((c) => normHeader(c));
    const cSayac = colIndex(row, [/SAYAC/, /UZAKTAN/]);
    const cBlok = colIndex(row, [/BLOK/]);
    const cKapi = colIndex(row, [/BAGIMSIZ/, /KAPI/, /BOLUM/]);
    if (cSayac >= 0 && (cBlok >= 0 || cKapi >= 0)) return i;
  }
  return 2;
}

function colIndex(headerRow, patterns) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = normHeader(headerRow[i]);
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function parseAdaSheets(path, adaParsel, resolveBina, stats) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const rows = [];
  for (const sheetName of wb.SheetNames) {
    if (/SAYFA|SHEET|AÇIKLAMA|DASH/i.test(sheetName)) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const headerIdx = findHeaderRow(data);
    const headerRow = data[headerIdx] || [];
    const cBlok = colIndex(headerRow, [/BLOK/]);
    const cKapi = colIndex(headerRow, [/KAPI/]);
    const cTip = colIndex(headerRow, [/KULLAN/, /NITEL/]);
    const cSayac = colIndex(headerRow, [/SAYAC/, /UZAKTAN/]);
    if (cKapi < 0 || cSayac < 0) continue;

    const fallbackBlok = sheetName.replace(/\s+/g, " ").trim();
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const blok = String(row[cBlok >= 0 ? cBlok : 3] ?? fallbackBlok).trim() || fallbackBlok;
      const daire = String(row[cKapi] ?? "").trim();
      const tip = cTip >= 0 ? String(row[cTip] ?? "DAİRE").trim() || "DAİRE" : "DAİRE";
      const parsed = parseSayacCell(row[cSayac]);
      if (!daire || !parsed) continue;
      const binaId = resolveBina(adaParsel, blok);
      if (!binaId) {
        stats.unmapped++;
        continue;
      }
      rows.push({ binaId, blok, daire, tip, sayacId: parsed.sayacId, durum: parsed.durum });
    }
  }
  return rows;
}

function parseSire(path, resolveBina, stats) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const rows = [];
  for (const sheetName of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const headerIdx = findHeaderRow(data);
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const blok = String(row[1] ?? sheetName).trim();
      const daire = String(row[2] ?? "").trim();
      const tip = String(row[4] ?? "DAİRE").trim() || "DAİRE";
      const parsed = parseSayacCell(row[5]);
      if (!daire || !parsed) continue;
      const binaId = resolveBina("ŞİRE", blok);
      if (!binaId) {
        stats.unmapped++;
        continue;
      }
      rows.push({ binaId, blok, daire, tip, sayacId: parsed.sayacId, durum: parsed.durum });
    }
  }
  return rows;
}

function upsertSayac(db, rec, stats) {
  const find = db.prepare(`
    SELECT birim_no, sayac_id FROM sayac
    WHERE bina_id = ? AND kapi_no = ? AND blok_no = ? AND kullanilis_sekli = ?
    LIMIT 1
  `);
  const findBlok = db.prepare(`
    SELECT birim_no, sayac_id FROM sayac
    WHERE bina_id = ? AND kapi_no = ? AND blok_no = ?
    LIMIT 1
  `);
  const findBySayac = db.prepare(`
    SELECT birim_no, sayac_id FROM sayac
    WHERE bina_id = ? AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ','') = ?
    LIMIT 1
  `);
  const findGlobalSayac = db.prepare(`
    SELECT bina_id, birim_no, sayac_id FROM sayac
    WHERE TRIM(COALESCE(sayac_id,'')) != ''
      AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ','') = ?
    LIMIT 1
  `);
  const nextBirim = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`);
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

  const daire = String(rec.daire ?? "").trim();
  const sayacKey = normSayacKey(rec.sayacId);
  const tip = String(rec.tip ?? "").trim();
  let existing = find.get(rec.binaId, daire, rec.blok, rec.tip);

  if (!existing && sayacKey) {
    existing = findBySayac.get(rec.binaId, sayacKey);
  }

  // Ayni dairede birden fazla sayac tipi (5. ETAP sicak/soguk) icin blok eslesmesi kullanma
  if (!existing && !tip) {
    existing = findBlok.get(rec.binaId, daire, rec.blok);
  }

  if (!existing && sayacKey && rec.durum === "gecerli") {
    const global = findGlobalSayac.get(sayacKey);
    if (global) {
      if (global.bina_id !== rec.binaId) {
        stats.skipped_duplicate_global = (stats.skipped_duplicate_global || 0) + 1;
        return;
      }
      existing = global;
    }
  }

  if (existing && rec.durum !== "gecerli" && classify(existing.sayac_id) === "gecerli") {
    stats.skipped_protected++;
    return;
  }

  const birimNo = existing?.birim_no ?? nextBirim.get(rec.binaId).n;
  const prev = existing?.sayac_id ?? "";
  insert.run(rec.binaId, birimNo, rec.blok, daire, rec.tip, rec.sayacId, rec.durum);

  if (!existing) {
    stats.inserted++;
  } else if (String(prev).trim() !== String(rec.sayacId).trim()) {
    stats.updated++;
  } else {
    stats.unchanged++;
  }
}

function applyRecords(records, stats, counterKey) {
  for (const rec of records) {
    upsertSayac(dbRef, rec, stats);
    if (counterKey) stats[counterKey] = (stats[counterKey] || 0) + 1;
    if (rec.durum !== "gecerli") stats.sorun_aktarildi++;
  }
}

function ensureBinaBilgiForSayacli(db, stats) {
  const targets = db
    .prepare(
      `
    SELECT
      s.bina_id,
      COUNT(*) AS sayac_sayisi,
      MAX(bb.ada_parsel) AS ada_parsel
    FROM sayac s
    LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
    WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
    GROUP BY s.bina_id
    HAVING NOT EXISTS (SELECT 1 FROM bina_bilgi bi WHERE bi.bina_id = s.bina_id)
  `
    )
    .all();

  const insert = db.prepare(`
    INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
    VALUES (?, 0, ?, 0, ?, 0, ?, '', '', datetime('now'))
  `);

  for (const row of targets) {
    const n = row.sayac_sayisi || 1;
    insert.run(row.bina_id, n, n, row.ada_parsel || "");
    stats.bina_bilgi_created = (stats.bina_bilgi_created || 0) + 1;
  }

  const expand = db
    .prepare(
      `
    SELECT bb.bina_id, bb.toplam_bagımsız_bolum AS kapasite, COUNT(s.id) AS sayac_sayisi
    FROM bina_bilgi bb
    JOIN sayac s ON s.bina_id = bb.bina_id AND TRIM(COALESCE(s.sayac_id, '')) != ''
    GROUP BY bb.bina_id
    HAVING sayac_sayisi > kapasite
  `
    )
    .all();

  const upd = db.prepare(`
    UPDATE bina_bilgi SET
      daire_sayisi = ?,
      toplam_bagımsız_bolum = ?,
      updated_at = datetime('now')
    WHERE bina_id = ?
  `);

  for (const row of expand) {
    const cap = Math.max(row.kapasite || 0, row.sayac_sayisi);
    upd.run(cap, cap, row.bina_id);
    stats.bina_bilgi_expanded = (stats.bina_bilgi_expanded || 0) + 1;
  }
}

let dbRef = null;

function runSync(force = false) {
  const files = {};
  for (const key of FILE_KEYS) {
    files[key] = fileFingerprint(resolveFilePath(key));
  }

  const prevState = loadState();
  if (!force && !filesChanged(files, prevState)) {
    return {
      skipped: true,
      message: "Excel dosyaları değişmedi",
      last_sync: prevState.last_sync,
      files,
      stats: prevState.last_stats,
    };
  }

  const db = new DatabaseSync(DB_PATH);
  dbRef = db;
  db.exec("PRAGMA busy_timeout = 15000");
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`);
  } catch {}

  const etapMap = new Map(Object.entries(VERIFIED_4ETAP));
  const resolveBina = buildBlokResolver(db);

  const stats = {
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped_protected: 0,
    skipped_duplicate_global: 0,
    unmapped: 0,
    etap5_okunan: 0,
    etap4_okunan: 0,
    ada49_okunan: 0,
    ada3750ab_okunan: 0,
    ada3750e_okunan: 0,
    ada41134_okunan: 0,
    ada46_okunan: 0,
    ada51_okunan: 0,
    ada53_okunan: 0,
    sire_okunan: 0,
    sorun_aktarildi: 0,
    bina_bilgi_created: 0,
    bina_bilgi_expanded: 0,
    counts: { gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 },
  };

  db.exec("BEGIN IMMEDIATE");
  try {
    if (files.etap5?.path) {
      for (const rec of parse5EtapValid(files.etap5.path)) {
        upsertSayac(db, rec, stats);
        stats.etap5_okunan++;
      }
      for (const rec of parse5EtapProblems(files.etap5.path)) {
        upsertSayac(db, rec, stats);
        stats.sorun_aktarildi++;
      }
    }

    if (files.etap4?.path) {
      for (const rec of parse4EtapValid(files.etap4.path, etapMap)) {
        upsertSayac(db, rec, stats);
        stats.etap4_okunan++;
      }
      for (const rec of parse4EtapProblems(files.etap4.path, etapMap)) {
        upsertSayac(db, rec, stats);
        stats.sorun_aktarildi++;
      }
    }

    if (files.ada49?.path) {
      applyRecords(parseBagimsizBirim(files.ada49.path, "49", resolveBina, stats), stats, "ada49_okunan");
    }
    if (files.ada3750ab?.path) {
      applyRecords(parse3750(files.ada3750ab.path, resolveBina, stats), stats, "ada3750ab_okunan");
    }
    if (files.ada3750e?.path) {
      applyRecords(parseBagimsizBirim(files.ada3750e.path, "37-50", resolveBina, stats), stats, "ada3750e_okunan");
    }
    if (files.ada41134?.path) {
      applyRecords(parseBagimsizBirim(files.ada41134.path, "41-134", resolveBina, stats), stats, "ada41134_okunan");
    }
    if (files.ada46?.path) {
      applyRecords(parseAdaSheets(files.ada46.path, "46", resolveBina, stats), stats, "ada46_okunan");
    }
    if (files.ada51?.path) {
      applyRecords(parseBagimsizBirim(files.ada51.path, "51", resolveBina, stats), stats, "ada51_okunan");
    }
    if (files.ada53?.path) {
      applyRecords(parseAdaSheets(files.ada53.path, "53", resolveBina, stats), stats, "ada53_okunan");
    }
    if (files.sire?.path) {
      applyRecords(parseSire(files.sire.path, resolveBina, stats), stats, "sire_okunan");
    }

    ensureBinaBilgiForSayacli(db, stats);

    const rows = db.prepare(`SELECT id, sayac_id FROM sayac`).all();
    const upd = db.prepare(`UPDATE sayac SET sayac_durum = ? WHERE id = ?`);
    stats.counts = { gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 };
    for (const row of rows) {
      const durum = classify(row.sayac_id);
      upd.run(durum, row.id);
      stats.counts[durum]++;
    }

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    dbRef = null;
  }

  const result = {
    skipped: false,
    last_sync: new Date().toISOString(),
    files,
    stats,
  };

  saveState({ files, last_sync: result.last_sync, last_stats: stats });
  return result;
}

const force = process.argv.includes("--force");
const result = runSync(force);
console.log(JSON.stringify(result, null, 2));
