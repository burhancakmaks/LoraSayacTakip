import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const db = new DatabaseSync(path.join(root, "data", "binalar.db"));

const maski = JSON.parse(
  readFileSync(path.join(root, "data", "maski-arama-index.json"), "utf8")
);

function normSayac(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

const dbRows = db
  .prepare(
    `SELECT sayac_id, abone_no FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`
  )
  .all();

const dbSayacSet = new Set(dbRows.map((r) => normSayac(r.sayac_id)).filter(Boolean));
const dbAboneSet = new Set(
  dbRows.map((r) => String(r.abone_no ?? "").trim()).filter(Boolean)
);

const maskiRecords = maski.records || [];
const maskiSayacSet = new Set(
  maskiRecords.map((r) => normSayac(r.sayac_no)).filter(Boolean)
);
const maskiAboneSet = new Set(
  maskiRecords.map((r) => String(r.abone_no ?? "").trim()).filter(Boolean)
);

const onlyDb = [...dbSayacSet].filter((s) => !maskiSayacSet.has(s));
const onlyMaski = [...maskiSayacSet].filter((s) => !dbSayacSet.has(s));
const both = [...dbSayacSet].filter((s) => maskiSayacSet.has(s));

const unionSayac = new Set([...dbSayacSet, ...maskiSayacSet]);

const dbStats = db
  .prepare(
    `
    SELECT
      COUNT(*) AS toplam_kayit,
      SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS numarali,
      SUM(CASE WHEN TRIM(COALESCE(abone_no,'')) != '' THEN 1 ELSE 0 END) AS aboneli
    FROM sayac
  `
  )
  .get();

console.log(
  JSON.stringify(
    {
      veritabani: {
        toplam_kayit: dbStats.toplam_kayit,
        numarali_sayac: dbStats.numarali,
        abone_nolu: dbStats.aboneli,
        benzersiz_sayac_no: dbSayacSet.size,
      },
      maski_excel: {
        toplam_kayit: maski.total ?? maskiRecords.length,
        benzersiz_sayac_no: maskiSayacSet.size,
        abone_nolu: maskiAboneSet.size,
      },
      birlikte: {
        her_ikisinde_ortak: both.length,
        sadece_veritabaninda: onlyDb.length,
        sadece_excelde: onlyMaski.length,
        toplam_benzersiz_sayac: unionSayac.size,
        toplam_ham_kayit: dbStats.numarali + (maski.total ?? maskiRecords.length),
      },
    },
    null,
    2
  )
);
