import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data/binalar.db"));
const rows = db.prepare(`
  SELECT b.value, s.blok_no, s.kapi_no, s.kullanilis_sekli, s.sayac_id, s.sayac_durum
  FROM sayac s JOIN binalar b ON b.id = s.bina_id
  WHERE COALESCE(s.sayac_durum, 'gecerli') IN ('okunmadi', 'hatali', 'eksik')
  ORDER BY s.sayac_durum, b.value
`).all();
console.log(JSON.stringify(rows, null, 2));
console.log("---");
console.log(db.prepare(`
  SELECT COALESCE(sayac_durum,'gecerli') d, COUNT(*) c FROM sayac
  WHERE COALESCE(sayac_durum,'gecerli') IN ('okunmadi','hatali','eksik') GROUP BY d
`).all());
