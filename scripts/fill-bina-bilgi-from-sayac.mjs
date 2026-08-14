/**
 * Sayaç kaydı olan binalara bina_bilgi yazar / günceller.
 * Kat, sokak, kapı uydurulmaz.
 * - daire_sayisi / toplam = kayıtlı sayaç (mevcut daha büyükse korunur)
 * - kat_sayisi = sayaç.kat içindeki en yüksek kat (varsa)
 * - dis_kapi_no = boşsa diskapi-by-bina primary_kapi
 *
 *   node scripts/fill-bina-bilgi-from-sayac.mjs
 *   node scripts/fill-bina-bilgi-from-sayac.mjs --apply
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DISKAPI_PATH = join(ROOT, "data/diskapi-by-bina.json");
const APPLY = process.argv.includes("--apply");

function parseKatLabel(raw) {
  const u = String(raw || "")
    .toLocaleUpperCase("tr-TR")
    .trim();
  if (!u) return { floor: 0, zemin: false };
  if (u.includes("ZEMİN") || u.includes("ZEMIN")) return { floor: 0, zemin: true };
  if (u.includes("BODRUM") || u.includes("ORTAK")) return { floor: 0, zemin: false };
  const m = u.match(/(\d{1,2})\s*\.?\s*KAT/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 40) return { floor: n, zemin: false };
  }
  return { floor: 0, zemin: false };
}

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
try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN dis_kapi_no TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE bina_bilgi ADD COLUMN sokak TEXT DEFAULT ''`); } catch {}

const diskapiByBina = new Map();
if (existsSync(DISKAPI_PATH)) {
  const data = JSON.parse(readFileSync(DISKAPI_PATH, "utf8"));
  for (const [id, entry] of Object.entries(data.binalar || {})) {
    const kapi = String(entry?.primary_kapi ?? "").trim();
    if (kapi) diskapiByBina.set(Number(id), kapi);
  }
}

const katByBina = new Map();
const katRows = db
  .prepare(
    `SELECT bina_id, kat FROM sayac
     WHERE TRIM(COALESCE(sayac_id,'')) != ''`
  )
  .all();
for (const row of katRows) {
  const parsed = parseKatLabel(row.kat);
  const cur = katByBina.get(row.bina_id) || { floor: 0, zemin: false };
  if (parsed.floor > cur.floor) cur.floor = parsed.floor;
  if (parsed.zemin) cur.zemin = true;
  katByBina.set(row.bina_id, cur);
}

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
       bb.dis_kapi_no,
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
  const currentKat = Number(row.kat_sayisi) || 0;
  const daire = Math.max(currentDaire, needed);
  const toplam = Math.max(currentToplam, daire + ortak, needed);
  const katHint = katByBina.get(row.bina_id) || { floor: 0, zemin: false };
  const katSayisi = Math.max(currentKat, katHint.floor);
  const hasZemin = Number(row.has_zemin) === 1 || katHint.zemin || katSayisi === 0 ? 1 : Number(row.has_zemin) || 0;
  const currentKapi = String(row.dis_kapi_no || "").trim();
  const diskapiKapi = diskapiByBina.get(row.bina_id) || "";
  const disKapi = currentKapi || diskapiKapi;

  const next = {
    bina_id: row.bina_id,
    daire_sayisi: daire,
    toplam,
    kat_sayisi: katSayisi,
    has_zemin: hasZemin,
    dis_kapi_no: disKapi,
    sayac_count: row.sayac_count,
  };

  if (!row.has_bilgi) {
    inserts.push(next);
    continue;
  }

  const changed =
    currentDaire < daire ||
    currentToplam < toplam ||
    currentKat < katSayisi ||
    (Number(row.has_zemin) !== 1 && hasZemin === 1) ||
    (!currentKapi && disKapi);
  if (changed) {
    updates.push({
      ...next,
      from_daire: currentDaire,
      from_toplam: currentToplam,
      from_kat: currentKat,
      from_kapi: currentKapi,
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
  kat_filled: [...inserts, ...updates].filter((r) => r.kat_sayisi > 0).length,
  kapi_filled: [...inserts, ...updates].filter((r) => r.dis_kapi_no).length,
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
  ) VALUES (?, ?, ?, 0, ?, ?, '', '', ?, datetime('now'))
`);
const updateStmt = db.prepare(`
  UPDATE bina_bilgi
  SET kat_sayisi = CASE WHEN kat_sayisi < ? THEN ? ELSE kat_sayisi END,
      daire_sayisi = ?,
      toplam_bagımsız_bolum = ?,
      has_zemin = CASE WHEN ? = 1 THEN 1 ELSE has_zemin END,
      dis_kapi_no = CASE WHEN TRIM(COALESCE(dis_kapi_no,'')) = '' THEN ? ELSE dis_kapi_no END,
      updated_at = datetime('now')
  WHERE bina_id = ?
`);

db.exec("BEGIN");
try {
  for (const row of inserts) {
    insertStmt.run(row.bina_id, row.kat_sayisi, row.daire_sayisi, row.toplam, row.has_zemin, row.dis_kapi_no);
  }
  for (const row of updates) {
    updateStmt.run(
      row.kat_sayisi,
      row.kat_sayisi,
      row.daire_sayisi,
      row.toplam,
      row.has_zemin,
      row.dis_kapi_no,
      row.bina_id
    );
  }
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
