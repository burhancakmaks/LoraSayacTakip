/**
 * Dış kapı numaralarını bina_bilgi.dis_kapi_no alanına güvenli aktarır.
 * - Önce yedek alır
 * - Mevcut dolu dis_kapi_no ASLA değiştirilmez
 * - Sadece on_edge / near_edge ve <=25m hizalı kayıtlar
 *
 * Kullanım:
 *   node scripts/apply-diskapi-bilgi.mjs          # dry-run rapor
 *   node scripts/apply-diskapi-bilgi.mjs --apply  # yaz
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const BY_BINA_PATH = join(ROOT, "data/diskapi-by-bina.json");
const apply = process.argv.includes("--apply");

function backupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(ROOT, `data/binalar.before-diskapi-${stamp}.db`);
  copyFileSync(DB_PATH, dest);
  return dest;
}

function main() {
  if (!existsSync(BY_BINA_PATH)) {
    console.error("Önce: npm run build:diskapi-by-bina");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(BY_BINA_PATH, "utf8"));
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
  try {
    db.exec(`ALTER TABLE bina_bilgi ADD COLUMN dis_kapi_no TEXT DEFAULT ''`);
  } catch {}

  const existing = db.prepare(`SELECT bina_id, dis_kapi_no FROM bina_bilgi`).all();
  const existingMap = new Map(existing.map((r) => [r.bina_id, String(r.dis_kapi_no ?? "").trim()]));

  const plan = {
    insert_new: [],
    update_empty: [],
    skipped_has_value: [],
    skipped_no_bina: [],
  };

  const binaExists = db.prepare(`SELECT id, value FROM binalar WHERE id = ?`);

  for (const [binaIdStr, entry] of Object.entries(data.binalar || {})) {
    const binaId = Number(binaIdStr);
    const kapi = String(entry.primary_kapi ?? "").trim();
    if (!binaId || !kapi) continue;

    const bina = binaExists.get(binaId);
    if (!bina) {
      plan.skipped_no_bina.push({ bina_id: binaId, kapi_no: kapi });
      continue;
    }

    const current = existingMap.get(binaId) ?? "";
    if (current) {
      plan.skipped_has_value.push({ bina_id: binaId, bina: bina.value, mevcut: current, yeni: kapi });
      continue;
    }

    if (existingMap.has(binaId)) {
      plan.update_empty.push({ bina_id: binaId, bina: bina.value, kapi_no: kapi });
    } else {
      plan.insert_new.push({ bina_id: binaId, bina: bina.value, kapi_no: kapi });
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    to_insert: plan.insert_new.length,
    to_update_empty: plan.update_empty.length,
    skipped_existing_kapi: plan.skipped_has_value.length,
    skipped_missing_bina: plan.skipped_no_bina.length,
    samples: {
      insert_new: plan.insert_new.slice(0, 10),
      update_empty: plan.update_empty.slice(0, 10),
      skipped_has_value: plan.skipped_has_value.slice(0, 10),
    },
  };

  writeFileSync(join(ROOT, "data/diskapi-apply-report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log("\nDry-run tamam. Uygulamak için: node scripts/apply-diskapi-bilgi.mjs --apply");
    return;
  }

  const backup = backupDb();
  console.log("Yedek:", backup);

  const insertStmt = db.prepare(`
    INSERT INTO bina_bilgi (bina_id, dis_kapi_no, updated_at)
    VALUES (?, ?, datetime('now'))
  `);
  const updateStmt = db.prepare(`
    UPDATE bina_bilgi
    SET dis_kapi_no = ?, updated_at = datetime('now')
    WHERE bina_id = ? AND TRIM(COALESCE(dis_kapi_no, '')) = ''
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of plan.insert_new) {
      insertStmt.run(row.bina_id, row.kapi_no);
    }
    for (const row of plan.update_empty) {
      const res = updateStmt.run(row.kapi_no, row.bina_id);
      if (res.changes === 0) {
        insertStmt.run(row.bina_id, row.kapi_no);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const after = db
    .prepare(`SELECT COUNT(*) AS c FROM bina_bilgi WHERE TRIM(COALESCE(dis_kapi_no,'')) != ''`)
    .get().c;
  console.log("dis_kapi_no dolu kayıt:", after);
}

main();
