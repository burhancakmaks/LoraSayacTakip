/**
 * Sayaç koordinat Excel import (uzaktan okuma konumları)
 * Kaynak kolonlar: installation_number, agreement_number, location (POINT X Y),
 *                  meter_number, value (BAYLAN_LORA_W / …)
 *
 * Koordinat sistemi: EPSG:5257 (ITRF96 / TM39) → WGS84
 * Depo: sayac_konum + eşleşen sayac satırlarına lat/lng
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import XLSX from "xlsx";
import proj4 from "proj4";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");
const DEFAULT_XLSX = join(DATA_DIR, "sayac-koordinat.xlsx");

proj4.defs(
  "EPSG:5257",
  "+proj=tmerc +lat_0=0 +lon_0=39 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs"
);

function findExcel() {
  const arg = process.argv.find((a) => /\.xlsx$/i.test(a) && !a.includes("node_modules"));
  if (arg && existsSync(arg)) return arg;
  if (existsSync(DEFAULT_XLSX)) return DEFAULT_XLSX;

  for (const dir of ["C:/Users/Surface/Downloads", DATA_DIR]) {
    if (!existsSync(dir)) continue;
    const hits = readdirSync(dir).filter((f) => /koordinat/i.test(f) && /\.xlsx$/i.test(f));
    if (hits.length) {
      hits.sort();
      return join(dir, hits[hits.length - 1]);
    }
  }
  return null;
}

function normMeter(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function parsePoint(location) {
  const m = String(location ?? "").match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const easting = Number(m[1]);
  const northing = Number(m[2]);
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  return { easting, northing };
}

function toWgs84(easting, northing) {
  const [lng, lat] = proj4("EPSG:5257", "WGS84", [easting, northing]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 35 || lat > 43 || lng < 25 || lng > 46) return null;
  return { lat, lng };
}

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersect =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sayac_konum (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_number TEXT NOT NULL,
      meter_key TEXT NOT NULL,
      installation_number TEXT DEFAULT '',
      agreement_number TEXT DEFAULT '',
      meter_type TEXT DEFAULT '',
      easting REAL,
      northing REAL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      crs TEXT DEFAULT 'EPSG:5257',
      bina_id INTEGER,
      sayac_id_matched TEXT DEFAULT '',
      match_kaynak TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(meter_key)
    );
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_meter ON sayac_konum(meter_number);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_key ON sayac_konum(meter_key);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_bina ON sayac_konum(bina_id);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_type ON sayac_konum(meter_type);
    CREATE INDEX IF NOT EXISTS idx_sayac_konum_geo ON sayac_konum(lat, lng);
  `);

  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN lat REAL`);
  } catch {}
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN lng REAL`);
  } catch {}
}

function loadSayacIndex(db) {
  const byKey = new Map();
  const rows = db
    .prepare(
      `SELECT id, bina_id, sayac_id, kapi_no, blok_no
       FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`
    )
    .all();

  for (const row of rows) {
    const key = normMeter(row.sayac_id);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return byKey;
}

function loadBuildingIndex(db) {
  const buildings = db
    .prepare(`SELECT id, value, coordinates FROM binalar`)
    .all()
    .map((b) => {
      let rings = [];
      try {
        const coords = JSON.parse(b.coordinates);
        rings = Array.isArray(coords?.[0]?.[0]) ? coords : [coords];
      } catch {
        rings = [];
      }
      let minLat = 90,
        maxLat = -90,
        minLng = 180,
        maxLng = -180;
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        for (const p of ring) {
          const lat = p[0],
            lng = p[1];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
      return { id: b.id, value: b.value, rings, minLat, maxLat, minLng, maxLng };
    })
    .filter((b) => b.rings.length && b.minLat <= b.maxLat);

  return buildings;
}

function findBinaByPoint(lat, lng, buildings) {
  const pad = 0.0005;
  const candidates = [];
  for (const b of buildings) {
    if (lat < b.minLat - pad || lat > b.maxLat + pad || lng < b.minLng - pad || lng > b.maxLng + pad) {
      continue;
    }
    for (const ring of b.rings) {
      if (ring.length >= 3 && pointInRing(lat, lng, ring)) {
        candidates.push(b);
        break;
      }
    }
  }
  if (candidates.length === 1) return { binaId: candidates[0].id, kaynak: "spatial_in_polygon" };
  if (candidates.length > 1) {
    // Prefer smallest bbox area (more specific building)
    candidates.sort(
      (a, b) => (a.maxLat - a.minLat) * (a.maxLng - a.minLng) - (b.maxLat - b.minLat) * (b.maxLng - b.minLng)
    );
    return { binaId: candidates[0].id, kaynak: "spatial_in_polygon_multi" };
  }
  return null;
}

const excelPath = findExcel();
if (!excelPath) {
  console.error("şayaç/sayac koordinat.xlsx bulunamadı.");
  process.exit(1);
}

if (!existsSync(DEFAULT_XLSX) || excelPath !== DEFAULT_XLSX) {
  try {
    copyFileSync(excelPath, DEFAULT_XLSX);
  } catch {}
}

const wb = XLSX.readFile(excelPath);
const sheetName = wb.SheetNames.find((s) => /konum/i.test(s)) || wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

const db = new DatabaseSync(DB_PATH);
ensureSchema(db);
const sayacIndex = loadSayacIndex(db);
const buildings = loadBuildingIndex(db);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(DB_PATH, join(DATA_DIR, `binalar.before-konum-${stamp}.db`));

const stats = {
  source: excelPath,
  sheet: sheetName,
  total: rows.length,
  imported: 0,
  skipped: 0,
  bad_point: 0,
  crs_fail: 0,
  matched_sayac: 0,
  matched_spatial: 0,
  unmatched: 0,
  sayac_latlng_updated: 0,
  by_type: {},
  by_match: {},
};

db.exec("BEGIN");
db.exec("DELETE FROM sayac_konum");

const insert = db.prepare(`
  INSERT INTO sayac_konum (
    meter_number, meter_key, installation_number, agreement_number, meter_type,
    easting, northing, lat, lng, crs, bina_id, sayac_id_matched, match_kaynak, source_file, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EPSG:5257', ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(meter_key) DO UPDATE SET
    meter_number=excluded.meter_number,
    installation_number=excluded.installation_number,
    agreement_number=excluded.agreement_number,
    meter_type=excluded.meter_type,
    easting=excluded.easting,
    northing=excluded.northing,
    lat=excluded.lat,
    lng=excluded.lng,
    bina_id=excluded.bina_id,
    sayac_id_matched=excluded.sayac_id_matched,
    match_kaynak=excluded.match_kaynak,
    source_file=excluded.source_file,
    updated_at=datetime('now')
`);

const updateSayac = db.prepare(`UPDATE sayac SET lat = ?, lng = ? WHERE id = ?`);

for (const row of rows) {
  const meterNumber = String(row.meter_number ?? "").trim();
  const meterKey = normMeter(meterNumber);
  if (!meterKey) {
    stats.skipped++;
    continue;
  }

  const point = parsePoint(row.location);
  if (!point) {
    stats.bad_point++;
    continue;
  }
  const wgs = toWgs84(point.easting, point.northing);
  if (!wgs) {
    stats.crs_fail++;
    continue;
  }

  const meterType = String(row.value ?? "").trim();
  stats.by_type[meterType || "?"] = (stats.by_type[meterType || "?"] || 0) + 1;

  let binaId = null;
  let sayacMatched = "";
  let matchKaynak = "";

  const hits = sayacIndex.get(meterKey) || [];
  if (hits.length >= 1) {
    const hit = hits[0];
    binaId = hit.bina_id;
    sayacMatched = String(hit.sayac_id);
    matchKaynak = hits.length === 1 ? "sayac_id" : "sayac_id_multi";
    stats.matched_sayac++;
    for (const h of hits) {
      updateSayac.run(wgs.lat, wgs.lng, h.id);
      stats.sayac_latlng_updated++;
    }
  } else {
    const spatial = findBinaByPoint(wgs.lat, wgs.lng, buildings);
    if (spatial) {
      binaId = spatial.binaId;
      matchKaynak = spatial.kaynak;
      stats.matched_spatial++;
    } else {
      stats.unmatched++;
      matchKaynak = "";
    }
  }

  stats.by_match[matchKaynak || "none"] = (stats.by_match[matchKaynak || "none"] || 0) + 1;

  insert.run(
    meterNumber,
    meterKey,
    String(row.installation_number ?? "").trim(),
    String(row.agreement_number ?? "").trim(),
    meterType,
    point.easting,
    point.northing,
    wgs.lat,
    wgs.lng,
    binaId,
    sayacMatched,
    matchKaynak,
    excelPath
  );
  stats.imported++;
}

db.exec("COMMIT");

const reportPath = join(DATA_DIR, `sayac-konum-import-report-${stamp}.json`);
writeFileSync(
  reportPath,
  JSON.stringify({ ...stats, finished_at: new Date().toISOString() }, null, 2),
  "utf8"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      imported: stats.imported,
      matched_sayac: stats.matched_sayac,
      matched_spatial: stats.matched_spatial,
      unmatched: stats.unmatched,
      sayac_latlng_updated: stats.sayac_latlng_updated,
      by_type: stats.by_type,
      by_match: stats.by_match,
      report: reportPath,
      excel: excelPath,
    },
    null,
    2
  )
);
