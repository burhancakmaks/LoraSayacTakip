import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const q = (sql) => db.prepare(sql).get();

const stats = {
  toplam_sayac: q("SELECT COUNT(*) AS c FROM sayac").c,
  toplam_bina: q("SELECT COUNT(*) AS c FROM binalar").c,
  sayac_bina_bagli: q("SELECT COUNT(*) AS c FROM sayac WHERE bina_id IS NOT NULL").c,
  sayac_bina_bagsiz: q("SELECT COUNT(*) AS c FROM sayac WHERE bina_id IS NULL").c,
  sayac_gecerli_binada: q(
    "SELECT COUNT(*) AS c FROM sayac s INNER JOIN binalar b ON s.bina_id = b.id"
  ).c,
  sayac_yetim_bina: q(
    "SELECT COUNT(*) AS c FROM sayac s LEFT JOIN binalar b ON s.bina_id = b.id WHERE s.bina_id IS NOT NULL AND b.id IS NULL"
  ).c,
  sayac_numarali: q(
    "SELECT COUNT(*) AS c FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''"
  ).c,
  sayac_numarasiz: q(
    "SELECT COUNT(*) AS c FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) = ''"
  ).c,
  bina_sayacli: q(
    "SELECT COUNT(DISTINCT bina_id) AS c FROM sayac WHERE bina_id IS NOT NULL"
  ).c,
  bina_sayacsiz: q(
    "SELECT COUNT(*) AS c FROM binalar b WHERE NOT EXISTS (SELECT 1 FROM sayac s WHERE s.bina_id = b.id)"
  ).c,
  harita_numarali_sayac_toplami: q(`
    SELECT COALESCE(SUM(cnt), 0) AS c FROM (
      SELECT COUNT(*) AS cnt FROM sayac s
      INNER JOIN binalar b ON s.bina_id = b.id
      WHERE TRIM(COALESCE(s.sayac_id,'')) != ''
      GROUP BY s.bina_id
    )
  `).c,
  // sum per building like API does
  harita_aktif_abone_toplami: q(`
    SELECT COALESCE(SUM(
      CASE WHEN sc.cnt > 0 THEN sc.cnt ELSE COALESCE(b.aktif_abone_sayisi, 0) END
    ), 0) AS c
    FROM binalar b
    LEFT JOIN (
      SELECT bina_id, COUNT(*) AS cnt FROM sayac
      WHERE TRIM(COALESCE(sayac_id,'')) != ''
      GROUP BY bina_id
    ) sc ON sc.bina_id = b.id
  `).c,
};

console.log(JSON.stringify(stats, null, 2));
