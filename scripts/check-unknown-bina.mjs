import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data/binalar.db"));

const unknownBinalar = db.prepare(`
  SELECT b.id, b.value, b.layer, b.oda_id,
    COUNT(s.id) AS sayac_sayisi,
    SUM(CASE WHEN COALESCE(s.sayac_durum,'gecerli')='eksik' THEN 1 ELSE 0 END) AS eksik,
    SUM(CASE WHEN COALESCE(s.sayac_durum,'gecerli')='okunmadi' THEN 1 ELSE 0 END) AS okunmadi
  FROM binalar b
  JOIN sayac s ON s.bina_id = b.id
  WHERE b.value IS NULL OR TRIM(b.value) = ''
  GROUP BY b.id
  ORDER BY sayac_sayisi DESC
`).all();

const withBlok = db.prepare(`
  SELECT DISTINCT b.id, b.value, s.blok_no, bb.sokak, bb.ada_parsel
  FROM binalar b
  JOIN sayac s ON s.bina_id = b.id
  LEFT JOIN bina_bilgi bb ON bb.bina_id = b.id
  WHERE (b.value IS NULL OR TRIM(b.value) = '')
    AND (s.blok_no GLOB 'DB-*' OR s.blok_no GLOB 'GB-*' OR s.blok_no GLOB 'DC-*')
  ORDER BY s.blok_no
`).all();

console.log(JSON.stringify({ unknown_count: unknownBinalar.length, binalar: unknownBinalar, blok_detail: withBlok }, null, 2));
