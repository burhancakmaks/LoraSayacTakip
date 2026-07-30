import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";

// G1/G2 kompleksinde verili binanin ustunu kapatan bos kopyalar
const TARGETS = [1789, 4572, 1786, 4576, 1785, 4575, 1792, 4578, 1802, 4581, 190, 4573];

const db = new DatabaseSync("data/binalar.db");
const guard = db.prepare(`
  SELECT bina_id, COUNT(*) c FROM sayac
  WHERE bina_id IN (${TARGETS.join(",")}) AND TRIM(COALESCE(sayac_id,''))!=''
  GROUP BY bina_id
`).all();
if (guard.length) {
  console.error("DURDURULDU:", guard);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = `data/binalar.before-g-cluster-dupes-${stamp}.db`;
copyFileSync("data/binalar.db", backup);

db.exec("BEGIN");
db.prepare(`DELETE FROM sayac WHERE bina_id IN (${TARGETS.join(",")})`).run();
db.prepare(`DELETE FROM bina_bilgi WHERE bina_id IN (${TARGETS.join(",")})`).run();
const r = db.prepare(`DELETE FROM binalar WHERE id IN (${TARGETS.join(",")})`).run();
db.exec("COMMIT");

console.log("Silinen bos kopya:", r.changes);
console.log("Yedek:", backup);
