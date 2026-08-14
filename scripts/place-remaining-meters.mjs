/**
 * Kalan Excel sayaçlarını yalnızca doğru koordinattaki binaya yerleştirir.
 * - Üst üste poligon: en küçük (iç) bina
 * - GPS kayması: tek aday ve ≤ 8 m
 * - Mevcut KML yoksa: o noktadaki OSM bina poligonu + adres etiketi
 * - Km uzaktaki mevcut binaya yazılmaz
 *
 *   node scripts/place-remaining-meters.mjs
 *   node scripts/place-remaining-meters.mjs --apply
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { argValue, hasFlag, meterDigits, stampIso } from "./lib/meter-coord-import/common.mjs";
import { readCoordinateWorkbook } from "./lib/meter-coord-import/parsers.mjs";
import { projectPoint } from "./lib/meter-coord-import/crs.mjs";
import {
  loadBuildingSpatialIndex,
  matchPointToBuildings,
  minDistanceMeters,
  pointInBuilding,
  BOUNDARY_EPS_M,
} from "./lib/meter-coord-import/spatial.mjs";
import { MARKA_FROM_VALUE } from "./lib/meter-coord-import/plan.mjs";
import { createDbBackup } from "./lib/meter-coord-import/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const BACKUP_DIR = join(ROOT, "data/backups");
const DEFAULT_EXCEL = "C:/Users/Surface/Downloads/şayaç koordinat.xlsx";
const CRS = "EPSG:5258";
const SNAP_M = 8;
const OSM_AROUND_M = 8;
const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function osmRings(way) {
  const geom = way.geometry || [];
  const ring = geom.map((p) => [Number(p.lat), Number(p.lon)]).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (ring.length < 3) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring.length >= 4 ? [ring] : [];
}

function osmLabel(tags, osmId) {
  const t = tags || {};
  const named = String(t.name || "").trim();
  if (named) return named.slice(0, 120);
  const street = String(t["addr:street"] || "").trim();
  const no = String(t["addr:housenumber"] || "").trim();
  const addr = [street, no].filter(Boolean).join(" ");
  if (addr) return addr.slice(0, 120);
  return `OSM ${osmId}`;
}

function osmAddress(tags) {
  const t = tags || {};
  return {
    sokak: String(t["addr:street"] || "").trim(),
    dis_kapi_no: String(t["addr:housenumber"] || "").trim(),
  };
}

async function fetchOverpass(query) {
  let lastErr = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json",
          "User-Agent": "LoraSayacTakip/place-remaining-meters",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass HTTP ${res.status} ${url}`);
        continue;
      }
      return res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Overpass başarısız");
}

async function fetchOsmBuildings(points) {
  const CELL = 0.02;
  const cells = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.lat / CELL)}_${Math.floor(p.lng / CELL)}`;
    if (!cells.has(key)) {
      const i = Math.floor(p.lat / CELL);
      const j = Math.floor(p.lng / CELL);
      cells.set(key, {
        south: i * CELL,
        north: (i + 1) * CELL,
        west: j * CELL,
        east: (j + 1) * CELL,
      });
    }
  }
  const ways = new Map();
  const list = [...cells.values()];
  console.log(`OSM hücre: ${list.length}`);
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const query = `[out:json][timeout:60];way["building"](${c.south.toFixed(5)},${c.west.toFixed(5)},${c.north.toFixed(5)},${c.east.toFixed(5)});out geom;`;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        const json = await fetchOverpass(query);
        for (const el of json.elements || []) {
          if (el.type !== "way" || !el.id) continue;
          const rings = osmRings(el);
          if (!rings.length) continue;
          ways.set(el.id, { osmId: el.id, tags: el.tags || {}, rings });
        }
        ok = true;
      } catch (err) {
        console.error(`OSM hücre ${i + 1}/${list.length} deneme ${attempt + 1}:`, err.message);
        await sleep(2000 * (attempt + 1));
      }
    }
    if (i + 1 < list.length) await sleep(1500);
  }
  return [...ways.values()];
}

function matchOsm(lat, lng, osmBuildings) {
  const inside = [];
  let nearest = null;
  for (const b of osmBuildings) {
    const dist = minDistanceMeters(lat, lng, b.rings);
    const pip = pointInBuilding(lat, lng, b.rings);
    const onBoundary = dist.meters != null && dist.meters <= BOUNDARY_EPS_M;
    if (pip || onBoundary) inside.push({ building: b, meters: pip ? 0 : dist.meters ?? 0 });
    if (dist.meters != null && (!nearest || dist.meters < nearest.meters)) {
      nearest = { building: b, meters: dist.meters };
    }
  }
  if (inside.length === 1) return { building: inside[0].building, meters: inside[0].meters, method: "osm_inside" };
  if (inside.length > 1) {
    inside.sort((a, b) => a.meters - b.meters);
    const areas = inside.map((h) => {
      let area = 0;
      for (const ring of h.building.rings) {
        for (let i = 0; i < ring.length; i++) {
          const [lat1, lng1] = ring[i];
          const [lat2, lng2] = ring[(i + 1) % ring.length];
          area += lng1 * lat2 - lng2 * lat1;
        }
      }
      return { ...h, area: Math.abs(area) };
    });
    areas.sort((a, b) => a.area - b.area);
    return { building: areas[0].building, meters: areas[0].meters, method: "osm_smallest" };
  }
  if (nearest && nearest.meters <= OSM_AROUND_M) {
    return { building: nearest.building, meters: nearest.meters, method: "osm_near" };
  }
  return null;
}

async function main() {
  const apply = hasFlag(process.argv, "--apply");
  const noOsm = hasFlag(process.argv, "--no-osm");
  const excelPath = argValue(process.argv, "--excel") || DEFAULT_EXCEL;
  if (!existsSync(excelPath)) {
    console.error("Excel yok:", excelPath);
    process.exit(1);
  }

  const excel = readCoordinateWorkbook(excelPath);
  const db = new DatabaseSync(DB_PATH, { readOnly: !apply });
  const index = loadBuildingSpatialIndex(db);

  const existingExact = new Set(
    db
      .prepare(`SELECT TRIM(sayac_id) id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
      .all()
      .map((r) => r.id)
  );
  const existingDigits = new Set(
    [...existingExact].map((id) => meterDigits(id)).filter(Boolean)
  );

  const seenMeter = new Set();
  const already = [];
  const duplicate = [];
  const matched = [];
  const unmatchedPoints = [];
  const unmatchedRowsByKey = new Map();

  for (const row of excel.rows) {
    if (!row.meter_ok || !row.meter_number || !row.point) continue;
    if (seenMeter.has(row.meter_number)) {
      duplicate.push(row.meter_number);
      continue;
    }
    seenMeter.add(row.meter_number);
    if (existingExact.has(row.meter_number) || existingDigits.has(meterDigits(row.meter_number))) {
      already.push(row.meter_number);
      continue;
    }
    const wgs = projectPoint(row.point.x, row.point.y, CRS);
    if (!wgs) continue;
    const match = matchPointToBuildings(index, wgs.lat, wgs.lng, SNAP_M, BOUNDARY_EPS_M);
    if (match.building) {
      matched.push({
        meter_number: row.meter_number,
        installation_number: row.installation_number,
        agreement_number: row.agreement_number,
        value: row.value,
        bina_id: match.building.id,
        bina_value: match.building.value,
        bina_layer: match.building.layer,
        method: match.method,
        overlay: match.overlay,
        meters: match.meters,
        lat: wgs.lat,
        lng: wgs.lng,
      });
      continue;
    }
    const key = `${wgs.lat.toFixed(7)}_${wgs.lng.toFixed(7)}`;
    if (!unmatchedRowsByKey.has(key)) {
      unmatchedRowsByKey.set(key, { lat: wgs.lat, lng: wgs.lng, rows: [] });
      unmatchedPoints.push({ lat: wgs.lat, lng: wgs.lng, key });
    }
    unmatchedRowsByKey.get(key).rows.push(row);
  }

  const osmPlan = [];
  let osmBuildings = [];
  if (!noOsm && unmatchedPoints.length) {
    console.log(`OSM sorgu: ${unmatchedPoints.length} eşleşmeyen nokta`);
    osmBuildings = await fetchOsmBuildings(unmatchedPoints);
    console.log(`OSM bina: ${osmBuildings.length}`);
  }

  const osmToCreate = new Map();
  for (const [key, group] of unmatchedRowsByKey) {
    const osm = matchOsm(group.lat, group.lng, osmBuildings);
    if (!osm) continue;
    if (!osmToCreate.has(osm.building.osmId)) {
      const addr = osmAddress(osm.building.tags);
      osmToCreate.set(osm.building.osmId, {
        osmId: osm.building.osmId,
        value: osmLabel(osm.building.tags, osm.building.osmId),
        layer: "OSM_Bina",
        coordinates: JSON.stringify(osm.building.rings),
        sokak: addr.sokak,
        dis_kapi_no: addr.dis_kapi_no,
        meters: [],
      });
    }
    for (const row of group.rows) {
      osmToCreate.get(osm.building.osmId).meters.push({
        meter_number: row.meter_number,
        installation_number: row.installation_number,
        agreement_number: row.agreement_number,
        value: row.value,
        lat: group.lat,
        lng: group.lng,
        method: osm.method,
        meters: osm.meters,
      });
    }
  }

  const osmMeterCount = [...osmToCreate.values()].reduce((s, b) => s + b.meters.length, 0);
  const placedKeys = new Set();
  for (const b of osmToCreate.values()) {
    for (const m of b.meters) placedKeys.add(`${m.lat.toFixed(7)}_${m.lng.toFixed(7)}`);
  }
  const stillUnmatched = unmatchedPoints.filter((p) => !placedKeys.has(p.key));
  const stillRows = stillUnmatched.reduce((s, p) => s + (unmatchedRowsByKey.get(p.key)?.rows.length || 0), 0);

  const report = {
    mode: apply ? "apply" : "dry-run",
    snapMeters: SNAP_M,
    osmAroundMeters: OSM_AROUND_M,
    alreadyInDb: already.length,
    duplicateSource: duplicate.length,
    matchedExistingPolygon: matched.length,
    osmBuildingsToCreate: osmToCreate.size,
    osmMeters: osmMeterCount,
    stillUnmatchedPoints: stillUnmatched.length,
    stillUnmatchedRows: stillRows,
    methodDist: matched.reduce((acc, r) => {
      const k = r.overlay ? `${r.method}:${r.overlay}` : r.method;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
    sampleMatched: matched.slice(0, 8).map((r) => ({
      meter: r.meter_number,
      bina: r.bina_value,
      method: r.overlay || r.method,
      m: r.meters,
    })),
    sampleOsm: [...osmToCreate.values()].slice(0, 8).map((b) => ({
      name: b.value,
      sokak: b.sokak,
      kapi: b.dis_kapi_no,
      sayac: b.meters.length,
    })),
  };

  const outDir = join(ROOT, "data/import-reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = stampIso();
  writeFileSync(join(outDir, `latest-place-remaining-${apply ? "apply" : "dry-run"}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log("\nUygulamak için: node scripts/place-remaining-meters.mjs --apply");
    db.close();
    return;
  }

  db.close();
  const backup = createDbBackup(DB_PATH, BACKUP_DIR, "place-remaining");
  const wdb = new DatabaseSync(DB_PATH);
  wdb.exec("PRAGMA busy_timeout = 15000");

  const maxBirim = new Map(
    wdb.prepare("SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id").all().map((r) => [r.bina_id, r.m || 0])
  );
  const nextBirim = (binaId) => {
    const n = (maxBirim.get(binaId) || 0) + 1;
    maxBirim.set(binaId, n);
    return n;
  };
  const insertSayac = wdb.prepare(`
    INSERT INTO sayac (
      bina_id, birim_no, sayac_id, sayac_markasi, abone_no, sicil_no,
      tesisat_no, sozlesme_no, kaynak, kullanilis_sekli, sayac_durum, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, 'place-remaining', 'DAİRE', 'gecerli', datetime('now'))
  `);
  const insertBina = wdb.prepare(`
    INSERT INTO binalar (
      oda_id, kml_id, id_2, value, layer,
      abone_sayisi, aktif_abone_sayisi, building_type_id, coordinates
    ) VALUES (NULL, ?, NULL, ?, ?, 0, 0, NULL, ?)
  `);
  const insertBilgi = wdb.prepare(`
    INSERT INTO bina_bilgi (
      bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
    ) VALUES (?, 0, ?, 0, ?, 1, '', ?, ?, datetime('now'))
    ON CONFLICT(bina_id) DO UPDATE SET
      daire_sayisi = CASE WHEN daire_sayisi < excluded.daire_sayisi THEN excluded.daire_sayisi ELSE daire_sayisi END,
      toplam_bagımsız_bolum = CASE WHEN toplam_bagımsız_bolum < excluded.toplam_bagımsız_bolum THEN excluded.toplam_bagımsız_bolum ELSE toplam_bagımsız_bolum END,
      sokak = CASE WHEN TRIM(COALESCE(sokak,'')) = '' THEN excluded.sokak ELSE sokak END,
      dis_kapi_no = CASE WHEN TRIM(COALESCE(dis_kapi_no,'')) = '' THEN excluded.dis_kapi_no ELSE dis_kapi_no END,
      has_zemin = CASE WHEN kat_sayisi = 0 AND has_zemin = 0 THEN 1 ELSE has_zemin END,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  const binaCounts = new Map();
  wdb.exec("BEGIN IMMEDIATE");
  try {
    for (const row of matched) {
      const marka = MARKA_FROM_VALUE[row.value] || "";
      insertSayac.run(
        row.bina_id,
        nextBirim(row.bina_id),
        row.meter_number,
        marka,
        row.installation_number || "",
        row.installation_number || "",
        row.agreement_number || ""
      );
      inserted++;
      binaCounts.set(row.bina_id, (binaCounts.get(row.bina_id) || 0) + 1);
    }

    for (const b of osmToCreate.values()) {
      const info = insertBina.run(b.osmId, b.value, b.layer, b.coordinates);
      const binaId = Number(info.lastInsertRowid);
      for (const row of b.meters) {
        const marka = MARKA_FROM_VALUE[row.value] || "";
        insertSayac.run(
          binaId,
          nextBirim(binaId),
          row.meter_number,
          marka,
          row.installation_number || "",
          row.installation_number || "",
          row.agreement_number || ""
        );
        inserted++;
      }
      binaCounts.set(binaId, (binaCounts.get(binaId) || 0) + b.meters.length);
      insertBilgi.run(binaId, b.meters.length, b.meters.length, b.sokak, b.dis_kapi_no);
    }

    for (const [binaId, n] of binaCounts) {
      insertBilgi.run(binaId, n, n, "", "");
    }

    wdb.exec("COMMIT");
  } catch (e) {
    wdb.exec("ROLLBACK");
    console.error("ROLLBACK:", e);
    wdb.close();
    process.exit(1);
  }

  report.backup = backup.backupPath.replace(/\\/g, "/");
  report.inserted = inserted;
  report.buildingsTouched = binaCounts.size;
  writeFileSync(join(outDir, "latest-place-remaining-apply.json"), JSON.stringify(report, null, 2));
  console.log("inserted", inserted, "backup", report.backup);
  wdb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
