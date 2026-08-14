/**
 * Sayaçlı binalara bina_bilgi + sayaç görünen alanlarını yazar.
 * Kat/sokak uydurulmaz. blok_no = KML bina adı, kapi_no = birim_no (boşsa).
 *
 *   node scripts/fill-sayac-bina-display.mjs --apply
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DISKAPI_PATH = join(ROOT, "data/diskapi-by-bina.json");
const APPLY = process.argv.includes("--apply");
const KAYNAK = ["assign-nearest-forced", "assign-nearest-safe", "place-remaining", "meter-coord-import"];

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

const diskapiByBina = new Map();
if (existsSync(DISKAPI_PATH)) {
  const data = JSON.parse(readFileSync(DISKAPI_PATH, "utf8"));
  for (const [id, entry] of Object.entries(data.binalar || {})) {
    const kapi = String(entry?.primary_kapi ?? "").trim();
    if (kapi) diskapiByBina.set(Number(id), kapi);
  }
}

const meterBinalar = db
  .prepare(
    `SELECT s.bina_id,
            COUNT(*) AS sayac_count,
            MAX(s.birim_no) AS max_birim,
            b.value AS bina_value
     FROM sayac s
     JOIN binalar b ON b.id = s.bina_id
     WHERE TRIM(COALESCE(s.sayac_id,'')) != ''
     GROUP BY s.bina_id`
  )
  .all();

const bilgiById = new Map(db.prepare("SELECT * FROM bina_bilgi").all().map((r) => [r.bina_id, r]));

const bilgiInserts = [];
const bilgiUpdates = [];
for (const row of meterBinalar) {
  const needed = Math.max(Number(row.sayac_count) || 0, Number(row.max_birim) || 0);
  const cur = bilgiById.get(row.bina_id);
  const diskapi = diskapiByBina.get(row.bina_id) || "";
  if (!cur) {
    bilgiInserts.push({
      bina_id: row.bina_id,
      daire: needed,
      toplam: needed,
      kapi: diskapi,
    });
    continue;
  }
  const daire = Math.max(Number(cur.daire_sayisi) || 0, needed);
  const ortak = Number(cur.ortak_alan_sayisi) || 0;
  const toplam = Math.max(Number(cur.toplam_bagımsız_bolum) || 0, daire + ortak, needed);
  const kapi = String(cur.dis_kapi_no || "").trim() || diskapi;
  const changed =
    daire > (Number(cur.daire_sayisi) || 0) ||
    toplam > (Number(cur.toplam_bagımsız_bolum) || 0) ||
    (!String(cur.dis_kapi_no || "").trim() && kapi);
  if (changed) {
    bilgiUpdates.push({ bina_id: row.bina_id, daire, toplam, kapi });
  }
}

const sayacNeed = db
  .prepare(
    `SELECT COUNT(*) c FROM sayac
     WHERE kaynak IN (${KAYNAK.map(() => "?").join(",")})
       AND TRIM(COALESCE(sayac_id,'')) != ''
       AND (
         TRIM(COALESCE(blok_no,'')) = ''
         OR TRIM(COALESCE(kapi_no,'')) = ''
       )`
  )
  .get(...KAYNAK).c;

const report = {
  mode: APPLY ? "apply" : "dry-run",
  meter_buildings: meterBinalar.length,
  bilgi_inserts: bilgiInserts.length,
  bilgi_updates: bilgiUpdates.length,
  sayac_blok_or_kapi_empty: sayacNeed,
};

if (!APPLY) {
  console.log(JSON.stringify(report, null, 2));
  console.log("\nUygulamak için: node scripts/fill-sayac-bina-display.mjs --apply");
  db.close();
  process.exit(0);
}

const backupDir = join(ROOT, "data/backups");
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(backupDir, `binalar.before-fill-sayac-bina-display-${stamp}.db`);
copyFileSync(DB_PATH, backup);

const insertBilgi = db.prepare(`
  INSERT INTO bina_bilgi (
    bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
    has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
  ) VALUES (?, 0, ?, 0, ?, 1, '', '', ?, datetime('now'))
`);
const updateBilgi = db.prepare(`
  UPDATE bina_bilgi
  SET daire_sayisi = ?,
      toplam_bagımsız_bolum = ?,
      has_zemin = CASE WHEN kat_sayisi = 0 THEN 1 ELSE has_zemin END,
      dis_kapi_no = CASE WHEN TRIM(COALESCE(dis_kapi_no,'')) = '' THEN ? ELSE dis_kapi_no END,
      updated_at = datetime('now')
  WHERE bina_id = ?
`);
const updateSayac = db.prepare(`
  UPDATE sayac
  SET blok_no = CASE WHEN TRIM(COALESCE(blok_no,'')) = '' THEN ? ELSE blok_no END,
      kapi_no = CASE WHEN TRIM(COALESCE(kapi_no,'')) = '' THEN CAST(birim_no AS TEXT) ELSE kapi_no END,
      updated_at = datetime('now')
  WHERE id = ?
`);

const sayacRows = db
  .prepare(
    `SELECT s.id, s.birim_no, b.value AS bina_value
     FROM sayac s
     JOIN binalar b ON b.id = s.bina_id
     WHERE s.kaynak IN (${KAYNAK.map(() => "?").join(",")})
       AND TRIM(COALESCE(s.sayac_id,'')) != ''
       AND (
         TRIM(COALESCE(s.blok_no,'')) = ''
         OR TRIM(COALESCE(s.kapi_no,'')) = ''
       )`
  )
  .all(...KAYNAK);

db.exec("BEGIN IMMEDIATE");
try {
  for (const row of bilgiInserts) insertBilgi.run(row.bina_id, row.daire, row.toplam, row.kapi);
  for (const row of bilgiUpdates) updateBilgi.run(row.daire, row.toplam, row.kapi, row.bina_id);
  let sayacUpdated = 0;
  for (const row of sayacRows) {
    updateSayac.run(String(row.bina_value || "").trim(), row.id);
    sayacUpdated++;
  }
  db.exec("COMMIT");
  report.backup = backup.replace(/\\/g, "/");
  report.sayac_updated = sayacUpdated;
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e);
  db.close();
  process.exit(1);
}

const outDir = join(ROOT, "data/import-reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "latest-fill-sayac-bina-display.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
