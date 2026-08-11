import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const db = new DatabaseSync(path.join(root, "data", "binalar.db"));

const maski = JSON.parse(
  readFileSync(path.join(root, "data", "maski-arama-index.json"), "utf8")
);

const maskiRecords = maski.records || [];
const maskiWithAdres = maskiRecords.filter((r) => String(r.adres || "").trim() !== "");
const maskiWithSayac = maskiRecords.filter((r) => String(r.sayac_no || r.sayac_id || "").trim() !== "");
const maskiWithAbone = maskiRecords.filter((r) => String(r.abone_no || "").trim() !== "");

const dbSayac = db.prepare(`
  SELECT
    COUNT(*) AS toplam_kayit,
    SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS numarali,
    SUM(CASE WHEN TRIM(COALESCE(abone_no,'')) != '' THEN 1 ELSE 0 END) AS aboneli
  FROM sayac
`).get();

let binaBilgi = { yapilandirilmis: 0, sokakli: 0 };
try {
  binaBilgi = db.prepare(`
    SELECT
      COUNT(*) AS yapilandirilmis,
      SUM(CASE WHEN TRIM(COALESCE(sokak,'')) != '' THEN 1 ELSE 0 END) AS sokakli
    FROM bina_bilgi
  `).get();
} catch {
  // table may not exist
}

console.log(
  JSON.stringify(
    {
      maski_excel_index: {
        toplam_kayit: maski.total ?? maskiRecords.length,
        adres_dolu: maskiWithAdres.length,
        sayac_nolu: maskiWithSayac.length,
        abone_nolu: maskiWithAbone.length,
        kaynak_dagilimi: maski.stats || {},
      },
      veritabani: {
        toplam_sayac_kaydi: dbSayac.toplam_kayit,
        numarali_sayac: dbSayac.numarali,
        abone_nolu: dbSayac.aboneli,
      },
      bina_adres_bilgisi: binaBilgi,
    },
    null,
    2
  )
);
