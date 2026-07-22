/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = path.join(__dirname, "..", "data", "binalar.db");
const db = new DatabaseSync(dbPath);

const MAP_BUILDING_ID = 1998;
const IMPORT_BUILDING_ID = 4990;
const TEMP_BUILDING_ID = -1998;

function count(table, binaId) {
  return Number(
    db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE bina_id = ?`).get(binaId).count,
  );
}

const before = {
  mapExcel: count("excel_abonelikler", MAP_BUILDING_ID),
  importExcel: count("excel_abonelikler", IMPORT_BUILDING_ID),
  mapMeters: count("sayac", MAP_BUILDING_ID),
  importMeters: count("sayac", IMPORT_BUILDING_ID),
};

const needsSwap = before.mapExcel === 21 && before.importExcel === 22;
const alreadyFixed = before.mapExcel === 22 && before.importExcel === 21;

if (!needsSwap && !alreadyFixed) {
  throw new Error(`Beklenmeyen DB-25 kayıtları: ${JSON.stringify(before)}`);
}

db.exec("BEGIN IMMEDIATE");
try {
  if (needsSwap) {
    for (const table of ["excel_abonelikler", "sayac"]) {
      db.prepare(`UPDATE ${table} SET bina_id = ? WHERE bina_id = ?`).run(
        TEMP_BUILDING_ID,
        MAP_BUILDING_ID,
      );
      db.prepare(`UPDATE ${table} SET bina_id = ? WHERE bina_id = ?`).run(
        MAP_BUILDING_ID,
        IMPORT_BUILDING_ID,
      );
      db.prepare(`UPDATE ${table} SET bina_id = ? WHERE bina_id = ?`).run(
        IMPORT_BUILDING_ID,
        TEMP_BUILDING_ID,
      );
    }
  }

  // The workbook stores the stage name in `ada`; the address contains the
  // actual map identifier "4.ETAP ADA-06" used by the building popup/search.
  db.prepare(`
    UPDATE excel_abonelikler
    SET ada = '06'
    WHERE bina_id = ? AND blok = 'DB-25'
  `).run(MAP_BUILDING_ID);

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(alreadyFixed ? "06 / DB-25 eşleştirmesi zaten doğruydu; ada adı güncellendi." : "06 / DB-25 eşleştirmesi düzeltildi.");
console.log(before);
