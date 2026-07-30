import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(join(dirname(fileURLToPath(import.meta.url)), "..", "data/binalar.db"));
db.exec("PRAGMA busy_timeout = 15000");

const rows = db
  .prepare(
    `
  SELECT b.id,
    GROUP_CONCAT(DISTINCT CASE
      WHEN s.blok_no GLOB 'DB-*' OR s.blok_no GLOB 'GB-*' OR s.blok_no GLOB 'DC-*'
      THEN s.blok_no END) AS bloks,
    bb.ada_parsel
  FROM binalar b
  LEFT JOIN sayac s ON s.bina_id = b.id
  LEFT JOIN bina_bilgi bb ON bb.bina_id = b.id
  WHERE b.value IS NULL OR TRIM(b.value) = ''
  GROUP BY b.id
`
  )
  .all();

const updates = [];
db.exec("BEGIN IMMEDIATE");
try {
  for (const row of rows) {
    const bloks = String(row.bloks || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    let name;
    if (bloks.length) {
      const blokPart = bloks.join(" / ");
      name = row.ada_parsel ? `${row.ada_parsel} ${blokPart}` : blokPart;
    } else {
      name = `Bina #${row.id}`;
    }
    db.prepare(`UPDATE binalar SET value = ? WHERE id = ?`).run(name, row.id);
    updates.push({ id: row.id, name });
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const remaining = db
  .prepare(`SELECT COUNT(*) c FROM binalar WHERE value IS NULL OR TRIM(value) = ''`)
  .get().c;

console.log(JSON.stringify({ updated: updates.length, remaining, samples: updates.slice(0, 8) }, null, 2));
