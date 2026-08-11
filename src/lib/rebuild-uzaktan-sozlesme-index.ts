import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";
import {
  type UzaktanBinaEntry,
  type UzaktanSozlesmeIndex,
  UZAKTAN_TYPE_COLORS,
} from "@/lib/uzaktan-sozlesme";
import { clearUzaktanIndexCache } from "@/lib/uzaktan-sozlesme-index";

const EXPLICIT_EXCEL = "C:/Users/Surface/Downloads/uzaktan okuma sözleşme.xlsx";
const SEARCH_DIRS = ["C:/Users/Surface/Downloads", path.join(process.cwd(), "data")];

type ExcelMeterRecord = {
  type: string;
  agreement_number: string;
  installation_number: string;
};

let excelCache: { path: string; mtime: number; meters: Map<string, ExcelMeterRecord> } | null = null;

function normDigits(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function findExcelPath(explicit?: string) {
  if (explicit && existsSync(explicit)) return explicit;
  if (existsSync(EXPLICIT_EXCEL)) return EXPLICIT_EXCEL;
  const candidates: string[] = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const lower = f.toLocaleLowerCase("tr-TR");
      if (lower.includes("uzaktan") && lower.includes("okuma") && /xlsx?$/i.test(f)) {
        candidates.push(path.join(dir, f));
      }
    }
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function loadExcelMeters(excelPath: string) {
  const mtime = statSync(excelPath).mtimeMs;
  if (excelCache && excelCache.path === excelPath && excelCache.mtime === mtime) {
    return excelCache.meters;
  }

  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;
  const meters = new Map<string, ExcelMeterRecord>();

  for (const row of rows) {
    const meter = String(row.meter_number ?? "").trim();
    if (!meter) continue;
    const type = String(row.value ?? "").trim() || "BILINMIYOR";
    const agreement_number = String(row.agreement_number ?? "").trim();
    const installation_number = String(row.installation_number ?? "").trim();
    if (!meters.has(meter)) {
      meters.set(meter, { type, agreement_number, installation_number });
    }
    const digits = normDigits(meter);
    if (digits && !meters.has(digits)) {
      meters.set(digits, { type, agreement_number, installation_number });
    }
  }

  excelCache = { path: excelPath, mtime, meters };
  return meters;
}

function lookupExcelMeter(meters: Map<string, ExcelMeterRecord>, sayacId: string) {
  const trimmed = String(sayacId ?? "").trim();
  if (!trimmed) return null;
  const exact = meters.get(trimmed);
  if (exact) return { meter: trimmed, ...exact };
  const digits = normDigits(trimmed);
  if (!digits) return null;
  const hit = meters.get(digits);
  if (!hit) return null;
  return { meter: digits, ...hit };
}

function buildBinaEntry(
  binaId: number,
  matches: Array<{
    excel_meter: string;
    sayac_id: string;
    type: string;
    agreement_number: string;
    installation_number: string;
  }>
): UzaktanBinaEntry {
  const by_type: Record<string, number> = {};
  const types: string[] = [];
  for (const m of matches) {
    by_type[m.type] = (by_type[m.type] || 0) + 1;
    if (!types.includes(m.type)) types.push(m.type);
  }
  const sortedTypes = [...types].sort((a, b) => (by_type[b] || 0) - (by_type[a] || 0));
  const primary_type =
    sortedTypes.length === 1 ? sortedTypes[0] : sortedTypes.length > 1 ? "KARMA" : "BILINMIYOR";

  return {
    bina_id: binaId,
    types: sortedTypes,
    primary_type,
    by_type,
    sayac_count: matches.length,
    sayaclar: matches,
  };
}

function indexPath() {
  return path.join(process.cwd(), "data", "uzaktan-sozlesme-index.json");
}

function readIndexFile(): UzaktanSozlesmeIndex {
  const filePath = indexPath();
  if (!existsSync(filePath)) {
    return {
      built_at: "",
      excel_path: "",
      type_colors: UZAKTAN_TYPE_COLORS,
      stats: {
        excel_rows: 0,
        excel_unique_meters: 0,
        excel_by_type: {},
        matched_sayac: 0,
        matched_bina: 0,
        unmatched_excel_meters: 0,
        matched_by_type: {},
      },
      binalar: {},
    };
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as UzaktanSozlesmeIndex;
}

function writeIndex(index: UzaktanSozlesmeIndex) {
  writeFileSync(indexPath(), JSON.stringify(index));
  clearUzaktanIndexCache();
}

function recomputeStats(index: UzaktanSozlesmeIndex) {
  const matched_by_type: Record<string, number> = {};
  let matched_sayac = 0;
  for (const entry of Object.values(index.binalar)) {
    matched_sayac += entry.sayac_count;
    for (const [type, count] of Object.entries(entry.by_type)) {
      matched_by_type[type] = (matched_by_type[type] || 0) + count;
    }
  }
  index.stats.matched_sayac = matched_sayac;
  index.stats.matched_bina = Object.keys(index.binalar).length;
  index.stats.matched_by_type = matched_by_type;
  index.stats.unmatched_excel_meters =
    index.stats.excel_unique_meters - matched_sayac;
}

/** Tek binanın sayaçlarını uzaktan okuma dosyasıyla eşleştirir ve indeksi günceller. */
export function refreshUzaktanForBina(binaId: number): { matched: number; bina_matched: boolean } {
  const excelPath = findExcelPath(readIndexFile().excel_path);
  if (!excelPath) return { matched: 0, bina_matched: false };

  const meters = loadExcelMeters(excelPath);
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  const sayacRows = db
    .prepare(
      `SELECT sayac_id FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id,'')) != ''`
    )
    .all(binaId) as Array<{ sayac_id: string }>;

  const matches: UzaktanBinaEntry["sayaclar"] = [];
  const seen = new Set<string>();

  for (const row of sayacRows) {
    const sayacId = String(row.sayac_id).trim();
    const hit = lookupExcelMeter(meters, sayacId);
    if (!hit) continue;
    const key = normDigits(sayacId) || sayacId;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      excel_meter: hit.meter,
      sayac_id: sayacId,
      type: hit.type,
      agreement_number: hit.agreement_number,
      installation_number: hit.installation_number,
    });
  }

  const index = readIndexFile();
  index.excel_path = excelPath;
  const key = String(binaId);

  if (matches.length > 0) {
    index.binalar[key] = buildBinaEntry(binaId, matches);
  } else {
    delete index.binalar[key];
  }

  recomputeStats(index);
  index.built_at = new Date().toISOString();
  writeIndex(index);

  return { matched: matches.length, bina_matched: matches.length > 0 };
}

