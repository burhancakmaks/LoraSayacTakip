/**
 * Sayaç kaydı olan binalara bina_bilgi yazar / günceller.
 * Kat, sokak, kapı uydurulmaz. daire_sayisi = kayıtlı sayaç sayısı (mevcut daha büyükse korunur).
 *
 *   node scripts/fill-bina-bilgi-from-sayac.mjs
 *   node scripts/fill-bina-bilgi-from-sayac.mjs --apply
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const APPLY = process.argv.includes("--apply");

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS bina_bilgi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bina_id INTEGER NOT NULL UNIQUE,
    kat_sayisi INTEGER NOT NULL DEFAULT 0,
    daire_sayisi INTEGER NOT NULL DEFAULT 0,
    ortak_alan_sayisi INTEGER NOT NULL DEFAULT 0,
    toplam_bagımsız_bolum INTEGER NOT NULL DEFAULT 0,
    has_zemin INTEGER NOT NULL DEFAULT 0,
    ada_parsel TEXT DEFAULT '',
    sokak TEXT DEFAULT '',
    dis_kapi_no TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN daire_sayisi INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN has_zemin INTEGER DEFAULT 0`); } catch {}

const stats = db
  .prepare(
    `SELECT
       s.bina_id,
       COUNT(*) AS sayac_kayit,
       SUM(CASE WHEN TRIM(COALESCE(s.sayac_id,'')) != '' THEN 1 ELSE 0 END) AS sayac_count,
       MAX(s.birim_no) AS max_birim,
       bb.daire_sayisi,
       bb.ortak_alan_sayisi,
       bb.toplam_bagımsız_bolum AS toplam,
       bb.kat_sayisi,
       bb.has_zemin,
       bb.bina_id AS has_bilgi
     FROM sayac s
     LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
     GROUP BY s.bina_id
     HAVING sayac_count > 0`
  )
  .all();

const inserts = [];
const updates = [];
const keep = [];

for (const row of stats) {
  const needed = Math.max(Number(row.sayac_count) || 0, Number(row.max_birim) || 0);
  if (needed <= 0) continue;
  const ortak = Number(row.ortak_alan_sayisi) || 0;
  const currentDaire = Number(row.daire_sayisi) || 0;
  const currentToplam = Number(row.toplam) || 0;
  const daire = Math.max(currentDaire, needed);
  const toplam = Math.max(currentToplam, daire + ortak, needed);

  if (!row.has_bilgi) {
    inserts.push({
      bina_id: row.bina_id,
      daire_sayisi: needed,
      toplam,
      has_zemin: 1,
      sayac_count: row.sayac_count,
    });
    continue;
  }

  const needsDaire = currentDaire < needed;
  const needsToplam = currentToplam < toplam;
  if (needsDaire || needsToplam) {
    updates.push({
      bina_id: row.bina_id,
      daire_sayisi: daire,
      toplam,
      sayac_count: row.sayac_count,
      from_daire: currentDaire,
      from_toplam: currentToplam,
    });
  } else {
    keep.push(row.bina_id);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const report = {
  mode: APPLY ? "apply" : "dry-run",
  generated_at: new Date().toISOString(),
  buildings_with_meters: stats.length,
  insert_count: inserts.length,
  update_count: updates.length,
  keep_count: keep.length,
  sample_inserts: inserts.slice(0, 8),
  sample_updates: updates.slice(0, 8),
};

const outDir = join(ROOT, "data/import-reports");
mkdirSync(outDir, { recursive: true });

if (!APPLY) {
  writeFileSync(join(outDir, "latest-fill-bina-bilgi-dry-run.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("\nUygulamak için: node scripts/fill-bina-bilgi-from-sayac.mjs --apply");
  db.close();
  process.exit(0);
}

const backupDir = join(ROOT, "data/backups");
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, `binalar.before-fill-bina-bilgi-${stamp}.db`);
copyFileSync(DB_PATH, backup);
report.backup = backup.replace(/\\/g, "/");

const insertStmt = db.prepare(`
  INSERT INTO bina_bilgi (
    bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
    has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
  ) VALUES (?, 0, ?, 0, ?, 1, '', '', '', datetime('now'))
`);
const updateStmt = db.prepare(`
  UPDATE bina_bilgi
  SET daire_sayisi = ?,
      toplam_bagımsız_bolum = ?,
      has_zemin = CASE WHEN kat_sayisi = 0 AND has_zemin = 0 THEN 1 ELSE has_zemin END,
      updated_at = datetime('now')
  WHERE bina_id = ?
`);

db.exec("BEGIN");
try {
  for (const row of inserts) insertStmt.run(row.bina_id, row.daire_sayisi, row.toplam);
  for (const row of updates) updateStmt.run(row.daire_sayisi, row.toplam, row.bina_id);
  db.exec("COMMIT");
  report.inserted = inserts.length;
  report.updated = updates.length;
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e);
  db.close();
  process.exit(1);
}

writeFileSync(join(outDir, "latest-fill-bina-bilgi-apply.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
