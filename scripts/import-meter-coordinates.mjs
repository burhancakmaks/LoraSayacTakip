/**
 * Sayaç koordinat Excel + LoRa CSV import.
 * Varsayılan: --dry-run (veritabanına yazmaz).
 *
 *   node scripts/import-meter-coordinates.mjs
 *   node scripts/import-meter-coordinates.mjs --excel "C:/...xlsx"
 *   node scripts/import-meter-coordinates.mjs --excel "C:/...xlsx" --csv "C:/...csv"
 *   node scripts/import-meter-coordinates.mjs --apply --max-nearest-meters 0.5
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { argValue, hasFlag, stampIso } from "./lib/meter-coord-import/common.mjs";
import { emptyCsv, readCoordinateWorkbook, parseCsvDevices, EXCEL_SCHEMA } from "./lib/meter-coord-import/parsers.mjs";
import { buildImportPlan, summarizePlan, DEFAULT_MAX_NEAREST_M } from "./lib/meter-coord-import/plan.mjs";
import { applyPlan, createDbBackup, verifyAfterApply } from "./lib/meter-coord-import/apply.mjs";
import { iterKmlPlacemarks, parseKmlSimpleData } from "./lib/diskapi-geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_EXCEL = "C:/Users/Surface/Downloads/şayaç koordinat.xlsx";
const DEFAULT_KML = "C:/Users/Surface/Downloads/Maks_Bina.kml";
const DB_PATH = join(ROOT, "data/binalar.db");
const BACKUP_DIR = join(ROOT, "data/backups");

function adaParselFromAttrs(d) {
  const block = String(d.building_block ?? "").trim();
  const layout = String(d.building_layout ?? "").trim();
  if (!block) return "";
  if (layout && layout !== "0") return `${block}/${layout}`;
  return block;
}

function loadAdaByBinaId(db, kmlPath) {
  const out = new Map();
  if (!kmlPath || !existsSync(kmlPath)) return out;
  const byKmlId = new Map();
  const text = readFileSync(kmlPath, "utf8");
  for (const xml of iterKmlPlacemarks(text)) {
    const d = parseKmlSimpleData(xml);
    const id = String(d.id ?? "").trim();
    const ada = adaParselFromAttrs(d);
    if (id && ada) byKmlId.set(id, ada);
  }
  for (const row of db.prepare("SELECT id, kml_id FROM binalar WHERE kml_id IS NOT NULL").all()) {
    const ada = byKmlId.get(String(row.kml_id));
    if (ada) out.set(row.id, ada);
  }
  return out;
}

function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}

function currentBranch() {
  const res = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return (res.stdout || "").trim();
}

function writeReports(reportDir, stamp, mode, summary, plan) {
  mkdirSync(reportDir, { recursive: true });
  const prefix = join(reportDir, `${stamp}-${mode}`);
  writeFileSync(`${prefix}-summary.json`, JSON.stringify(summary, null, 2));
  writeFileSync(join(reportDir, `latest-meter-coord-${mode}.json`), JSON.stringify(summary, null, 2));

  const sayacCols = [
    "source_row",
    "meter_number",
    "installation_number",
    "agreement_number",
    "abone_no",
    "value",
    "sayac_markasi",
    "location",
    "crs",
    "source_x",
    "source_y",
    "latitude",
    "longitude",
    "bina_id",
    "bina_value",
    "bina_layer",
    "method",
    "meters",
    "confidence",
    "overlay",
    "action",
    "reason",
    "hitIds",
  ];
  const sayacRows = plan.sayacPlan.map((r) => ({
    ...r,
    hitIds: Array.isArray(r.hitIds) ? r.hitIds.join("|") : "",
  }));
  writeFileSync(`${prefix}-sayac.csv`, toCsv(sayacRows, sayacCols));
  writeFileSync(
    `${prefix}-sayac-skipped.csv`,
    toCsv(
      sayacRows.filter((r) => r.action === "skip"),
      sayacCols
    )
  );
  writeFileSync(
    `${prefix}-sayac-matched.csv`,
    toCsv(
      sayacRows.filter((r) => r.action !== "skip"),
      sayacCols
    )
  );

  const deviceCols = [
    "source_row",
    "deveui",
    "bolge",
    "blok",
    "daire",
    "kat",
    "durum",
    "action",
    "reason",
    "bina_id",
    "sayac_id",
  ];
  writeFileSync(`${prefix}-devices.csv`, toCsv(plan.devicePlan, deviceCols));
  return {
    summary: `${prefix}-summary.json`,
    sayac: `${prefix}-sayac.csv`,
    skipped: `${prefix}-sayac-skipped.csv`,
    matched: `${prefix}-sayac-matched.csv`,
    devices: `${prefix}-devices.csv`,
  };
}

function printSummary(summary, files, extra = {}) {
  console.log("\n=== METER COORD IMPORT ===");
  console.log("mode:", summary.mode);
  console.log("branch:", summary.branch);
  console.log("CRS:", summary.selectedCrs?.code, summary.selectedCrs?.name);
  console.log("Excel:", summary.excelSummary);
  console.log("CSV:", summary.csvSummary);
  console.log("GIS:", summary.gis);
  console.log("DB plan:", summary.dbSummary);
  console.log("Skip reasons:", summary.skipReasons);
  console.log("applyAllowed:", summary.applyAllowed);
  if (summary.stopReasons?.length) console.log("STOP:", summary.stopReasons);
  if (extra.backup) console.log("backup:", extra.backup);
  if (extra.applied) console.log("applied:", extra.applied);
  if (extra.verify) console.log("verify:", extra.verify);
  console.log("reports:", files);
}

function main() {
  const argv = process.argv;
  const apply = hasFlag(argv, "--apply");
  const excelPath = argValue(argv, "--excel") || DEFAULT_EXCEL;
  const kmlPath = argValue(argv, "--kml") || (existsSync(DEFAULT_KML) ? DEFAULT_KML : null);
  const csvExplicit = hasFlag(argv, "--csv");
  const csvPath = argValue(argv, "--csv");
  const reportDir = argValue(argv, "--report-dir") || join(ROOT, "data/import-reports");
  const crs = argValue(argv, "--crs");
  const nearestArg = argValue(argv, "--max-nearest-meters");
  const maxNearestMeters = nearestArg == null ? DEFAULT_MAX_NEAREST_M : Number(nearestArg);
  const expectExcelArg = argValue(argv, "--expect-excel-rows");
  const expectCsvArg = argValue(argv, "--expect-csv-rows");
  const expectExcelRows = expectExcelArg == null ? null : Number(expectExcelArg);
  const expectCsvRows = expectCsvArg == null ? null : Number(expectCsvArg);
  const mode = apply ? "apply" : "dry-run";
  const branch = currentBranch();

  if (!existsSync(excelPath)) {
    console.error("Excel bulunamadı:", excelPath);
    process.exit(1);
  }
  if (csvExplicit && !csvPath) {
    console.error("--csv bir dosya yolu gerektirir");
    process.exit(1);
  }
  if (csvPath && !existsSync(csvPath)) {
    console.error("CSV bulunamadı:", csvPath);
    process.exit(1);
  }
  if (!existsSync(DB_PATH)) {
    console.error("Veritabanı bulunamadı:", DB_PATH);
    process.exit(1);
  }
  if (!Number.isFinite(maxNearestMeters) || maxNearestMeters < 0) {
    console.error("Geçersiz --max-nearest-meters");
    process.exit(1);
  }

  const excel = readCoordinateWorkbook(excelPath);
  const csv = csvPath ? parseCsvDevices(csvPath) : emptyCsv();
  const db = apply ? new DatabaseSync(DB_PATH) : new DatabaseSync(DB_PATH, { readOnly: true });
  const plan = buildImportPlan({
    db,
    excel,
    csv,
    crsCode: crs,
    maxNearestMeters,
    expectExcelRows: Number.isFinite(expectExcelRows) ? expectExcelRows : null,
    expectCsvRows: Number.isFinite(expectCsvRows) ? expectCsvRows : null,
  });
  const stamp = stampIso();
  const summary = {
    mode,
    branch,
    startedAt: new Date().toISOString(),
    excelPath,
    csvPath: csvPath || null,
    excelHash: excel.hash,
    csvHash: csv.hash,
    ...summarizePlan(plan),
  };
  const files = writeReports(reportDir, stamp, mode, summary, plan);
  printSummary(summary, files);

  if (!apply) {
    db.close();
    return;
  }

  if (!plan.applyAllowed) {
    console.error("APPLY DURDURULDU: dry-run kritik kontrolleri geçmedi.");
    db.close();
    process.exit(2);
  }

  db.close();
  const writable = new DatabaseSync(DB_PATH);
  writable.exec("PRAGMA busy_timeout = 15000");
  const backup = createDbBackup(
    DB_PATH,
    BACKUP_DIR,
    excel.schema === EXCEL_SCHEMA.ABONE_LOCATION ? "sayac-xlsx" : "meter-coord"
  );
  let applied;
  try {
    applied = applyPlan(writable, plan, {
      csvName: csvPath ? basename(csvPath) : "",
      csvHash: csv.hash,
      adaByBinaId: loadAdaByBinaId(writable, kmlPath),
    });
  } catch (err) {
    console.error("APPLY HATASI, rollback yapıldı:", err);
    writable.close();
    process.exit(3);
  }
  const verify = verifyAfterApply(writable, plan, applied);
  writable.close();

  const applySummary = { ...summary, backup, applied, verify };
  writeFileSync(files.summary, JSON.stringify(applySummary, null, 2));
  writeFileSync(join(reportDir, "latest-meter-coord-apply.json"), JSON.stringify(applySummary, null, 2));
  printSummary(applySummary, files, { backup, applied, verify });

  if (!verify.ok) {
    console.error("APPLY SONRASI DOĞRULAMA BAŞARISIZ. Yedekten dönün:", backup.backupPath);
    process.exit(4);
  }
}

main();
