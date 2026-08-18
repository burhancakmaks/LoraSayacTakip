/**
 * Yakınca'dan çıkarılan Excel sayaçlarını Yakınca dışındaki en yakın mantıklı binaya yazar.
 *
 *   node scripts/assign-yakinca-excluded.mjs
 *   node scripts/assign-yakinca-excluded.mjs --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { hasFlag, meterDigits, median, percentile, stampIso } from "./lib/meter-coord-import/common.mjs";
import { readCoordinateWorkbook } from "./lib/meter-coord-import/parsers.mjs";
import { projectPoint } from "./lib/meter-coord-import/crs.mjs";
import {
  loadBuildingSpatialIndex,
  minDistanceMeters,
  resolveOverlayHits,
  BOUNDARY_EPS_M,
} from "./lib/meter-coord-import/spatial.mjs";
import { MARKA_FROM_VALUE } from "./lib/meter-coord-import/plan.mjs";
import { createDbBackup } from "./lib/meter-coord-import/apply.mjs";
import { metersPerDegLng } from "./lib/diskapi-geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const BACKUP_DIR = join(ROOT, "data/backups");
const EXCEL = "C:/Users/Surface/Downloads/şayaç koordinat.xlsx";
const CRS = "EPSG:5258";
const KAYNAK = "assign-yakinca-excluded";
const M_PER_DEG_LAT = 111_320;

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

function bboxDistMeters(lat, lng, bbox) {
  const clampLat = Math.min(Math.max(lat, bbox.minLat), bbox.maxLat);
  const clampLng = Math.min(Math.max(lng, bbox.minLng), bbox.maxLng);
  if (clampLat === lat && clampLng === lng) return 0;
  const dx = (lng - clampLng) * metersPerDegLng(lat);
  const dy = (lat - clampLat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function isGeneratedName(value) {
  return /^\s*Bina\s*#\d+\s*$/i.test(String(value || "").trim());
}

function bucketMeters(m) {
  if (m == null || !Number.isFinite(m)) return "none";
  if (m <= 8) return "0-8m";
  if (m <= 25) return "8-25m";
  if (m <= 50) return "25-50m";
  if (m <= 137) return "50-137m";
  if (m <= 500) return "137-500m";
  if (m <= 2000) return "500m-2km";
  if (m <= 10000) return "2-10km";
  return "10km+";
}

function pickLogical(hits) {
  if (!hits.length) return null;
  const resolved = resolveOverlayHits(hits);
  if (resolved.building) {
    const hit = hits.find((h) => h.building.id === resolved.building.id) || hits[0];
    return {
      building: resolved.building,
      overlay: resolved.overlay || "nearest",
      meters: hit.meters,
      second: hits.find((h) => h.building.id !== resolved.building.id)?.meters ?? null,
    };
  }
  const ranked = [...hits].sort((a, b) => {
    if (Math.abs(a.meters - b.meters) > 1e-6) return a.meters - b.meters;
    const sa = a.building.sayacCount || 0;
    const sb = b.building.sayacCount || 0;
    if (sb !== sa) return sb - sa;
    const ga = isGeneratedName(a.building.value);
    const gb = isGeneratedName(b.building.value);
    if (ga !== gb) return ga ? 1 : -1;
    const aMaks = /Maks_Bina/i.test(a.building.layer || "") ? 0 : 1;
    const bMaks = /Maks_Bina/i.test(b.building.layer || "") ? 0 : 1;
    if (aMaks !== bMaks) return aMaks - bMaks;
    return a.building.id - b.building.id;
  });
  const named = ranked.find((h) => !isGeneratedName(h.building.value) && h.meters <= ranked[0].meters + 25);
  const chosen = named && ranked[0] && isGeneratedName(ranked[0].building.value) ? named : ranked[0];
  return {
    building: chosen.building,
    overlay: named && chosen === named && chosen !== ranked[0] ? "named_over_generated" : "nearest_tiebreak",
    meters: chosen.meters,
    second: ranked.find((h) => h.building.id !== chosen.building.id)?.meters ?? null,
  };
}

function matchOutsideYakinca(searchable, lat, lng) {
  const inside = [];
  let minM = Infinity;
  const near = [];
  for (const b of searchable) {
    const bd = bboxDistMeters(lat, lng, b.bbox);
    if (bd > Math.max(minM, 250) && inside.length === 0) continue;
    const dist = minDistanceMeters(lat, lng, b.rings);
    if (dist.meters == null) continue;
    const onBoundary = dist.meters <= BOUNDARY_EPS_M;
    if (dist.inside || onBoundary) {
      inside.push({ building: b, meters: dist.inside ? 0 : dist.meters });
    }
    if (dist.meters < minM - 1e-9) {
      minM = dist.meters;
      near.length = 0;
    }
    if (dist.meters <= minM + Math.max(1, minM * 0.15)) {
      near.push({ building: b, meters: dist.meters });
    }
  }
  if (inside.length) {
    const resolved = resolveOverlayHits(inside);
    if (resolved.building) {
      const hit = inside.find((h) => h.building.id === resolved.building.id) || inside[0];
      return {
        building: resolved.building,
        overlay: resolved.overlay ? `inside:${resolved.overlay}` : "inside",
        meters: hit.meters,
        second: inside.find((h) => h.building.id !== resolved.building.id)?.meters ?? null,
      };
    }
  }
  near.sort((a, b) => a.meters - b.meters);
  return pickLogical(near);
}

function main() {
  const apply = hasFlag(process.argv, "--apply");
  const excel = readCoordinateWorkbook(EXCEL);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });

  const mahalle = db.prepare("SELECT name, coordinates FROM mahalleler WHERE name = 'Yakınca Mahallesi'").get();
  if (!mahalle) {
    console.error("Yakınca Mahallesi bulunamadı");
    process.exit(1);
  }
  const ring = mahalleRing(mahalle.coordinates);
  if (!ring) {
    console.error("Yakınca poligonu okunamadı");
    process.exit(1);
  }

  const yakincaIds = new Set();
  for (const b of db.prepare("SELECT id, value, coordinates FROM binalar").all()) {
    if (/YAKINCA/i.test(String(b.value || ""))) {
      yakincaIds.add(b.id);
      continue;
    }
    const c = centroid(b.coordinates);
    if (c && pointInRing(c.lat, c.lng, ring)) yakincaIds.add(b.id);
  }

  const index = loadBuildingSpatialIndex(db);
  const searchable = index.searchable.filter((b) => !yakincaIds.has(b.id));

  const existingExact = new Set(
    db.prepare(`SELECT TRIM(sayac_id) id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`).all().map((r) => r.id)
  );
  const existingDigits = new Set([...existingExact].map((id) => meterDigits(id)).filter(Boolean));

  const seenMeter = new Set();
  const remaining = [];
  let already = 0;
  let duplicate = 0;
  let empty = 0;

  for (const row of excel.rows) {
    if (!row.meter_ok || !row.meter_number) {
      empty++;
      continue;
    }
    if (seenMeter.has(row.meter_number)) {
      duplicate++;
      continue;
    }
    seenMeter.add(row.meter_number);
    if (existingExact.has(row.meter_number) || existingDigits.has(meterDigits(row.meter_number))) {
      already++;
      continue;
    }
    if (!row.point) continue;
    const wgs = projectPoint(row.point.x, row.point.y, CRS);
    if (!wgs) continue;
    remaining.push({
      meter_number: row.meter_number,
      installation_number: row.installation_number,
      agreement_number: row.agreement_number,
      value: row.value,
      lat: wgs.lat,
      lng: wgs.lng,
    });
  }

  const uniqueKeys = new Map();
  for (const row of remaining) {
    const key = `${row.lat.toFixed(7)}_${row.lng.toFixed(7)}`;
    if (!uniqueKeys.has(key)) uniqueKeys.set(key, { lat: row.lat, lng: row.lng, rows: [] });
    uniqueKeys.get(key).rows.push(row);
  }

  const matched = [];
  const skipped = [];
  const distances = [];
  let i = 0;
  for (const group of uniqueKeys.values()) {
    i++;
    if (i % 20 === 0) console.error(`nokta ${i}/${uniqueKeys.size}`);
    const picked = matchOutsideYakinca(searchable, group.lat, group.lng);
    if (!picked?.building) {
      skipped.push({ rows: group.rows.length, lat: group.lat, lng: group.lng, reason: "NO_NEAR_BUILDING" });
      continue;
    }
    distances.push(picked.meters);
    for (const row of group.rows) {
      matched.push({
        ...row,
        bina_id: picked.building.id,
        bina_value: picked.building.value,
        bina_layer: picked.building.layer,
        method: picked.overlay,
        meters: picked.meters,
        secondMeters: picked.second,
      });
    }
  }

  const finite = [...distances].sort((a, b) => a - b);
  const methodDist = matched.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {});
  const distanceBuckets = matched.reduce((acc, r) => {
    const k = bucketMeters(r.meters);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const byBina = new Map();
  for (const r of matched) {
    const k = `${r.bina_id}|${r.bina_value}`;
    byBina.set(k, (byBina.get(k) || 0) + 1);
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    excludeMahalle: "Yakınca Mahallesi",
    yakincaBuildingsExcluded: yakincaIds.size,
    searchableBuildings: searchable.length,
    alreadyInDb: already,
    duplicateSource: duplicate,
    emptyOrInvalid: empty,
    remainingRows: remaining.length,
    remainingPoints: uniqueKeys.size,
    matchedRows: matched.length,
    skippedRows: remaining.length - matched.length,
    methodDist,
    distanceBuckets,
    distance: {
      min: finite[0] ?? null,
      p10: percentile(finite, 10),
      median: median(finite),
      p90: percentile(finite, 90),
      max: finite.at(-1) ?? null,
    },
    topBuildings: [...byBina.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => {
        const [id, value] = k.split("|");
        return { bina_id: Number(id), value, n };
      }),
    sampleMatched: matched.slice(0, 12).map((r) => ({
      meter: r.meter_number,
      bina: r.bina_value,
      method: r.method,
      m: r.meters,
      second: r.secondMeters,
    })),
    sampleSkipped: skipped.slice(0, 8),
  };

  const outDir = join(ROOT, "data/import-reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = stampIso();
  writeFileSync(join(outDir, `latest-assign-yakinca-excluded-${apply ? "apply" : "dry-run"}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, `${stamp}-assign-yakinca-excluded.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log("\nUygulamak için: node scripts/assign-yakinca-excluded.mjs --apply");
    db.close();
    return;
  }
  db.close();

  if (!matched.length) {
    console.log("Atama yok");
    return;
  }

  const backup = createDbBackup(DB_PATH, BACKUP_DIR, "yakinca-excluded");
  const wdb = new DatabaseSync(DB_PATH);
  wdb.exec("PRAGMA busy_timeout = 15000");
  wdb.exec("PRAGMA foreign_keys = ON");
  const maxBirim = new Map(
    wdb.prepare("SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id").all().map((r) => [r.bina_id, r.m || 0])
  );
  const nextBirim = (binaId) => {
    const n = (maxBirim.get(binaId) || 0) + 1;
    maxBirim.set(binaId, n);
    return n;
  };
  const binaName = new Map(wdb.prepare("SELECT id, value FROM binalar").all().map((r) => [r.id, String(r.value || "").trim()]));
  const insertSayac = wdb.prepare(`
    INSERT INTO sayac (
      bina_id, birim_no, sayac_id, sayac_markasi, abone_no, sicil_no,
      tesisat_no, sozlesme_no, kaynak, kullanilis_sekli, sayac_durum, blok_no, updated_at
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'DAİRE', 'gecerli', ?, datetime('now'))
  `);
  const fillEmptyBilgi = wdb.prepare(`
    INSERT INTO bina_bilgi (
      bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
    ) VALUES (?, 0, ?, 0, ?, 1, '', '', '', datetime('now'))
    ON CONFLICT(bina_id) DO UPDATE SET
      daire_sayisi = CASE WHEN COALESCE(daire_sayisi,0) = 0 THEN excluded.daire_sayisi ELSE daire_sayisi END,
      toplam_bagımsız_bolum = CASE WHEN COALESCE(toplam_bagımsız_bolum,0) = 0 THEN excluded.toplam_bagımsız_bolum ELSE toplam_bagımsız_bolum END,
      has_zemin = CASE WHEN COALESCE(kat_sayisi,0) = 0 AND COALESCE(has_zemin,0) = 0 THEN 1 ELSE has_zemin END,
      updated_at = datetime('now')
  `);

  let inserted = 0;
  const binaCounts = new Map();
  wdb.exec("BEGIN IMMEDIATE");
  try {
    for (const row of matched) {
      insertSayac.run(
        row.bina_id,
        nextBirim(row.bina_id),
        row.meter_number,
        MARKA_FROM_VALUE[row.value] || "",
        row.installation_number || "",
        row.installation_number || "",
        row.agreement_number || "",
        KAYNAK,
        binaName.get(row.bina_id) || ""
      );
      inserted++;
      binaCounts.set(row.bina_id, (binaCounts.get(row.bina_id) || 0) + 1);
    }
    for (const [binaId, n] of binaCounts) fillEmptyBilgi.run(binaId, n, n);
    wdb.exec("COMMIT");
  } catch (e) {
    wdb.exec("ROLLBACK");
    wdb.close();
    throw e;
  }

  const leftoverYakinca = wdb
    .prepare(
      `SELECT COUNT(*) c FROM sayac WHERE bina_id IN (${[...yakincaIds].map(() => "?").join(",")}) AND TRIM(COALESCE(sayac_id,'')) != ''`
    )
    .get(...yakincaIds).c;
  wdb.close();

  report.backup = backup.backupPath.replace(/\\/g, "/");
  report.inserted = inserted;
  report.buildingsTouched = binaCounts.size;
  report.leftoverYakincaMeters = leftoverYakinca;
  writeFileSync(join(outDir, "latest-assign-yakinca-excluded-apply.json"), JSON.stringify(report, null, 2));
  console.log("inserted", inserted, "yakinca leftover", leftoverYakinca, "backup", report.backup);
}

main();
