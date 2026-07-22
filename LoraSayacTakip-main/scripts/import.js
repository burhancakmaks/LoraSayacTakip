/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_EXCEL_PATH = path.resolve(
  PROJECT_ROOT,
  "..",
  "..",
  "MASKI_Abonelik_Yonetim_Sistemi_NİDANUR_SAHİN_.xlsx",
);
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, "data", "binalar.db");
const DEFAULT_JSON_PATH = path.join(PROJECT_ROOT, "data", "buildings-import.json");
const SHEET_NAME = "Master Veri";

function text(value) {
  return value == null ? "" : String(value).trim();
}

function naturalCompare(left, right) {
  return left.localeCompare(right, "tr", { numeric: true, sensitivity: "base" });
}

function normalizeFloor(value) {
  return text(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStreet(address) {
  return address.match(/(?:Mah\.?)\s+(.+?)(?=\s+(?:Dış\s*Kapı\s*No|No)\s*:|,)/iu)?.[1]?.trim() || address;
}

function extractDoorNumber(address) {
  return address.match(/(?:Dış\s*Kapı\s*No|Kapı\s*No|No)\s*:?\s*([\p{L}\d/-]+)/iu)?.[1] || "";
}

function normalizeRow(row, excelRow) {
  return {
    excelRow,
    ada: text(row.Ada),
    blok: text(row.Blok) || extractDoorNumber(text(row.Adres)),
    kat: text(row.Kat),
    daire: text(row.Daire),
    adSoyad: text(row["Ad Soyad"]),
    aboneNo: text(row["Abone No"]),
    sayacNo: text(row["Sayaç No"]),
    adres: text(row.Adres),
    mahalle: text(row.Mahalle),
    disKapiNo: extractDoorNumber(text(row.Adres)),
  };
}

function groupRows(rows) {
  const groups = new Map();

  for (const row of rows) {
    if (!row.ada || !row.blok) continue;
    const key = `${row.ada.toLocaleUpperCase("tr-TR")}::${row.blok.toLocaleUpperCase("tr-TR")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  return [...groups.values()].map((buildingRows) => {
    const first = buildingRows[0];
    const katlar = [...new Set(buildingRows.map((row) => normalizeFloor(row.kat)).filter(Boolean))].sort(naturalCompare);
    const daireler = [...new Set(buildingRows.map((row) => row.daire).filter(Boolean))].sort(naturalCompare);
    const abonelikler = buildingRows.map((row) => ({
      excelRow: row.excelRow,
      kat: row.kat,
      daire: row.daire,
      adSoyad: row.adSoyad,
      aboneNo: row.aboneNo,
      sayacNo: row.sayacNo,
    }));

    return {
      ada: first.ada,
      blok: first.blok,
      disKapiNo: buildingRows.find((row) => row.disKapiNo)?.disKapiNo || "",
      adres: buildingRows.find((row) => row.adres)?.adres || "",
      mahalle: buildingRows.find((row) => row.mahalle)?.mahalle || "",
      katSayisi: katlar.length,
      katlar,
      toplamDaireSayisi: daireler.length,
      daireler,
      toplamKayitSayisi: abonelikler.length,
      abonelikler,
    };
  });
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ada TEXT NOT NULL,
      blok TEXT NOT NULL,
      dis_kapi_no TEXT NOT NULL DEFAULT '',
      adres TEXT NOT NULL DEFAULT '',
      mahalle TEXT NOT NULL DEFAULT '',
      kat_sayisi INTEGER NOT NULL DEFAULT 0,
      katlar_json TEXT NOT NULL DEFAULT '[]',
      daire_sayisi INTEGER NOT NULL DEFAULT 0,
      daireler_json TEXT NOT NULL DEFAULT '[]',
      abonelikler_json TEXT NOT NULL DEFAULT '[]',
      toplam_kayit_sayisi INTEGER NOT NULL DEFAULT 0,
      source_file TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ada, blok)
    );
    CREATE INDEX IF NOT EXISTS idx_imported_buildings_door
      ON imported_buildings(ada, dis_kapi_no);
  `);
}

function saveToDatabase(buildings, sourceFile, dbPath) {
  const db = new DatabaseSync(dbPath);
  ensureTables(db);
  const upsert = db.prepare(`
    INSERT INTO imported_buildings (
      ada, blok, dis_kapi_no, adres, mahalle, kat_sayisi, katlar_json,
      daire_sayisi, daireler_json, abonelikler_json, toplam_kayit_sayisi,
      source_file, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ada, blok) DO UPDATE SET
      dis_kapi_no=excluded.dis_kapi_no, adres=excluded.adres,
      mahalle=excluded.mahalle, kat_sayisi=excluded.kat_sayisi,
      katlar_json=excluded.katlar_json, daire_sayisi=excluded.daire_sayisi,
      daireler_json=excluded.daireler_json,
      abonelikler_json=excluded.abonelikler_json,
      toplam_kayit_sayisi=excluded.toplam_kayit_sayisi,
      source_file=excluded.source_file, imported_at=datetime('now')
  `);
  const findMapBuilding = db.prepare(`
    SELECT bina_id FROM excel_abonelikler
    WHERE ada = ? COLLATE NOCASE AND blok = ? COLLATE NOCASE AND bina_id IS NOT NULL
    GROUP BY bina_id ORDER BY COUNT(*) DESC LIMIT 1
  `);
  const upsertBuildingInfo = db.prepare(`
    INSERT INTO bina_bilgi (
      bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, has_zemin,
      ada_parsel, sokak, dis_kapi_no, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(bina_id) DO UPDATE SET
      kat_sayisi=excluded.kat_sayisi,
      daire_sayisi=excluded.daire_sayisi,
      has_zemin=excluded.has_zemin,
      ada_parsel=excluded.ada_parsel,
      sokak=excluded.sokak,
      dis_kapi_no=excluded.dis_kapi_no,
      updated_at=datetime('now')
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const building of buildings) {
      upsert.run(
        building.ada,
        building.blok,
        building.disKapiNo,
        building.adres,
        building.mahalle,
        building.katSayisi,
        JSON.stringify(building.katlar),
        building.toplamDaireSayisi,
        JSON.stringify(building.daireler),
        JSON.stringify(building.abonelikler),
        building.toplamKayitSayisi,
        sourceFile,
      );

      const match = findMapBuilding.get(building.ada, building.blok);
      if (match?.bina_id) {
        upsertBuildingInfo.run(
          match.bina_id,
          building.katSayisi,
          building.toplamDaireSayisi,
          building.katlar.some((floor) => floor.includes("ZEMİN")) ? 1 : 0,
          building.ada,
          extractStreet(building.adres),
          building.disKapiNo || building.blok,
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

async function main() {
  const excelPath = path.resolve(process.argv[2] || process.env.MASKI_EXCEL_PATH || DEFAULT_EXCEL_PATH);
  const dbPath = path.resolve(process.env.MASKI_DB_PATH || DEFAULT_DB_PATH);
  const jsonPath = path.resolve(process.env.MASKI_JSON_PATH || DEFAULT_JSON_PATH);

  const file = await fs.readFile(excelPath);
  const workbook = XLSX.read(file, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Excel sayfası bulunamadı: ${SHEET_NAME}`);

  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  const rows = rawRows.map((row, index) => normalizeRow(row, index + 2));
  const buildings = groupRows(rows);
  const payload = {
    metadata: { sourceFile: path.basename(excelPath), sheet: SHEET_NAME, importedAt: new Date().toISOString() },
    summary: { sourceRows: rows.length, importedBuildings: buildings.length },
    buildings,
  };

  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  saveToDatabase(buildings, path.basename(excelPath), dbPath);
  console.log(JSON.stringify({ ...payload.summary, jsonPath, dbPath }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
