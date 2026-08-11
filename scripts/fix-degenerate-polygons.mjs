/**
 * KML'deki en buyuk poligonu kullanarak dejenere (nokta gibi) bina geometrilerini duzeltir.
 * Kullanim: node scripts/fix-degenerate-polygons.mjs [--apply]
 */
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const KML_PATH = join(ROOT, "data/binalar.kml");
const apply = process.argv.includes("--apply");
const MIN_AREA_M2 = 10;

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
      integration_code: get("integration_code"),
      area_m2: bestArea,
      coordinates: [bestRing],
    });
  }
  return placemarks;
}

function bestInList(list) {
  if (!list.length) return null;
  return list.reduce((a, b) => (b.area_m2 > a.area_m2 ? b : a));
}

function pushIndex(map, key, item) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(item);
}

function centroid(ring) {
  let lat = 0;
  let lng = 0;
  for (const [a, b] of ring) {
    lat += a;
    lng += b;
  }
  return [lat / ring.length, lng / ring.length];
}

function expandToMinBox(ring, sideM = 22) {
  const [clat, clng] = centroid(ring);
  const dLat = sideM / 2 / 111000;
  const dLng = sideM / 2 / 85000;
  return [
    [clat - dLat, clng - dLng],
    [clat - dLat, clng + dLng],
    [clat + dLat, clng + dLng],
    [clat + dLat, clng - dLng],
    [clat - dLat, clng - dLng],
  ];
}

function measureStored(coordsJson) {
  try {
    return measureRing(JSON.parse(coordsJson)[0]);
  } catch {
    return 0;
  }
}

const kml = readFileSync(KML_PATH, "utf8");
const placemarks = parseKmlPlacemarks(kml);

const byId2 = new Map();
const byKmlId = new Map();
const byOdaId = new Map();
const byValue = new Map();
const byIntegration = new Map();

for (const p of placemarks) {
  pushIndex(byId2, p.id_2, p);
  if (p.kml_id) pushIndex(byKmlId, String(p.kml_id), p);
  if (p.oda_id) pushIndex(byOdaId, String(p.oda_id), p);
  if (p.value) pushIndex(byValue, p.value, p);
  if (p.integration_code) pushIndex(byIntegration, p.integration_code, p);
}

function findBestCandidate(row) {
  const pick = (list, via, filter) => {
    const items = (list || []).filter(filter || (() => true));
    const best = bestInList(items);
    if (best && best.area_m2 >= MIN_AREA_M2) return { ...best, via };
    return null;
  };

  if (row.id_2) {
    const c = pick(byId2.get(String(row.id_2)), "id_2");
    if (c) return c;
  }
  if (row.oda_id) {
    const list = byOdaId.get(String(row.oda_id)) || [];
    if (list.length <= 3) {
      const c = pick(list, "oda_id", (p) => !row.id_2 || !p.id_2 || String(p.id_2) === String(row.id_2));
      if (c) return c;
    }
  }
  if (row.kml_id) {
    const c = pick(byKmlId.get(String(row.kml_id)), "kml_id", (p) => !row.id_2 || !p.id_2 || String(p.id_2) === String(row.id_2));
    if (c) return c;
    const c2 = pick(
      byKmlId.get(String(row.kml_id)),
      "kml_id_value",
      (p) => p.value && row.value && p.value === row.value
    );
    if (c2) return c2;
  }
  if (row.value) {
    const c = pick(byValue.get(row.value), "value", (p) => p.area_m2 >= MIN_AREA_M2);
    if (c) return c;
  }
  return null;
}

const db = new DatabaseSync(DB_PATH);
const rows = db.prepare("SELECT id, value, kml_id, id_2, oda_id, coordinates FROM binalar").all();

const fixes = [];
const unfixable = [];

for (const row of rows) {
  const currentArea = measureStored(row.coordinates);
  if (currentArea >= MIN_AREA_M2) continue;

  const candidate = findBestCandidate(row);
  if (candidate && candidate.area_m2 > currentArea && candidate.area_m2 >= MIN_AREA_M2) {
    fixes.push({
      bina_id: row.id,
      value: row.value,
      eski_alan_m2: +currentArea.toFixed(2),
      yeni_alan_m2: +candidate.area_m2.toFixed(2),
      eslestirme: candidate.via,
      yeni_kml_id: candidate.kml_id,
      yeni_oda_id: candidate.oda_id,
      coordinates: candidate.coordinates,
    });
    continue;
  }

  const ring = JSON.parse(row.coordinates)[0] || [];
  if (ring.length >= 3) {
    const expanded = expandToMinBox(ring);
    fixes.push({
      bina_id: row.id,
      value: row.value,
      eski_alan_m2: +currentArea.toFixed(2),
      yeni_alan_m2: +measureRing(expanded).toFixed(2),
      eslestirme: "min_kutu",
      yeni_kml_id: null,
      yeni_oda_id: null,
      coordinates: [expanded],
    });
    continue;
  }

  unfixable.push({
    bina_id: row.id,
    value: row.value,
    eski_alan_m2: +currentArea.toFixed(2),
    id_2: row.id_2,
    kml_id: row.kml_id,
  });
}

console.log(
  JSON.stringify(
    {
      apply,
      duzeltilecek: fixes.length,
      duzeltilemeyen: unfixable.length,
      ornekler: fixes.slice(0, 25).map((f) => ({
        bina_id: f.bina_id,
        value: f.value,
        eski_alan_m2: f.eski_alan_m2,
        yeni_alan_m2: f.yeni_alan_m2,
        eslestirme: f.eslestirme,
      })),
      duzeltilemeyen_ornekler: unfixable.slice(0, 10),
    },
    null,
    2
  )
);

if (apply && fixes.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = join(ROOT, `data/binalar.before-polygon-fix-${stamp}.db`);
  copyFileSync(DB_PATH, backup);
  const upd = db.prepare(
    "UPDATE binalar SET coordinates = ?, kml_id = COALESCE(?, kml_id), oda_id = COALESCE(?, oda_id) WHERE id = ?"
  );
  db.exec("BEGIN");
  try {
    for (const f of fixes) {
      upd.run(JSON.stringify(f.coordinates), f.yeni_kml_id, f.yeni_oda_id, f.bina_id);
    }
    db.exec("COMMIT");
    console.log(`Uygulandi: ${fixes.length} bina, yedek: ${backup}`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
