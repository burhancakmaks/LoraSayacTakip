/**
 * Tüm MASKİ Excel dosyalarından arama indeksi oluşturur.
 * Çıktı: data/maski-arama-index.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "data/maski-arama-index.json");
const SEARCH_DIRS = ["C:/Users/Surface/Downloads", join(ROOT, "data")];

const FILE_KEYS = ["etap5", "etap4", "ada49", "ada3750ab", "ada3750e", "ada41134", "ada46", "ada53", "sire"];

const KAYNAK_LABELS = {
  etap5: "5. ETAP",
  etap4: "4. ETAP",
  ada49: "49 ADA",
  ada3750ab: "37-50 A-B",
  ada3750e: "37-50 E",
  ada41134: "41-134",
  ada46: "46 ADA",
  ada53: "53 ADA",
  sire: "ŞİRE Pazarı",
};

const COLS_5ETAP = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

function findExcel(pattern) {
  const candidates = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (pattern(f)) candidates.push(join(dir, f));
    }
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const FILE_FINDERS = {
  etap5: () => findExcel((f) => f.includes("5. ETAP") && /SAY/i.test(f)),
  etap4: () => findExcel((f) => f.toUpperCase().includes("4.ETAP") && /SAY/i.test(f)),
  ada49: () => findExcel((f) => f.includes("49 ADA")),
  ada3750ab: () => findExcel((f) => f.includes("37-50") && /A-B/i.test(f)),
  ada3750e: () => findExcel((f) => f.includes("37-50") && /E BLOK/i.test(f)),
  ada41134: () => findExcel((f) => f.includes("41-134")),
  ada46: () => findExcel((f) => f.includes("46 ADA")),
  ada53: () => findExcel((f) => f.includes("53 ADA")),
  sire: () => findExcel((f) => /ŞİRE|SIRE|İRE/i.test(f) && /PAZAR/i.test(f)),
};

function fileMeta(path) {
  if (!path || !existsSync(path)) return null;
  const st = statSync(path);
  return { path, name: path.split(/[/\\]/).pop(), mtime: st.mtimeMs, size: st.size };
}

function normHeader(s) {
  return String(s ?? "")
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractDigits(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function isValidSayac(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-" || /OKUNMADI|SAYA|TAKIL|YOK/i.test(s)) return false;
  const d = extractDigits(s);
  return d.length >= 6 && d.length <= 12;
}

function pushRecord(records, base) {
  const sayac = String(base.sayac_no ?? "").trim();
  if (!sayac && !base.abone_no) return;
  if (sayac && !isValidSayac(sayac) && sayac !== "OKUNMADI") return;
  records.push({
    kaynak: base.kaynak,
    dosya: base.dosya,
    ada: base.ada || "",
    parsel: base.parsel || "",
    blok: base.blok || "",
    kapi_no: String(base.kapi_no ?? "").trim(),
    kat: base.kat || "",
    nitelik: base.nitelik || "",
    sayac_tipi: base.sayac_tipi || "",
    sayac_no: sayac,
    abone_no: String(base.abone_no ?? "").trim(),
    sicil_no: String(base.sicil_no ?? "").trim(),
    adres: base.adres || "",
  });
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

function findHeaderRow(data) {
  for (let i = 0; i < Math.min(8, data.length); i++) {
    const row = data[i].map((c) => normHeader(c));
    if (row.some((c) => c.includes("KAPI") || c.includes("SAYAC"))) return i;
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

function parse5Etap(path, kaynak, dosya) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheet of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
    for (let r = 2; r < data.length; r++) {
      const kapi = String(data[r][0] ?? "").trim();
      if (!kapi || kapi === "KAPICI") continue;
      for (const col of COLS_5ETAP) {
        const sayac = String(data[r][col.idx] ?? "").trim();
        if (!sayac) continue;
        pushRecord(records, {
          kaynak,
          dosya,
          ada: "5. ETAP",
          blok: sheet,
          kapi_no: kapi,
          sayac_tipi: col.tip,
          sayac_no: sayac,
          adres: `5. ETAP ${sheet}`,
        });
      }
    }
  }
  return records;
}

function parse4Etap(path, kaynak, dosya) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheetName of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
    const adaM = sheetName.match(/ADA-(\d+)/i);
    const ada = adaM ? `4. ETAP ADA-${adaM[1]}` : "4. ETAP";
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
        const kapi = String(row[c] ?? "").trim();
        const sayac = String(row[c + 1] ?? "").trim();
        if (!kapi || !sayac) continue;
        pushRecord(records, {
          kaynak,
          dosya,
          ada,
          blok,
          kapi_no: kapi,
          sayac_tipi: "SOGUK SU",
          sayac_no: sayac,
          adres: `${ada} ${blok}`,
        });
      }
    }
  }
  return records;
}

function parseBagimsizBirim(path, kaynak, dosya, ada) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheet = pickDataSheet(wb);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const title = String(data[0]?.[0] ?? "").trim();
  const adresLine = String(data[1]?.[0] ?? "").trim();
  const adres = [title, adresLine].filter(Boolean).join(" | ");
  const records = [];
  for (let r = 3; r < data.length; r++) {
    const blok = String(data[r][0] ?? "").trim();
    const kapi = String(data[r][1] ?? "").trim();
    const kat = String(data[r][3] ?? "").trim();
    const nitelik = String(data[r][4] ?? "").trim();
    const sayac = String(data[r][5] ?? "").trim();
    const abone = String(data[r][6] ?? "").trim();
    if (!blok || !kapi) continue;
    pushRecord(records, {
      kaynak,
      dosya,
      ada,
      blok,
      kapi_no: kapi,
      kat,
      nitelik,
      sayac_no: sayac,
      abone_no: abone,
      adres,
    });
  }
  return records;
}

function parse3750(path, kaynak, dosya) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheet = pickDataSheet(wb, true);
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const adresLine = String(data[0]?.[0] ?? "").trim();
  const records = [];
  for (let r = 2; r < data.length; r++) {
    const row = data[r];
    if (!row[0] || isNaN(Number(row[0]))) continue;
    const parsel = String(row[2] ?? "").trim();
    const blok = String(row[3] ?? "").trim();
    const kapi = String(row[4] ?? "").trim();
    const kat = String(row[5] ?? "").trim();
    const nitelik = String(row[6] ?? "").trim();
    const sayac = String(row[7] ?? "").trim();
    const abone = String(row[8] ?? "").trim();
    if (!blok || !kapi) continue;
    pushRecord(records, {
      kaynak,
      dosya,
      ada: "37-50",
      parsel,
      blok: blok.length <= 2 ? `${blok} BLOK` : blok,
      kapi_no: kapi,
      kat,
      nitelik,
      sayac_no: sayac,
      abone_no: abone,
      adres: adresLine ? `37-50 ADA | ${adresLine}` : "37-50 ADA",
    });
  }
  return records;
}

function parseAdaSheets(path, kaynak, dosya, ada) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheetName of wb.SheetNames) {
    if (/SAYFA|SHEET|AÇIKLAMA|DASH/i.test(sheetName)) continue;
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const headerIdx = findHeaderRow(data);
    const headerRow = data[headerIdx] || [];
    const title = String(data[0]?.[0] ?? "").trim();
    const adresLine = String(data[1]?.[0] ?? "").trim();
    const adres = [title, adresLine].filter(Boolean).join(" | ") || `${ada} ADA ${sheetName}`;
    const cBlok = colIndex(headerRow, [/BLOK/]);
    const cKapi = colIndex(headerRow, [/KAPI/]);
    const cKat = colIndex(headerRow, [/KAT/]);
    const cTip = colIndex(headerRow, [/KULLAN/, /NITEL/]);
    const cSayac = colIndex(headerRow, [/SAYAC/, /UZAKTAN/]);
    const cAbone = colIndex(headerRow, [/ABONE/]);
    if (cKapi < 0 || cSayac < 0) continue;
    const fallbackBlok = sheetName.replace(/\s+/g, " ").trim();
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const blok = String(row[cBlok >= 0 ? cBlok : 3] ?? fallbackBlok).trim() || fallbackBlok;
      const kapi = String(row[cKapi] ?? "").trim();
      const kat = cKat >= 0 ? String(row[cKat] ?? "").trim() : "";
      const nitelik = cTip >= 0 ? String(row[cTip] ?? "").trim() : "";
      const sayac = String(row[cSayac] ?? "").trim();
      const abone = cAbone >= 0 ? String(row[cAbone] ?? "").trim() : "";
      if (!kapi) continue;
      pushRecord(records, {
        kaynak,
        dosya,
        ada,
        blok,
        kapi_no: kapi,
        kat,
        nitelik,
        sayac_no: sayac,
        abone_no: abone,
        adres,
      });
    }
  }
  return records;
}

function parseSire(path, kaynak, dosya) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const records = [];
  for (const sheetName of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const headerIdx = findHeaderRow(data);
    const title = String(data[0]?.[0] ?? "").trim();
    for (let r = headerIdx + 1; r < data.length; r++) {
      const row = data[r];
      const blok = String(row[1] ?? sheetName).trim();
      const kapi = String(row[2] ?? "").trim();
      const kat = String(row[3] ?? "").trim();
      const nitelik = String(row[4] ?? "").trim();
      const sayac = String(row[5] ?? "").trim();
      const abone = String(row[6] ?? "").trim();
      if (!kapi) continue;
      pushRecord(records, {
        kaynak,
        dosya,
        ada: "ŞİRE",
        blok,
        kapi_no: kapi,
        kat,
        nitelik,
        sayac_no: sayac,
        abone_no: abone,
        adres: title || `ŞİRE PAZARI ${sheetName}`,
      });
    }
  }
  return records;
}

const PARSERS = {
  etap5: (p, k, d) => parse5Etap(p, k, d),
  etap4: (p, k, d) => parse4Etap(p, k, d),
  ada49: (p, k, d) => parseBagimsizBirim(p, k, d, "49"),
  ada3750ab: (p, k, d) => parse3750(p, k, d),
  ada3750e: (p, k, d) => parseBagimsizBirim(p, k, d, "37-50"),
  ada41134: (p, k, d) => parseBagimsizBirim(p, k, d, "41-134"),
  ada46: (p, k, d) => parseAdaSheets(p, k, d, "46"),
  ada53: (p, k, d) => parseAdaSheets(p, k, d, "53"),
  sire: (p, k, d) => parseSire(p, k, d),
};

function main() {
  const files = {};
  const stats = {};
  const records = [];

  for (const key of FILE_KEYS) {
    const path = FILE_FINDERS[key]();
    files[key] = fileMeta(path);
    const kaynak = KAYNAK_LABELS[key];
    const dosya = files[key]?.name || "";
    if (!path) {
      console.warn(`Dosya bulunamadı: ${key}`);
      stats[key] = 0;
      continue;
    }
    const parsed = PARSERS[key](path, kaynak, dosya);
    stats[key] = parsed.length;
    records.push(...parsed);
    console.log(`${kaynak}: ${parsed.length} kayıt (${dosya})`);
  }

  const index = {
    built_at: new Date().toISOString(),
    total: records.length,
    stats,
    files,
    records,
  };

  writeFileSync(OUT_PATH, JSON.stringify(index));
  console.log(`\nToplam ${records.length} kayıt -> ${OUT_PATH}`);
}

main();
