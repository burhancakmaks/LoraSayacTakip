/**
 * Aynı id_2 (MASKİ building_id) paylaşan kardeş binalara dis_kapi_no kopyalar.
 * - MASKİ diskapi-by-bina veya kardeşte dolu dis_kapi_no kaynağı olmalı
 * - Mevcut dolu dis_kapi_no ASLA değiştirilmez
 *
 * Kullanım:
 *   node scripts/apply-diskapi-siblings.mjs          # dry-run
 *   node scripts/apply-diskapi-siblings.mjs --apply  # yaz
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
  const dest = join(ROOT, `data/binalar.before-diskapi-siblings-${stamp}.db`);
  copyFileSync(DB_PATH, dest);
  return dest;
}

function main() {
  if (!existsSync(BY_BINA_PATH)) {
    console.error("Önce: npm run build:diskapi-by-bina");
    process.exit(1);
  }

  const byBina = JSON.parse(readFileSync(BY_BINA_PATH, "utf8"));
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

  const binalar = db
    .prepare(`SELECT id, value, id_2, layer FROM binalar WHERE id_2 IS NOT NULL AND TRIM(CAST(id_2 AS TEXT)) != ''`)
    .all();

  const bilgiRows = db.prepare(`SELECT bina_id, dis_kapi_no FROM bina_bilgi`).all();
  const bilgiMap = new Map(bilgiRows.map((r) => [r.bina_id, String(r.dis_kapi_no ?? "").trim()]));

  /** id_2 -> primary kapı (MASKİ diskapi-by-bina üzerinden) */
  const id2FromMaski = new Map();
  for (const [binaIdStr, entry] of Object.entries(byBina.binalar || {})) {
    const binaId = Number(binaIdStr);
    const kapi = String(entry.primary_kapi ?? "").trim();
    if (!kapi) continue;
    const bina = binalar.find((b) => b.id === binaId);
    if (!bina?.id_2) continue;
    const key = String(bina.id_2);
    if (!id2FromMaski.has(key)) id2FromMaski.set(key, kapi);
  }

  /** id_2 -> dolu dis_kapi_no (mevcut kardeş kayıtlarından) */
  const id2FromDb = new Map();
  for (const b of binalar) {
    const kapi = bilgiMap.get(b.id);
    if (!kapi) continue;
    const key = String(b.id_2);
    if (!id2FromDb.has(key)) id2FromDb.set(key, kapi);
  }

  /** id_2 -> tüm kardeş bina id'leri */
  const siblingsById2 = new Map();
  for (const b of binalar) {
    const key = String(b.id_2);
    if (!siblingsById2.has(key)) siblingsById2.set(key, []);
    siblingsById2.get(key).push(b);
  }

  const plan = {
    insert_new: [],
    update_empty: [],
    skipped_has_value: [],
    skipped_no_maski: [],
  };

  for (const [id2, group] of siblingsById2) {
    if (group.length < 2) continue;

    const kapi = id2FromMaski.get(id2) || id2FromDb.get(id2) || "";
    if (!kapi) {
      if (plan.skipped_no_maski.length < 20) {
        plan.skipped_no_maski.push({
          id_2: id2,
          binalar: group.map((b) => ({ id: b.id, value: b.value, layer: b.layer })),
        });
      }
      continue;
    }

    for (const b of group) {
      const current = bilgiMap.get(b.id) ?? "";
      if (current) {
        if (current !== kapi && plan.skipped_has_value.length < 30) {
          plan.skipped_has_value.push({
            bina_id: b.id,
            bina: b.value,
            layer: b.layer,
            mevcut: current,
            kardes_kapi: kapi,
            id_2: id2,
          });
        }
        continue;
      }

      const row = { bina_id: b.id, bina: b.value, layer: b.layer, kapi_no: kapi, id_2: id2, kaynak: id2FromMaski.has(id2) ? "maski" : "kardes_db" };
      if (bilgiMap.has(b.id)) plan.update_empty.push(row);
      else plan.insert_new.push(row);
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    id_2_groups_with_siblings: [...siblingsById2.values()].filter((g) => g.length > 1).length,
    to_insert: plan.insert_new.length,
    to_update_empty: plan.update_empty.length,
    skipped_has_value: plan.skipped_has_value.length,
    skipped_no_maski_groups: plan.skipped_no_maski.length,
    samples: {
      insert_new: plan.insert_new.slice(0, 15),
      update_empty: plan.update_empty.slice(0, 15),
      skipped_has_value: plan.skipped_has_value.slice(0, 10),
      skipped_no_maski: plan.skipped_no_maski.slice(0, 5),
    },
  };

  writeFileSync(join(ROOT, "data/diskapi-siblings-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log("\nDry-run tamam. Uygulamak için: node scripts/apply-diskapi-siblings.mjs --apply");
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
      if (res.changes === 0) insertStmt.run(row.bina_id, row.kapi_no);
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
