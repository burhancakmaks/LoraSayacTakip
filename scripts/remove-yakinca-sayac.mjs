/**
 * Yakınca Mahallesi binalarındaki sayaçları çıkarır.
 * Bina poligonları silinmez. Sokak/kapı uydurulmaz.
 *
 *   node scripts/remove-yakinca-sayac.mjs
 *   node scripts/remove-yakinca-sayac.mjs --apply
 */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const APPLY = process.argv.includes("--apply");

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersects =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

function centroid(coordsRaw) {
  let coords;
  try {
    coords = JSON.parse(coordsRaw);
  } catch {
    return null;
  }
  const ring = Array.isArray(coords[0]?.[0]) ? coords[0] : coords;
  if (!ring?.length) return null;
  let slat = 0;
  let slng = 0;
  let n = 0;
  for (const p of ring) {
    const lat = Number(p[0]);
    const lng = Number(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    slat += lat;
    slng += lng;
    n++;
  }
  if (!n) return null;
  return { lat: slat / n, lng: slng / n };
}

function mahalleRing(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const outer = Array.isArray(parsed[0]?.[0]?.[0]) ? parsed[0] : parsed;
  const ring = Array.isArray(outer[0]?.[0]) ? outer[0] : outer;
  return ring?.length >= 3 ? ring : null;
}

const db = new DatabaseSync(DB_PATH);
const mahalle = db
  .prepare("SELECT name, coordinates FROM mahalleler WHERE name = 'Yakınca Mahallesi'")
  .get();
if (!mahalle) {
  console.error("Yakınca Mahallesi bulunamadı");
  process.exit(1);
}
const ring = mahalleRing(mahalle.coordinates);
if (!ring) {
  console.error("Yakınca mahalle poligonu okunamadı");
  process.exit(1);
}

const binalar = db.prepare("SELECT id, value, layer, coordinates FROM binalar").all();
const yakincaIds = [];
for (const b of binalar) {
  const c = centroid(b.coordinates);
  if (!c || !pointInRing(c.lat, c.lng, ring)) continue;
  yakincaIds.push(b.id);
}

const placeholders = yakincaIds.map(() => "?").join(",");
const meterRows = yakincaIds.length
  ? db
      .prepare(
        `SELECT s.id, s.bina_id, s.sayac_id, s.kaynak, b.value, b.layer
         FROM sayac s JOIN binalar b ON b.id = s.bina_id
         WHERE s.bina_id IN (${placeholders}) AND TRIM(COALESCE(s.sayac_id,'')) != ''`
      )
      .all(...yakincaIds)
  : [];

const byKaynak = {};
const byBina = new Map();
for (const row of meterRows) {
  const k = row.kaynak || "(bos)";
  byKaynak[k] = (byKaynak[k] || 0) + 1;
  byBina.set(row.bina_id, (byBina.get(row.bina_id) || 0) + 1);
}

const ikizceLora = meterRows.filter((r) => r.kaynak === "ikizce-lora").length;
const report = {
  mode: APPLY ? "apply" : "dry-run",
  mahalle: mahalle.name,
  buildings_in_mahalle: yakincaIds.length,
  buildings_with_meters: byBina.size,
  meter_rows: meterRows.length,
  ikizce_lora_rows: ikizceLora,
  byKaynak,
  sample: meterRows.slice(0, 8).map((r) => ({
    bina_id: r.bina_id,
    value: r.value,
    sayac_id: r.sayac_id,
    kaynak: r.kaynak,
  })),
};

if (ikizceLora) {
  console.error("DURDURULDU: Yakınca içinde ikizce-lora kaydı var, dokunulmadı.");
  console.log(JSON.stringify(report, null, 2));
  db.close();
  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify(report, null, 2));
  console.log("\nUygulamak için: node scripts/remove-yakinca-sayac.mjs --apply");
  db.close();
  process.exit(0);
}

const backupDir = join(ROOT, "data/backups");
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(backupDir, `binalar.before-remove-yakinca-sayac-${stamp}.db`);
copyFileSync(DB_PATH, backup);
if (!existsSync(backup) || statSync(backup).size !== statSync(DB_PATH).size) {
  console.error("Yedek doğrulanamadı");
  db.close();
  process.exit(1);
}
report.backup = backup.replace(/\\/g, "/");

db.exec("BEGIN IMMEDIATE");
try {
  if (yakincaIds.length) {
    const delSayac = db.prepare(`DELETE FROM sayac WHERE bina_id IN (${placeholders})`).run(...yakincaIds);
    report.deleted_sayac = delSayac.changes;

    const bilgi = db.prepare(
      `UPDATE bina_bilgi
       SET daire_sayisi = 0,
           toplam_bagımsız_bolum = ortak_alan_sayisi,
           has_zemin = 0,
           kat_sayisi = 0,
           updated_at = datetime('now')
       WHERE bina_id IN (${placeholders})`
    ).run(...yakincaIds);
    report.updated_bina_bilgi = bilgi.changes;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e);
  db.close();
  process.exit(1);
}

const leftover = yakincaIds.length
  ? db
      .prepare(
        `SELECT COUNT(*) c FROM sayac
         WHERE bina_id IN (${placeholders}) AND TRIM(COALESCE(sayac_id,'')) != ''`
      )
      .get(...yakincaIds).c
  : 0;
report.leftover_meters = leftover;

const outDir = join(ROOT, "data/import-reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "latest-remove-yakinca-sayac.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (leftover) {
  console.error("UYARI: Yakınca'da hâlâ sayaç var");
  process.exit(1);
}
db.close();
