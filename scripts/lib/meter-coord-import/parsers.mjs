import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  asIdentityString,
  cleanText,
  fileSha256,
  normalizeMeterNumber,
  parseWktPoint,
  unicodeFold,
  TEST_BLOCK_RE,
} from "./common.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

export const EXCEL_SCHEMA = {
  LORA_COORD: "lora-coord",
  ABONE_LOCATION: "abone-location",
};

function foldKey(value) {
  return unicodeFold(value).toLocaleLowerCase("tr-TR");
}

function rowLookup(row) {
  const map = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    map.set(foldKey(key), value);
  }
  return (aliases) => {
    for (const alias of aliases) {
      const key = foldKey(alias);
      if (map.has(key)) return map.get(key);
    }
    return undefined;
  };
}

export function detectExcelSchema(firstRow) {
  const keys = new Set(Object.keys(firstRow || {}).map(foldKey));
  if (keys.has("meter_number") && keys.has("installation_number") && keys.has("location")) {
    return EXCEL_SCHEMA.LORA_COORD;
  }
  if (
    keys.has("location") &&
    (keys.has("sayac no") || keys.has("sayaç no") || keys.has("sayac_no")) &&
    (keys.has("abone no") || keys.has("abone_no"))
  ) {
    return EXCEL_SCHEMA.ABONE_LOCATION;
  }
  return null;
}

export function emptyCsv() {
  return { path: null, hash: null, header: [], rows: [] };
}

export function readCoordinateWorkbook(excelPath) {
  const buf = readFileSync(excelPath);
  const hash = fileSha256(buf);
  const wb = XLSX.read(buf, { type: "buffer", raw: true, cellDates: false });
  if (!wb.SheetNames.includes("konum")) {
    throw new Error("Excel 'konum' sayfası bulunamadı.");
  }
  const emptySheet = wb.Sheets.Sayfa1
    ? XLSX.utils.sheet_to_json(wb.Sheets.Sayfa1, { defval: "" })
    : [];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.konum, { defval: "", raw: true });
  const first = rows[0] || {};
  const schema = detectExcelSchema(first);
  if (rows.length && !schema) {
    throw new Error(`Excel şeması tanınmadı. Sütunlar: ${Object.keys(first).join(", ")}`);
  }

  const parsed = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const get = rowLookup(row);
    const location = cleanText(get(["location"]));
    const point = parseWktPoint(location);

    if (schema === EXCEL_SCHEMA.ABONE_LOCATION) {
      const meterRaw = get(["sayac no", "sayaç no", "sayac_no"]);
      const meter = normalizeMeterNumber(meterRaw);
      const abone = asIdentityString(get(["abone no", "abone_no"]));
      const brand = cleanText(get(["sayaç marka", "sayac marka", "sayaç markası", "sayac_markasi"]));
      parsed.push({
        source_row: i + 2,
        schema,
        installation_number: "",
        agreement_number: "",
        abone_no: abone == null ? "" : abone,
        location,
        meter_raw: meterRaw,
        meter_ok: meter.ok,
        meter_reason: meter.reason,
        meter_number: meter.normalized,
        value: brand,
        sayac_markasi: brand,
        uretim_yili: asIdentityString(get(["üretim yılı", "uretim yili", "uretim_yili"])) || "",
        damga_yili: asIdentityString(get(["damga yılı", "damga yili", "damga_yili"])) || "",
        point,
        identity_suspect: abone == null,
        kaynak: "sayac-xlsx-import",
      });
      continue;
    }

    const meter = normalizeMeterNumber(row.meter_number);
    const inst = asIdentityString(row.installation_number);
    const agr = asIdentityString(row.agreement_number);
    const value = cleanText(row.value);
    parsed.push({
      source_row: i + 2,
      schema: EXCEL_SCHEMA.LORA_COORD,
      installation_number: inst == null ? "" : inst,
      agreement_number: agr == null ? "" : agr,
      abone_no: inst == null ? "" : inst,
      location,
      meter_raw: row.meter_number,
      meter_ok: meter.ok,
      meter_reason: meter.reason,
      meter_number: meter.normalized,
      value,
      sayac_markasi: "",
      uretim_yili: "",
      damga_yili: "",
      point,
      identity_suspect: inst == null || agr == null,
      kaynak: "meter-coord-import",
    });
  }
  return {
    path: excelPath,
    hash,
    schema: schema || EXCEL_SCHEMA.LORA_COORD,
    sheetNames: wb.SheetNames,
    emptySheetRows: emptySheet.length,
    rows: parsed,
  };
}

function splitCsvLine(line, sep = ";") {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsvDevices(csvPath) {
  const buf = readFileSync(csvPath);
  const hash = fileSha256(buf);
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const rawLines = text.split(/\r?\n/);
  let start = 0;
  while (start < rawLines.length && cleanText(rawLines[start]) === "") start++;
  if (start >= rawLines.length) {
    return { path: csvPath, hash, rows: [], header: [] };
  }
  const headerCells = splitCsvLine(rawLines[start]).map((h) => unicodeFold(h).replace(/^\uFEFF/, ""));
  const idx = Object.fromEntries(headerCells.map((h, i) => [h, i]));
  const required = ["Bölge", "Blok", "Daire", "Kat", "DevEUI", "Durum"];
  const missing = required.filter((k) => !(k in idx));
  if (missing.length) {
    throw new Error(`CSV beklenen sütunlar yok: ${missing.join(", ")}`);
  }
  const rows = [];
  for (let i = start + 1; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (cleanText(line) === "") continue;
    const cells = splitCsvLine(line);
    const get = (name) => unicodeFold(cells[idx[name]] ?? "");
    const deveui = get("DevEUI");
    const blok = get("Blok");
    const daire = get("Daire");
    const bolge = get("Bölge");
    rows.push({
      source_row: i + 1,
      bolge,
      blok,
      daire,
      kat: get("Kat"),
      deveui,
      durum: get("Durum"),
      son_uplink: get("Son Uplink"),
      kaydeden: get("Kaydeden"),
      kayit_tarihi: get("Kayıt Tarihi"),
      notlar: get("Notlar"),
      suspicious: TEST_BLOCK_RE.test(blok) || TEST_BLOCK_RE.test(daire) || TEST_BLOCK_RE.test(bolge),
    });
  }
  return { path: csvPath, hash, header: headerCells, rows };
}
