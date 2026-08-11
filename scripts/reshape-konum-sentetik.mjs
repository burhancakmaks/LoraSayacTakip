/**
 * KOORDINAT_SENTETIK binaların poligonunu bağlı sayaç noktalarının
 * sınır kutusuna (padding ile) yeniden oturtur.
 *
 *   node scripts/reshape-konum-sentetik.mjs --dry-run
 *   node scripts/reshape-konum-sentetik.mjs --apply
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

const PAD_M = 6;
const MIN_HALF_M = 10;

const apply = process.argv.includes("--apply");

export function polygonFromPoints(points, padM = PAD_M, minHalfM = MIN_HALF_M) {
  if (!points.length) return null;

  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  if (!Number.isFinite(minLat)) return null;

  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const cos = Math.cos((cLat * Math.PI) / 180);

  let halfLat = (maxLat - minLat) / 2 + padM / 111320;
  let halfLng = (maxLng - minLng) / 2 + padM / (111320 * cos);
  const minHalfLat = minHalfM / 111320;
  const minHalfLng = minHalfM / (111320 * cos);
  halfLat = Math.max(halfLat, minHalfLat);
  halfLng = Math.max(halfLng, minHalfLng);

  const ring = [
    [cLat - halfLat, cLng - halfLng],
    [cLat - halfLat, cLng + halfLng],
    [cLat + halfLat, cLng + halfLng],
    [cLat + halfLat, cLng - halfLng],
    [cLat - halfLat, cLng - halfLng],
  ];
  return [ring];
}

const db = new DatabaseSync(DB_PATH);
const synthetics = db
  .prepare(`SELECT id, value, coordinates FROM binalar WHERE layer LIKE '%KOORDINAT_SENTETIK%'`)
  .all();

const konumPts = db.prepare(
  `SELECT bina_id, lat, lng FROM sayac_konum WHERE bina_id = ? AND lat IS NOT NULL AND lng IS NOT NULL`
);
const sayacPts = db.prepare(
  `SELECT lat, lng FROM sayac WHERE bina_id = ? AND lat IS NOT NULL AND lng IS NOT NULL`
);

const updates = [];
for (const b of synthetics) {
  const points = [
    ...konumPts.all(b.id),
    ...sayacPts.all(b.id).map((r) => ({ lat: r.lat, lng: r.lng })),
  ];
  const poly = polygonFromPoints(points);
  if (!poly) continue;

  let oldArea = 0;
  try {
    const old = JSON.parse(b.coordinates);
    const ring = Array.isArray(old[0]?.[0]) ? old[0] : old;
    if (ring.length >= 3) {
      const lats = ring.map((p) => p[0]);
      const lngs = ring.map((p) => p[1]);
      oldArea = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
    }
  } catch {}

  const lats = poly[0].map((p) => p[0]);
  const lngs = poly[0].map((p) => p[1]);
  const newArea = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));

  updates.push({
    id: b.id,
    value: b.value,
    point_count: points.length,
    oldArea,
    newArea,
    coordinates: JSON.stringify(poly),
  });
}

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      synthetic_binalar: synthetics.length,
      to_update: updates.length,
      sample: updates.slice(0, 5).map((u) => ({
        id: u.id,
        value: u.value,
        points: u.point_count,
        area_ratio: u.oldArea ? Math.round((u.newArea / u.oldArea) * 100) / 100 : null,
      })),
    },
    null,
    2
  )
);

if (!apply) {
  console.log("\nUygulamak için: node scripts/reshape-konum-sentetik.mjs --apply");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = join(DATA_DIR, `binalar.before-reshape-sentetik-${stamp}.db`);
copyFileSync(DB_PATH, backup);

const upd = db.prepare(`UPDATE binalar SET coordinates = ? WHERE id = ?`);
db.exec("BEGIN IMMEDIATE");
try {
  for (const u of updates) upd.run(u.coordinates, u.id);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(JSON.stringify({ updated: updates.length, backup }, null, 2));
