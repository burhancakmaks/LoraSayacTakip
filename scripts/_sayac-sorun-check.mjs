import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("data/binalar.db");
const emptySayac = db.prepare(`SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,''))=''`).get().c;
const binaWithEmpty = db.prepare(`
  SELECT b.id, b.value,
    SUM(CASE WHEN TRIM(COALESCE(s.sayac_id,''))='' THEN 1 ELSE 0 END) empty,
    COUNT(s.id) total
  FROM binalar b JOIN sayac s ON s.bina_id=b.id
  GROUP BY b.id HAVING empty>0
  ORDER BY empty DESC LIMIT 8
`).all();
console.log(JSON.stringify({ emptySayac, binaWithEmpty }, null, 2));
