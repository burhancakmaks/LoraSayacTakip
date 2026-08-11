import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const stats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM sayac) AS toplam_kayit,
    (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS numarali,
    (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) = '') AS numarasiz,
    (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS aboneli,
    (SELECT COUNT(*) FROM sayac WHERE bina_id IS NULL) AS bina_bagsiz,
    (SELECT COUNT(*) FROM sayac s LEFT JOIN binalar b ON s.bina_id=b.id WHERE s.bina_id IS NOT NULL AND b.id IS NULL) AS yetim,
    (SELECT COUNT(*) FROM sayac s INNER JOIN binalar b ON s.bina_id=b.id) AS haritada_bagli,
    (SELECT COUNT(DISTINCT bina_id) FROM sayac) AS sayacli_bina,
    (SELECT COUNT(*) FROM binalar b WHERE NOT EXISTS (SELECT 1 FROM sayac s WHERE s.bina_id=b.id)) AS sayacsiz_bina,
    (SELECT COUNT(*) FROM bina_bilgi) AS yapilandirilmis_bina
`).get();

const durum = db.prepare(`
  SELECT COALESCE(sayac_durum,'gecerli') AS d, COUNT(*) c
  FROM sayac GROUP BY d ORDER BY c DESC
`).all();

const binaBilgiSayac = db.prepare(`
  SELECT
    SUM(bb.toplam_bagımsız_bolum) AS beklenen_birim,
    (SELECT COUNT(*) FROM sayac s WHERE s.bina_id IN (SELECT bina_id FROM bina_bilgi)) AS kayitli_birim
  FROM bina_bilgi bb
`).get();

console.log(JSON.stringify({ stats, durum, binaBilgiSayac }, null, 2));
