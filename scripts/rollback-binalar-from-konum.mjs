/**
 * build-binalar-from-konum.mjs çıktısını geri alır.
 *
 *   node scripts/rollback-binalar-from-konum.mjs
 *   node scripts/rollback-binalar-from-konum.mjs data/konum-sentetik-run-....json
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(ROOT, "data/binalar.db");

function findLatestMeta() {
  const hits = readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("konum-sentetik-run-") && f.endsWith(".json"))
    .sort();
  return hits.length ? join(DATA_DIR, hits[hits.length - 1]) : null;
}

const metaPath = process.argv[2] ? join(ROOT, process.argv[2].replace(/^data[\\/]/, "data/")) : findLatestMeta();

if (!metaPath || !existsSync(metaPath)) {
  console.error("Metadata bulunamadı. Önce build-binalar-from-konum.mjs --apply çalıştırın.");
  process.exit(1);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const db = new DatabaseSync(DB_PATH);

const restoreKonum = db.prepare(
  `UPDATE sayac_konum SET bina_id = ?, match_kaynak = '', updated_at = datetime('now') WHERE id = ?`
);
const restoreSayac = db.prepare(
  `UPDATE sayac SET bina_id = ?, birim_no = ?, updated_at = datetime('now') WHERE id = ?`
);
const delBinaBilgi = db.prepare(`DELETE FROM bina_bilgi WHERE bina_id = ?`);
const delBina = db.prepare(`DELETE FROM binalar WHERE id = ? AND layer LIKE '%KOORDINAT_SENTETIK%'`);

db.exec("BEGIN IMMEDIATE");
try {
  for (const u of meta.sayac_updates || []) {
    restoreSayac.run(u.old_bina_id, u.old_birim_no ?? 1, u.id);
  }
  for (const u of meta.konum_updates || []) {
    restoreKonum.run(u.old_bina_id, u.id);
  }
  for (const id of meta.created_bina_ids || []) {
    delBinaBilgi.run(id);
    delBina.run(id);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(
  JSON.stringify(
    {
      rolled_back: metaPath,
      restored_konum: (meta.konum_updates || []).length,
      restored_sayac: (meta.sayac_updates || []).length,
      deleted_binalar: (meta.created_bina_ids || []).length,
      backup_available: meta.backup,
    },
    null,
    2
  )
);

console.log("\nTam DB geri yüklemek için backup dosyasını binalar.db üzerine kopyalayabilirsiniz.");