/** Tüm veritabanı sayaçlarını uzaktan okuma Excel ile yeniden eşleştirir. */
export function rebuildUzaktanSozlesmeIndex(excelPathArg?: string): UzaktanSozlesmeIndex["stats"] {
  const excelPath = findExcelPath(excelPathArg);
  if (!excelPath) {
    throw new Error("Uzaktan okuma Excel dosyası bulunamadı.");
  }

  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet) as Array<Record<string, unknown>>;

  const meterTypes = new Map<string, ExcelMeterRecord>();
  const excelTypeStats: Record<string, number> = {};

  for (const row of rows) {
    const meter = String(row.meter_number ?? "").trim();
    const type = String(row.value ?? "").trim() || "BILINMIYOR";
    const agreement_number = String(row.agreement_number ?? "").trim();
    const installation_number = String(row.installation_number ?? "").trim();
    if (!meter) continue;
    excelTypeStats[type] = (excelTypeStats[type] || 0) + 1;
    if (!meterTypes.has(meter)) {
      meterTypes.set(meter, { type, agreement_number, installation_number });
    }
  }

  const meters = loadExcelMeters(excelPath);
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  const sayacRows = db
    .prepare(`SELECT sayac_id, bina_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
    .all() as Array<{ sayac_id: string; bina_id: number }>;

  const binaMap = new Map<number, UzaktanBinaEntry["sayaclar"]>();
  const seenByBina = new Map<number, Set<string>>();

  for (const row of sayacRows) {
    const sayacId = String(row.sayac_id).trim();
    const hit = lookupExcelMeter(meters, sayacId);
    if (!hit) continue;

    const dedupeKey = normDigits(sayacId) || sayacId;
    let seen = seenByBina.get(row.bina_id);
    if (!seen) {
      seen = new Set();
      seenByBina.set(row.bina_id, seen);
    }
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    let list = binaMap.get(row.bina_id);
    if (!list) {
      list = [];
      binaMap.set(row.bina_id, list);
    }
    list.push({
      excel_meter: hit.meter,
      sayac_id: sayacId,
      type: hit.type,
      agreement_number: hit.agreement_number,
      installation_number: hit.installation_number,
    });
  }

  const binalar: Record<string, UzaktanBinaEntry> = {};
  for (const [binaId, sayaclar] of binaMap) {
    binalar[String(binaId)] = buildBinaEntry(binaId, sayaclar);
  }

  const matchedTypeStats: Record<string, number> = {};
  let matchedSayac = 0;
  for (const entry of Object.values(binalar)) {
    matchedSayac += entry.sayac_count;
    for (const [type, count] of Object.entries(entry.by_type)) {
      matchedTypeStats[type] = (matchedTypeStats[type] || 0) + count;
    }
  }

  const index: UzaktanSozlesmeIndex = {
    built_at: new Date().toISOString(),
    excel_path: excelPath,
    type_colors: UZAKTAN_TYPE_COLORS,
    stats: {
      excel_rows: rows.length,
      excel_unique_meters: meterTypes.size,
      excel_by_type: excelTypeStats,
      matched_sayac: matchedSayac,
      matched_bina: binaMap.size,
      unmatched_excel_meters: meterTypes.size - matchedSayac,
      matched_by_type: matchedTypeStats,
    },
    binalar,
  };

  writeIndex(index);
  return index.stats;
}

/** Excel yoksa sessizce null döner. */
export function tryRebuildUzaktanSozlesmeIndex(): UzaktanSozlesmeIndex["stats"] | null {
  try {
    return rebuildUzaktanSozlesmeIndex();
  } catch {
    return null;
  }
}
