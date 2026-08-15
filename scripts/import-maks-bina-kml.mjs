/**
 * Maks_Bina.kml → yalnızca eksik MAKS bina poligonlarını haritaya ekle.
 *
 * Güvenlik:
 * - Mevcut binalar silinmez / güncellenmez
 * - Sayaç ve bina_bilgi tablolarına dokunulmaz
 * - Kimlik veya geometri zaten varsa atlanır
 *
 *   node scripts/import-maks-bina-kml.mjs
 *   node scripts/import-maks-bina-kml.mjs --apply
 *   node scripts/import-maks-bina-kml.mjs --kml="C:/Users/Surface/Downloads/Maks_Bina.kml" --apply
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  iterKmlPlacemarks,
  parseKmlSimpleData,
  pointInRing,
  toMeters,
} from "./lib/diskapi-geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KML = "C:/Users/Surface/Downloads/Maks_Bina.kml";
const APPLY = process.argv.includes("--apply");
const kmlArg = process.argv.find((a) => a.startsWith("--kml="));
const KML_PATH = kmlArg ? kmlArg.slice("--kml=".length) : DEFAULT_KML;
const DB_PATH = join(ROOT, "data/binalar.db");
const LAYER = "Maks_Bina";

/** TOKİ/rezerv + doğu Battalgazi (Erenli/Bahri/İzollu) */
const REGION = { minLat: 38.2, maxLat: 38.5, minLng: 38.05, maxLng: 38.75 };
const MIN_AREA_M2 = 8;
const CELL = 0.0006;
const CENTROID_DUP_M = 6;
const AREA_RATIO_LO = 0.2;
const AREA_RATIO_HI = 5;

function toInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRings(xml) {
  const rings = [];
  const re = /<coordinates>\s*([^<]+?)\s*<\/coordinates>/gi;
  const seen = new Set();
  let m;
  while ((m = re.exec(xml))) {
    const raw = m[1].trim();
    if (seen.has(raw)) continue;
    seen.add(raw);
    const pts = [];
    for (const tok of raw.split(/\s+/)) {
      if (!tok) continue;
      const [lngS, latS] = tok.split(",");
      const lng = Number(lngS);
      const lat = Number(latS);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      pts.push([lat, lng]);
    }
    if (pts.length >= 4) rings.push(pts);
  }
  return rings;
}

function centroidOf(rings) {
  let slat = 0;
  let slng = 0;
  let n = 0;
  for (const ring of rings) {
    const body = ring.length > 1 ? ring.slice(0, -1) : ring;
    const use = body.length >= 3 ? body : ring;
    for (const [lat, lng] of use) {
      slat += lat;
      slng += lng;
      n++;
    }
  }
  if (!n) return null;
  return { lat: slat / n, lng: slng / n };
}

function bboxOf(rings) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const refLat = ring[0][0];
  const refLng = ring[0][1];
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lng1] = ring[i];
    const [lat2, lng2] = ring[(i + 1) % ring.length];
    const p1 = toMeters(lat1, lng1, refLat, refLng);
    const p2 = toMeters(lat2, lng2, refLat, refLng);
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a / 2);
}

function areaM2(rings, kmlArea) {
  const given = toNum(kmlArea);
  if (given != null && given > 0) return given;
  return rings.reduce((s, r) => s + ringAreaM2(r), 0);
}

function geomKey(rings) {
  const c = centroidOf(rings);
  if (!c) return null;
  const verts = rings.reduce((s, r) => s + r.length, 0);
  return `${c.lat.toFixed(6)}|${c.lng.toFixed(6)}|${verts}`;
}

function inRegion(c) {
  return c.lat >= REGION.minLat && c.lat <= REGION.maxLat && c.lng >= REGION.minLng && c.lng <= REGION.maxLng;
}

function addToGrid(grid, item) {
  const { minLat, maxLat, minLng, maxLng } = item.bbox;
  const r0 = Math.floor(minLat / CELL);
  const r1 = Math.floor(maxLat / CELL);
  const c0 = Math.floor(minLng / CELL);
  const c1 = Math.floor(maxLng / CELL);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = `${r}:${c}`;
      let bucket = grid.get(k);
      if (!bucket) {
        bucket = [];
        grid.set(k, bucket);
      }
      bucket.push(item);
    }
  }
}

