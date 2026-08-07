/**
 * Uzaktan okuma sözleşme Excel → harita eşleştirme indeksi.
 * Çıktı: data/uzaktan-sozlesme-index.json
 */
import { writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "data", "uzaktan-sozlesme-index.json");
const SEARCH_DIRS = ["C:/Users/Surface/Downloads", join(ROOT, "data")];

const EXPLICIT_EXCEL =
  "C:/Users/Surface/Downloads/uzaktan okuma sözleşme.xlsx";

const TYPE_COLORS = {
  BAYLAN_LORA_W: "#7c3aed",
  POLIMETER_LORA_W: "#ea580c",
  "BRT METER LORA": "#0891b2",
};

function findExcel() {
  if (existsSync(EXPLICIT_EXCEL)) return EXPLICIT_EXCEL;
  const candidates = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const lower = f.toLocaleLowerCase("tr-TR");
      if (lower.includes("uzaktan") && lower.includes("okuma") && /xlsx?$/i.test(f)) {
        candidates.push(join(dir, f));
      }
    }
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function normDigits(v) {
  return String(v ?? "")
    .trim()
    .replace(/\D/g, "");
}

function resolveExcelPath() {
  const fromArg = process.argv[2];
  if (fromArg && existsSync(fromArg)) return fromArg;
  return findExcel();
}

function loadSayacIndex(db) {
  const rows = db
    .prepare(
      "SELECT sayac_id, bina_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''"
    )
    .all();

  const byExact = new Map();
  const byDigits = new Map();

  for (const r of rows) {
    const id = String(r.sayac_id).trim();
    const digits = normDigits(id);
    byExact.set(id, { bina_id: r.bina_id, sayac_id: id });
    if (digits && !byDigits.has(digits)) {
      byDigits.set(digits, { bina_id: r.bina_id, sayac_id: id });
    }
  }

  return { byExact, byDigits };
}

function matchSayac(meter, sayacIndex) {
  const trimmed = String(meter).trim();
  const digits = normDigits(trimmed);
  const exact = sayacIndex.byExact.get(trimmed);
  if (exact) return exact;
  if (digits) return sayacIndex.byDigits.get(digits) ?? null;
  return null;
}

function build() {
  const excelPath = resolveExcelPath();
  if (!excelPath) {
    console.error("Excel dosyası bulunamadı. Downloads klasörüne koyun veya yol verin.");
    process.exit(1);
  }

  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const meterTypes = new Map();
  const excelTypeStats = {};

  for (const r of rows) {
    const meter = String(r.meter_number ?? "").trim();
    const type = String(r.value ?? "").trim() || "BILINMIYOR";
    const agreement_number = String(r.agreement_number ?? "").trim();
    const installation_number = String(r.installation_number ?? "").trim();
    if (!meter) continue;
    excelTypeStats[type] = (excelTypeStats[type] || 0) + 1;
    if (!meterTypes.has(meter)) {
      meterTypes.set(meter, { type, agreement_number, installation_number });
    }
  }

  const db = new DatabaseSync(join(ROOT, "data", "binalar.db"));
  const sayacIndex = loadSayacIndex(db);

  const binaMap = new Map();
  let matchedSayac = 0;
  const matchedTypeStats = {};

  for (const [meter, record] of meterTypes) {
    const type = record.type;
    const hit = matchSayac(meter, sayacIndex);
    if (!hit) continue;

    matchedSayac++;
    matchedTypeStats[type] = (matchedTypeStats[type] || 0) + 1;

    let entry = binaMap.get(hit.bina_id);
    if (!entry) {
      entry = {
        bina_id: hit.bina_id,
        types: [],
        by_type: {},
        sayac_count: 0,
        sayaclar: [],
      };
      binaMap.set(hit.bina_id, entry);
    }

    entry.sayac_count++;
    entry.by_type[type] = (entry.by_type[type] || 0) + 1;
    if (!entry.types.includes(type)) entry.types.push(type);
    entry.sayaclar.push({
      excel_meter: meter,
      sayac_id: hit.sayac_id,
      type,
      agreement_number: record.agreement_number,
      installation_number: record.installation_number,
    });
  }

  const binalar = {};
  for (const [binaId, entry] of binaMap) {
    const sortedTypes = [...entry.types].sort(
      (a, b) => (entry.by_type[b] || 0) - (entry.by_type[a] || 0)
    );
    const primaryType =
      sortedTypes.length === 1
        ? sortedTypes[0]
        : sortedTypes.length > 1
          ? "KARMA"
          : "BILINMIYOR";

    binalar[binaId] = {
      bina_id: binaId,
      types: sortedTypes,
      primary_type: primaryType,
      by_type: entry.by_type,
      sayac_count: entry.sayac_count,
      sayaclar: entry.sayaclar,
    };
  }

  const index = {
    built_at: new Date().toISOString(),
    excel_path: excelPath,
    type_colors: TYPE_COLORS,
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

  writeFileSync(OUT_PATH, JSON.stringify(index));
  console.log("Yazıldı:", OUT_PATH);
  console.log("Excel:", excelPath);
  console.log("Eşleşen sayaç:", matchedSayac, "/", meterTypes.size);
  console.log("Eşleşen bina:", binaMap.size);
  console.log("Tipler (eşleşen):", matchedTypeStats);
}

build();
