/**
 * Tüm Rezerv Alanlar.kml → yalnızca eksik bina poligonlarını ekle.
 *
 * Güvenlik:
 * - Mevcut satırları silmez / güncellemez
 * - Sayaç ve bina_bilgi tablolarına dokunmaz
 * - Kimlik, geometri ve mekânsal çakışma varsa atlar (kopya yok)
 *
 *   node scripts/import-missing-rezerv-kml.mjs
 *   node scripts/import-missing-rezerv-kml.mjs --apply
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
const DEFAULT_KML = "C:/Users/Surface/Downloads/Tüm Rezerv Alanlar.kml";
const APPLY = process.argv.includes("--apply");
const kmlArg = process.argv.find((a) => a.startsWith("--kml="));
const KML_PATH = kmlArg ? kmlArg.slice("--kml=".length) : DEFAULT_KML;
const DB_PATH = join(ROOT, "data/binalar.db");

const MALATYA = { minLat: 38.25, maxLat: 38.42, minLng: 38.10, maxLng: 38.40 };
const MIN_AREA_M2 = 8;
const CELL = 0.0006; // ~67 m
const NEAR_ODA_M = 120;
const CENTROID_DUP_M = 6;
const AREA_RATIO_LO = 0.2;
const AREA_RATIO_HI = 5;
const SKIP_OVERLAY_LAYER = /KALDIRIM/i;
const SKIP_VALUE = /YAPI SAHADA YOK|İŞLEM YAPMA|ISLEM YAPMA/i;

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

function inMalatya(c) {
  return (
    c.lat >= MALATYA.minLat &&
    c.lat <= MALATYA.maxLat &&
    c.lng >= MALATYA.minLng &&
    c.lng <= MALATYA.maxLng
  );
}

function cellKey(lat, lng) {
  return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
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

function resolveValue(d, src) {
  const v = String(d.value ?? "").trim();
  if (v) return v;
  const uavt = String(d.national_code ?? "").trim();
  if (uavt) return `UAVT ${uavt}`;
  const block = String(d.building_block ?? "").trim();
  const layout = String(d.building_layout ?? "").trim();
  if (block && layout) return `${block}/${layout}`;
  if (block) return `Ada ${block}`;
  return src === "Maks_Bina" ? `MAKS ${d.id}` : `Bina ${d.id}`;
}

function loadExisting(db) {
  const rows = db
    .prepare(`SELECT id, oda_id, kml_id, id_2, value, layer, coordinates FROM binalar`)
    .all();
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

  return { rows, items, grid, byPair, byKmlId, byId2, byGeom };
}

function findSpatialHit(cand, existing) {
  if (!cand.c) return null;
  const near = nearbyFromGrid(existing.grid, cand.bbox);
  for (const b of near) {
    if (!b.c) continue;
    if (SKIP_OVERLAY_LAYER.test(b.layer)) continue;
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

function nearestOda(cand, existing) {
  if (!cand.c) return null;
  const near = nearbyFromGrid(existing.grid, cand.bbox);
  let best = null;
  let bestD = Infinity;
  for (const b of near) {
    if (!b.c || b.oda_id == null) continue;
    const d = distM(cand.c, b.c);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  if (best && bestD <= NEAR_ODA_M) return { oda_id: best.oda_id, dist_m: bestD, from: best.id };
  return null;
}

function fingerprintExisting(db) {
  return db
    .prepare(
      `SELECT COUNT(*) n,
              MAX(id) max_id,
              SUM(id) sum_id,
              COUNT(DISTINCT kml_id) kml_u,
              COUNT(DISTINCT id_2) id2_u
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
    by_src: {},
    skip: {
      no_polygon: 0,
      outside_bbox: 0,
      tiny_area: 0,
      field_missing: 0,
      identity_pair: 0,
      identity_id2: 0,
      identity_geom: 0,
      spatial_overlap: 0,
      kml_dup_id: 0,
      kml_dup_geom: 0,
    },
    insert: { maks: 0, cad: 0, named: 0, with_abone: 0 },
  };

  const queuedIds = new Set();
  const queuedGeom = new Set();
  const toInsert = [];
  const spatialSamples = [];

  for (const xml of iterKmlPlacemarks(kmlText)) {
    stats.kml_placemarks++;
    const d = parseKmlSimpleData(xml);
    const src = d.gisai_src || "(empty)";
    stats.by_src[src] = (stats.by_src[src] || 0) + 1;

    const rings = parseRings(xml);
    if (!rings.length) {
      stats.skip.no_polygon++;
      continue;
    }
    const c = centroidOf(rings);
    if (!c || !inMalatya(c)) {
      stats.skip.outside_bbox++;
      continue;
    }
    const area = areaM2(rings, d.area);
    if (area < MIN_AREA_M2) {
      stats.skip.tiny_area++;
      continue;
    }
    const valueRaw = String(d.value ?? "").trim();
    if (SKIP_VALUE.test(valueRaw)) {
      stats.skip.field_missing++;
      continue;
    }

    const kmlId = toInt(d.id);
    const id2 = toInt(d.id_2) ?? (src === "Maks_Bina" ? kmlId : null);
    const pair = kmlId != null && id2 != null ? `${kmlId}|${id2}` : null;
    const gk = geomKey(rings);
    const bbox = bboxOf(rings);
    const cand = { rings, c, bbox, area, kmlId, id2, gk, src, d };

    if (pair && existing.byPair.has(pair)) {
      stats.skip.identity_pair++;
      continue;
    }
    if (id2 != null && existing.byId2.has(String(id2))) {
      stats.skip.identity_id2++;
      continue;
    }
    if (src === "Maks_Bina" && kmlId != null && existing.byId2.has(String(kmlId))) {
      stats.skip.identity_id2++;
      continue;
    }
    if (gk && existing.byGeom.has(gk)) {
      stats.skip.identity_geom++;
      continue;
    }

    const hit = findSpatialHit(cand, existing);
    if (hit) {
      stats.skip.spatial_overlap++;
      if (spatialSamples.length < 8) spatialSamples.push({ src, kmlId, value: valueRaw, hit });
      continue;
    }

    if (kmlId != null && queuedIds.has(`${src}:${kmlId}`)) {
      stats.skip.kml_dup_id++;
      continue;
    }
    if (gk && queuedGeom.has(gk)) {
      stats.skip.kml_dup_geom++;
      continue;
    }

    const odaFromKml = toInt(d.oda_id);
    const odaNear = odaFromKml == null ? nearestOda(cand, existing) : null;
    const value = resolveValue(d, src);
    const layer = src === "Maks_Bina" ? "Maks_Bina" : String(d.layer || src);
    const row = {
      oda_id: odaFromKml ?? odaNear?.oda_id ?? null,
      kml_id: kmlId,
      id_2: id2,
      value,
      layer,
      abone_sayisi: toInt(d.abone_sayisi) ?? 0,
      aktif_abone_sayisi: toInt(d.aktif_abone_sayisi) ?? 0,
      building_type_id: toInt(d.building_type_id) ?? 1,
      coordinates: JSON.stringify(rings),
      _src: src,
      _centroid: c,
      _area: Math.round(area * 10) / 10,
      _oda_from: odaFromKml != null ? "kml" : odaNear ? `near:${odaNear.from}` : "null",
    };

    toInsert.push(row);
    if (kmlId != null) queuedIds.add(`${src}:${kmlId}`);
    if (gk) queuedGeom.add(gk);
    if (src === "Maks_Bina") stats.insert.maks++;
    else stats.insert.cad++;
    if (valueRaw) stats.insert.named++;
    if ((row.aktif_abone_sayisi || 0) > 0) stats.insert.with_abone++;
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
      src: r._src,
      kml_id: r.kml_id,
      id_2: r.id_2,
      value: r.value,
      layer: r.layer,
      oda_id: r.oda_id,
      oda_from: r._oda_from,
      abone: r.aktif_abone_sayisi,
      area_m2: r._area,
      centroid: r._centroid,
    })),
  };

  if (!APPLY) {
    const out = join(reportDir, `latest-rezerv-kml-missing-dry-run.json`);
    const stamped = join(reportDir, `rezerv-kml-missing-dry-run-${stamp}.json`);
    writeFileSync(out, JSON.stringify(report, null, 2));
    writeFileSync(stamped, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ...report, samples: report.samples }, null, 2));
    console.log(`\nDry-run rapor: ${out}`);
    console.log("Uygulamak için: node scripts/import-missing-rezerv-kml.mjs --apply");
    db.close();
    return;
  }

  if (!toInsert.length) {
    console.log("Eklenecek eksik bina yok.");
    db.close();
    return;
  }

  const backupDir = join(ROOT, "data/backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `binalar.before-rezerv-kml-${stamp}.db`);
  db.close();
  copyFileSync(DB_PATH, backupPath);

  const wdb = new DatabaseSync(DB_PATH);
  const ins = wdb.prepare(`
    INSERT INTO binalar (
      oda_id, kml_id, id_2, value, layer,
      abone_sayisi, aktif_abone_sayisi, building_type_id, coordinates
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  wdb.exec("BEGIN");
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
  const newLayer = wdb.prepare(`SELECT COUNT(*) n FROM binalar WHERE layer='Maks_Bina'`).get().n;
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
    after: { binalar: after, sayac: sayacAfter, bina_bilgi: bilgiAfter, maks_layer: newLayer },
    preserved_existing: oldStill,
  };
  const out = join(reportDir, `latest-rezerv-kml-missing-apply.json`);
  writeFileSync(out, JSON.stringify(applied, null, 2));
  writeFileSync(join(reportDir, `rezerv-kml-missing-apply-${stamp}.json`), JSON.stringify(applied, null, 2));
  console.log(JSON.stringify({
    inserted: toInsert.length,
    before: before.n,
    after: after.n,
    maks_layer: newLayer,
    sayac_unchanged: sayacAfter,
    bina_bilgi_unchanged: bilgiAfter,
    existing_preserved: oldStill,
    backup: backupPath,
    report: out,
  }, null, 2));
  wdb.close();
}

main();
