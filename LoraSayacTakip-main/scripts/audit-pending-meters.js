/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "..", "data", "binalar.db"), {
  readOnly: true,
});

const rows = db.prepare(`
  SELECT e.kaynak_dosya, e.ada, e.blok, e.mahalle,
    CASE WHEN TRIM(e.adres) = '' THEN '(adres boş)' ELSE e.adres END AS adres,
    e.bina_id, b.value AS bina_adi,
    COUNT(*) AS sayac_sayisi,
    GROUP_CONCAT(DISTINCT e.sayac_no) AS sayac_numaralari
  FROM excel_abonelikler e
  LEFT JOIN binalar b ON b.id = e.bina_id
  WHERE LENGTH(TRIM(e.sayac_no)) >= 5
    AND TRIM(e.sayac_no) NOT GLOB '*[^0-9]*'
    AND (e.bina_id IS NULL OR b.layer = 'MASKI_EXCEL_ABONELIK_YAKLASIK')
  GROUP BY e.kaynak_dosya, e.ada, e.blok, e.mahalle, e.adres, e.bina_id, b.value
  ORDER BY e.kaynak_dosya, e.ada, e.blok, e.adres
`).all();

console.log(JSON.stringify(rows, null, 2));
db.close();
