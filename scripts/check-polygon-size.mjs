import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const binaId = Number(process.argv[2] || 1068);
const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

function measurePolygon(coordsJson) {
  const coords = JSON.parse(coordsJson);
  const ring = coords[0] || [];
  if (!ring.length) return { nokta: 0, genislik_m: 0, uzunluk_m: 0, alan_m2: 0 };
  let minLat = 999,
    maxLat = -999,
    minLng = 999,
    maxLng = -999;
  for (const [lat, lng] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const dLat = (maxLat - minLat) * 111000;
  const dLng = (maxLng - minLng) * 85000;
  return {
    nokta: ring.length,
    genislik_m: +dLat.toFixed(2),
    uzunluk_m: +dLng.toFixed(2),
    alan_m2: +(dLat * dLng).toFixed(2),
    merkez: [+(minLat + maxLat) / 2, +(minLng + maxLng) / 2],
  };
}

const b = db
  .prepare("SELECT id, value, oda_id, kml_id, coordinates FROM binalar WHERE id = ?")
  .get(binaId);
const measure = measurePolygon(b.coordinates);

const neighbors = db
  .prepare(
    `SELECT id, value, oda_id, kml_id, coordinates
     FROM binalar
     WHERE value LIKE 'E%'
     ORDER BY value
     LIMIT 20`
  )
  .all()
  .map((row) => ({
    id: row.id,
    value: row.value,
    oda_id: row.oda_id,
    ...measurePolygon(row.coordinates),
  }));

const tiny = db
  .prepare(`SELECT id, value, coordinates FROM binalar`)
  .all()
  .map((row) => ({ id: row.id, value: row.value, ...measurePolygon(row.coordinates) }))
  .filter((r) => r.alan_m2 < 5)
  .sort((a, b) => a.alan_m2 - b.alan_m2)
  .slice(0, 15);

let kmlHit = null;
const kmlPath = path.join(process.cwd(), "data", "binalar.kml");
if (existsSync(kmlPath)) {
  const kml = readFileSync(kmlPath, "utf8");
  const idx = kml.indexOf("E04");
  if (idx >= 0) kmlHit = kml.slice(Math.max(0, idx - 200), idx + 400);
}

console.log(
  JSON.stringify(
    {
      hedef: { ...b, olcu: measure },
      e_bloklari_ornek: neighbors,
      cok_kucuk_poligonlar: tiny,
      kml_e04_parcasi: kmlHit,
    },
    null,
    2
  )
);
