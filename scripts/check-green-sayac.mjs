import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const binaStats = db
  .prepare(
    `
  SELECT
    COUNT(DISTINCT s.bina_id) AS sayacli_bina,
    COUNT(DISTINCT CASE WHEN bb.bina_id IS NOT NULL THEN s.bina_id END) AS yesil_sayacli_bina,
    COUNT(DISTINCT CASE WHEN bb.bina_id IS NULL THEN s.bina_id END) AS mavi_sayacli_bina
  FROM (SELECT DISTINCT bina_id FROM sayac) s
  LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
`
  )
  .get();

const sayacStats = db
  .prepare(
    `
  SELECT
    SUM(CASE WHEN bb.bina_id IS NOT NULL THEN 1 ELSE 0 END) AS sayac_yesil_binada,
    SUM(CASE WHEN bb.bina_id IS NULL THEN 1 ELSE 0 END) AS sayac_mavi_binada
  FROM sayac s
  LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
`
  )
  .get();

const yesilToplam = db
  .prepare(
    `SELECT COUNT(*) AS c FROM binalar b WHERE EXISTS (SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id)`
  )
  .get().c;

const yesilSayacsiz = db
  .prepare(
    `
  SELECT COUNT(*) AS c FROM binalar b
  WHERE EXISTS (SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM sayac s WHERE s.bina_id = b.id)
`
  )
  .get().c;

console.log(
  JSON.stringify(
    {
      ...binaStats,
      ...sayacStats,
      toplam_yesil_bina: yesilToplam,
      yesil_ama_sayacsiz_bina: yesilSayacsiz,
    },
    null,
    2
  )
);
