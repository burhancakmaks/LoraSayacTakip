/**
 * Küçük poligon + çok sayaçlı binaları KML'deki gerçek footprint ile düzeltir.
 * Kullanım: node scripts/fix-small-high-sayac-polygons.mjs [--apply]
 */
import { readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const KML_PATH = join(ROOT, "data/Binalar.kml");
const apply = process.argv.includes("--apply");

const MIN_SAYAC = 10;
const MAX_AREA_M2 = 500; // min_kutu veya hatalı küçük poligon

function measureRing(ring) {
  if (!ring?.length) return 0;
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
  return (maxLat - minLat) * 111000 * (maxLng - minLng) * 85000;
}

function parseKmlPlacemarks(kml) {
  const placemarks = [];
  const re = /<Placemark>[\s\S]*?<\/Placemark>/g;
  let m;
  while ((m = re.exec(kml))) {
    const block = m[0];
    const coordBlocks = [...block.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)];
    if (!coordBlocks.length) continue;

    const get = (name) => {
      const r = block.match(new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`));
      return r ? r[1].trim() : "";
    };

    let bestRing = [];
    let bestArea = 0;
    for (const cm of coordBlocks) {
      const ring = cm[1]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((pt) => {
          const [lng, lat] = pt.split(",").map(Number);
          return [lat, lng];
        });
      if (ring.length < 3) continue;
      const area = measureRing(ring);
      if (area > bestArea) {
        bestArea = area;
        bestRing = ring;
      }
    }
    if (bestRing.length < 3) continue;

    placemarks.push({
      kml_id: get("id") ? Number(get("id")) : null,
      oda_id: get("oda_id") ? Number(get("oda_id")) : null,
      id_2: get("id_2") || get("code") || "",
      value: get("value"),
      area_m2: bestArea,
      coordinates: [bestRing],
    });
  }
  return placemarks;
}

function bestKmlMatch(row, byId2, byValue) {
  const candidates = [];
  if (row.id_2) {
    candidates.push(...(byId2.get(String(row.id_2)) || []));
  }
  if (row.value) {
    for (const p of byValue.get(row.value) || []) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.area_m2 > a.area_m2 ? b : a));
}

const kml = readFileSync(KML_PATH, "utf8");
const placemarks = parseKmlPlacemarks(kml);

const byId2 = new Map();
const byValue = new Map();
for (const p of placemarks) {
  if (p.id_2) {
    if (!byId2.has(String(p.id_2))) byId2.set(String(p.id_2), []);
    byId2.get(String(p.id_2)).push(p);
  }
  if (p.value) {
    if (!byValue.has(p.value)) byValue.set(p.value, []);
    byValue.get(p.value).push(p);
  }
}

const db = new DatabaseSync(DB_PATH);
const rows = db
  .prepare(
    `
    SELECT b.id, b.value, b.kml_id, b.id_2, b.oda_id, b.coordinates,
      (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id,'')) != '') AS sayac_count
    FROM binalar b
    WHERE (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id,'')) != '') >= ?
  `
  )
  .all(MIN_SAYAC);

const fixes = [];
for (const row of rows) {
  const ring = JSON.parse(row.coordinates)[0] || [];
  const area = measureRing(ring);
  if (area >= MAX_AREA_M2) continue;

  const kmlMatch = bestKmlMatch(row, byId2, byValue);
  if (!kmlMatch || kmlMatch.area_m2 <= area || kmlMatch.area_m2 < MAX_AREA_M2) continue;

  fixes.push({
    bina_id: row.id,
    value: row.value,
    sayac_count: row.sayac_count,
    eski_alan_m2: +area.toFixed(1),
    yeni_alan_m2: +kmlMatch.area_m2.toFixed(1),
    yeni_kml_id: kmlMatch.kml_id,
    yeni_oda_id: kmlMatch.oda_id,
    coordinates: kmlMatch.coordinates,
  });
}

console.log(JSON.stringify({ apply, duzeltilecek: fixes.length, fixes }, null, 2));

if (apply && fixes.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  copyFileSync(DB_PATH, join(ROOT, `data/binalar.before-small-sayac-polygon-${stamp}.db`));
  const upd = db.prepare(
    "UPDATE binalar SET coordinates = ?, kml_id = COALESCE(?, kml_id), oda_id = COALESCE(?, oda_id) WHERE id = ?"
  );
  db.exec("BEGIN");
  for (const f of fixes) {
    upd.run(JSON.stringify(f.coordinates), f.yeni_kml_id, f.yeni_oda_id, f.bina_id);
  }
  db.exec("COMMIT");
  console.log("Uygulandi:", fixes.length);
}