function nearbyFromGrid(grid, bbox) {
  const r0 = Math.floor(bbox.minLat / CELL) - 1;
  const r1 = Math.floor(bbox.maxLat / CELL) + 1;
  const c0 = Math.floor(bbox.minLng / CELL) - 1;
  const c1 = Math.floor(bbox.maxLng / CELL) + 1;
  const out = [];
  const seen = new Set();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const bucket = grid.get(`${r}:${c}`);
      if (!bucket) continue;
      for (const item of bucket) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
}

function pointInBuilding(lat, lng, rings) {
  for (const ring of rings) {
    if (ring.length >= 3 && pointInRing(lat, lng, ring)) return true;
  }
  return false;
}

function comparableArea(a, b) {
  if (!(a > 0) || !(b > 0)) return false;
  const ratio = a / b;
  return ratio >= AREA_RATIO_LO && ratio <= AREA_RATIO_HI;
}

function distM(a, b) {
  const p = toMeters(a.lat, a.lng, a.lat, a.lng);
  const q = toMeters(b.lat, b.lng, a.lat, a.lng);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

function resolveValue(d) {
  const v = String(d.value ?? "").trim();
  if (v) return v;
  const uavt = String(d.national_code ?? "").trim();
  if (uavt) return `UAVT ${uavt}`;
  const block = String(d.building_block ?? "").trim();
  const layout = String(d.building_layout ?? "").trim();
  if (block && layout) return `${block}/${layout}`;
  if (block) return `Ada ${block}`;
  return `MAKS ${d.id}`;
}

function loadExisting(db) {
  const rows = db.prepare(`SELECT id, oda_id, kml_id, id_2, value, layer, coordinates FROM binalar`).all();
  const byPair = new Set();
  const byKmlId = new Set();
  const byId2 = new Set();
  const byGeom = new Set();
  const items = [];
  const grid = new Map();

  for (const row of rows) {
    let coordinates;
    try {
      coordinates = JSON.parse(row.coordinates);
    } catch {
      continue;
    }
    const rings = Array.isArray(coordinates?.[0]?.[0]) ? coordinates : [coordinates];
    const c = centroidOf(rings);
    const bbox = bboxOf(rings);
    const area = areaM2(rings, null);
    const item = {
      id: row.id,
      oda_id: row.oda_id,
      kml_id: row.kml_id,
      id_2: row.id_2,
      value: row.value,
      layer: row.layer || "",
      rings,
      c,
      bbox,
      area,
    };
    items.push(item);
    if (row.kml_id != null && row.id_2 != null) byPair.add(`${row.kml_id}|${row.id_2}`);
    if (row.kml_id != null) byKmlId.add(String(row.kml_id));
    if (row.id_2 != null && String(row.id_2).trim() !== "") byId2.add(String(row.id_2));
    const gk = geomKey(rings);
    if (gk) byGeom.add(gk);
    if (c) addToGrid(grid, item);
  }

  return { items, grid, byPair, byKmlId, byId2, byGeom };
}

function findSpatialHit(cand, existing) {
  if (!cand.c) return null;
  const near = nearbyFromGrid(existing.grid, cand.bbox);
  for (const b of near) {
    if (!b.c) continue;
    const similar = comparableArea(cand.area, b.area);
    if (similar && pointInBuilding(cand.c.lat, cand.c.lng, b.rings)) {
      return { id: b.id, value: b.value, how: "centroid_in_existing", dist_m: distM(cand.c, b.c) };
    }
    if (similar && pointInBuilding(b.c.lat, b.c.lng, cand.rings)) {
      return { id: b.id, value: b.value, how: "existing_in_new", dist_m: distM(cand.c, b.c) };
    }
    const d = distM(cand.c, b.c);
    if (d <= CENTROID_DUP_M && similar) {
      return { id: b.id, value: b.value, how: "centroid_near", dist_m: d };
    }
  }
  return null;
}

function fingerprintExisting(db) {
  return db
    .prepare(
      `SELECT COUNT(*) n, MAX(id) max_id, SUM(id) sum_id,
              COUNT(DISTINCT kml_id) kml_u, COUNT(DISTINCT id_2) id2_u
       FROM binalar`
    )
    .get();
}

function main() {
  if (!existsSync(KML_PATH)) throw new Error(`KML bulunamadı: ${KML_PATH}`);
  if (!existsSync(DB_PATH)) throw new Error(`DB bulunamadı: ${DB_PATH}`);

  const db = new DatabaseSync(DB_PATH);
  const before = fingerprintExisting(db);
  const sayacN = db.prepare(`SELECT COUNT(*) n FROM sayac`).get().n;
  const bilgiN = db.prepare(`SELECT COUNT(*) n FROM bina_bilgi`).get().n;
  const existing = loadExisting(db);
  const kmlText = readFileSync(KML_PATH, "utf8");

  const stats = {
    kml_path: KML_PATH,
    kml_placemarks: 0,
    skip: {
      no_polygon: 0,
      outside_bbox: 0,
      tiny_area: 0,
      identity_pair: 0,
      identity_id: 0,
      identity_geom: 0,
      spatial_overlap: 0,
      kml_dup_id: 0,
      kml_dup_geom: 0,
    },
    insert: { named: 0, with_abone: 0, with_uavt: 0 },
  };

  const queuedIds = new Set();
  const queuedGeom = new Set();
  const toInsert = [];
  const spatialSamples = [];

  for (const xml of iterKmlPlacemarks(kmlText)) {
    stats.kml_placemarks++;
    const d = parseKmlSimpleData(xml);
    const rings = parseRings(xml);
    if (!rings.length) {
      stats.skip.no_polygon++;
      continue;
    }
    const c = centroidOf(rings);
    if (!c || !inRegion(c)) {
      stats.skip.outside_bbox++;
      continue;
    }
    const area = areaM2(rings, d.area);
    if (area < MIN_AREA_M2) {
      stats.skip.tiny_area++;
      continue;
    }

    const kmlId = toInt(d.id);
    const id2 = kmlId;
    const pair = kmlId != null ? `${kmlId}|${id2}` : null;
    const gk = geomKey(rings);
    const bbox = bboxOf(rings);
    const cand = { rings, c, bbox, area };

    if (pair && existing.byPair.has(pair)) {
      stats.skip.identity_pair++;
      continue;
    }
    if (kmlId != null && (existing.byKmlId.has(String(kmlId)) || existing.byId2.has(String(kmlId)))) {
      stats.skip.identity_id++;
      continue;
    }
    if (gk && existing.byGeom.has(gk)) {
      stats.skip.identity_geom++;
      continue;
    }

    const hit = findSpatialHit(cand, existing);
    if (hit) {
      stats.skip.spatial_overlap++;
      if (spatialSamples.length < 8) spatialSamples.push({ kmlId, value: d.value || "", hit });
      continue;
    }

    if (kmlId != null && queuedIds.has(kmlId)) {
      stats.skip.kml_dup_id++;
      continue;
    }
    if (gk && queuedGeom.has(gk)) {
      stats.skip.kml_dup_geom++;
      continue;
    }

    const value = resolveValue(d);
    const aktif = toInt(d.aktif_abone_sayisi) ?? 0;
    const abone = toInt(d.abone_sayisi) ?? aktif;
    toInsert.push({
      oda_id: toInt(d.oda_id),
      kml_id: kmlId,
      id_2: id2,
      value,
      layer: LAYER,
      abone_sayisi: abone,
      aktif_abone_sayisi: aktif,
      building_type_id: toInt(d.building_type_id) ?? 1,
      coordinates: JSON.stringify(rings),
      _centroid: c,
      _area: Math.round(area * 10) / 10,
      _uavt: String(d.national_code ?? "").trim(),
    });
    if (kmlId != null) queuedIds.add(kmlId);
    if (gk) queuedGeom.add(gk);
    if (String(d.value ?? "").trim()) stats.insert.named++;
    if (aktif > 0) stats.insert.with_abone++;
    if (String(d.national_code ?? "").trim()) stats.insert.with_uavt++;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = join(ROOT, "data/import-reports");
  mkdirSync(reportDir, { recursive: true });

  const insertBbox = { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 };
  for (const r of toInsert) {
    insertBbox.minLat = Math.min(insertBbox.minLat, r._centroid.lat);
    insertBbox.maxLat = Math.max(insertBbox.maxLat, r._centroid.lat);
    insertBbox.minLng = Math.min(insertBbox.minLng, r._centroid.lng);
    insertBbox.maxLng = Math.max(insertBbox.maxLng, r._centroid.lng);
  }

  const report = {
    mode: APPLY ? "apply" : "dry-run",
    at: new Date().toISOString(),
    before: { binalar: before, sayac: sayacN, bina_bilgi: bilgiN },
    stats,
    insert_count: toInsert.length,
    insert_bbox: toInsert.length ? insertBbox : null,
    spatial_skip_samples: spatialSamples,
    samples: toInsert.slice(0, 12).map((r) => ({
      kml_id: r.kml_id,
      value: r.value,
      layer: r.layer,
      abone: r.aktif_abone_sayisi,
      uavt: r._uavt,
      area_m2: r._area,
      centroid: r._centroid,
    })),
  };

  if (!APPLY) {
    const out = join(reportDir, `latest-maks-bina-kml-dry-run.json`);
    writeFileSync(out, JSON.stringify(report, null, 2));
    writeFileSync(join(reportDir, `maks-bina-kml-dry-run-${stamp}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nDry-run rapor: ${out}`);
    console.log("Uygulamak için: node scripts/import-maks-bina-kml.mjs --apply");
    db.close();
    return;
  }

  if (!toInsert.length) {
    console.log("Eklenecek eksik Maks_Bina yok.");
    db.close();
    return;
  }

  const backupDir = join(ROOT, "data/backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `binalar.before-maks-bina-kml-${stamp}.db`);
  db.close();
  copyFileSync(DB_PATH, backupPath);

  const wdb = new DatabaseSync(DB_PATH);
  const ins = wdb.prepare(`
    INSERT INTO binalar (
      oda_id, kml_id, id_2, value, layer,
      abone_sayisi, aktif_abone_sayisi, building_type_id, coordinates
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  wdb.exec("BEGIN IMMEDIATE");
  try {
    for (const r of toInsert) {
      ins.run(
        r.oda_id,
        r.kml_id,
        r.id_2,
        r.value,
        r.layer,
        r.abone_sayisi,
        r.aktif_abone_sayisi,
        r.building_type_id,
        r.coordinates
      );
    }
    wdb.exec("COMMIT");
  } catch (err) {
    wdb.exec("ROLLBACK");
    throw err;
  }

  const after = fingerprintExisting(wdb);
  const sayacAfter = wdb.prepare(`SELECT COUNT(*) n FROM sayac`).get().n;
  const bilgiAfter = wdb.prepare(`SELECT COUNT(*) n FROM bina_bilgi`).get().n;
  const maksLayer = wdb.prepare(`SELECT COUNT(*) n FROM binalar WHERE layer='Maks_Bina'`).get().n;
  const oldStill = wdb.prepare(`SELECT COUNT(*) n FROM binalar WHERE id <= ?`).get(before.max_id).n;

  if (sayacAfter !== sayacN) throw new Error(`Sayaç sayısı değişti: ${sayacN} → ${sayacAfter}`);
  if (bilgiAfter !== bilgiN) throw new Error(`bina_bilgi sayısı değişti: ${bilgiN} → ${bilgiAfter}`);
  if (oldStill !== before.n) throw new Error(`Eski bina satırları korunamiyor: ${before.n} → ${oldStill}`);
  if (after.n !== before.n + toInsert.length) {
    throw new Error(`Toplam beklenen ${before.n + toInsert.length}, gerçek ${after.n}`);
  }

  const applied = {
    ...report,
    backup: backupPath,
    after: { binalar: after, sayac: sayacAfter, bina_bilgi: bilgiAfter, maks_layer: maksLayer },
    preserved_existing: oldStill,
  };
  const out = join(reportDir, `latest-maks-bina-kml-apply.json`);
  writeFileSync(out, JSON.stringify(applied, null, 2));
  writeFileSync(join(reportDir, `maks-bina-kml-apply-${stamp}.json`), JSON.stringify(applied, null, 2));
  console.log(
    JSON.stringify(
      {
        inserted: toInsert.length,
        before: before.n,
        after: after.n,
        maks_layer: maksLayer,
        sayac_unchanged: sayacAfter,
        bina_bilgi_unchanged: bilgiAfter,
        existing_preserved: oldStill,
        backup: backupPath,
        report: out,
      },
      null,
      2
    )
  );
  wdb.close();
}

main();
