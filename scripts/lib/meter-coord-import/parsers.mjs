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
  const required = ["installation_number", "agreement_number", "location", "meter_number", "value"];
  const first = rows[0] || {};
  const missing = required.filter((k) => !(k in first) && rows.length > 0);
  if (rows.length && missing.length) {
    throw new Error(`Excel beklenen sütunlar yok: ${missing.join(", ")}`);
  }
  const parsed = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const meter = normalizeMeterNumber(row.meter_number);
    const inst = asIdentityString(row.installation_number);
    const agr = asIdentityString(row.agreement_number);
    const location = cleanText(row.location);
    const value = cleanText(row.value);
    const point = parseWktPoint(location);
    parsed.push({
      source_row: i + 2,
      installation_number: inst == null ? "" : inst,
      agreement_number: agr == null ? "" : agr,
      location,
      meter_raw: row.meter_number,
      meter_ok: meter.ok,
      meter_reason: meter.reason,
      meter_number: meter.normalized,
      value,
      point,
      identity_suspect: inst == null || agr == null,
    });
  }
  return {
    path: excelPath,
    hash,
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
