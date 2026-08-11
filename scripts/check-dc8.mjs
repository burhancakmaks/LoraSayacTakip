import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const binalar = db
  .prepare(
    `SELECT id, value, length(coordinates) as clen FROM binalar
     WHERE UPPER(value) LIKE '%DC8%' OR UPPER(value) LIKE '%C08%' OR UPPER(value) LIKE '%46 ADA%'`
  )
  .all();

const sayacBlok = db
  .prepare(`SELECT DISTINCT bina_id, blok_no FROM sayac WHERE blok_no LIKE '%DC8%' LIMIT 30`)
  .all();

for (const row of sayacBlok) {
  const b = db.prepare("SELECT id, value FROM binalar WHERE id = ?").get(row.bina_id);
  const bilgi = db.prepare("SELECT 1 as x FROM bina_bilgi WHERE bina_id = ?").get(row.bina_id);
  const sc = db
    .prepare(
      "SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''"
    )
    .get(row.bina_id);
  row.building = b;
  row.green = !!(bilgi || (sc?.c ?? 0) > 0);
  row.sayac_count = sc?.c ?? 0;
}

console.log(JSON.stringify({ binalar, sayacBlok }, null, 2));
