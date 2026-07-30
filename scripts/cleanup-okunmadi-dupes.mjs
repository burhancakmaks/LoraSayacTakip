import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data/binalar.db"));

const dupes = db
  .prepare(
    `
    SELECT bina_id, kapi_no, kullanilis_sekli, GROUP_CONCAT(id) AS ids, COUNT(*) AS c
    FROM sayac
    WHERE sayac_id = 'OKUNMADI'
    GROUP BY bina_id, kapi_no, kullanilis_sekli
    HAVING c > 1
  `
  )
  .all();

let removed = 0;
const del = db.prepare("DELETE FROM sayac WHERE id = ?");
for (const row of dupes) {
  const ids = String(row.ids)
    .split(",")
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of ids.slice(1)) {
    del.run(id);
    removed++;
  }
}

console.log(JSON.stringify({ duplicate_groups: dupes.length, removed }, null, 2));
