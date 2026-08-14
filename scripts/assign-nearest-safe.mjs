/**
 * Kalan Excel sayaçlarını en yakın binaya yazar.
 *
 * Varsayılan (güvenli):
 * - Poligon içinde / ≤ 8 m: aynı adlı KML kopyalarından kanonik bina
 * - Tek en yakın ve ≤ 25 m
 *
 * --force: kalan her noktayı en yakın binaya yazar (km uzak olsa da)
 *
 *   node scripts/assign-nearest-safe.mjs
 *   node scripts/assign-nearest-safe.mjs --apply
 *   node scripts/assign-nearest-safe.mjs --force --apply
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { argValue, hasFlag, meterDigits, median, percentile, stampIso } from "./lib/meter-coord-import/common.mjs";
import { readCoordinateWorkbook } from "./lib/meter-coord-import/parsers.mjs";
import { projectPoint } from "./lib/meter-coord-import/crs.mjs";
import {
  loadBuildingSpatialIndex,
  matchPointToBuildings,
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
const DEFAULT_EXCEL = "C:/Users/Surface/Downloads/şayaç koordinat.xlsx";
const CRS = "EPSG:5258";
const MAX_SAFE_M = 25;
const M_PER_DEG_LAT = 111_320;

function bboxDistMeters(lat, lng, bbox) {
  const clampLat = Math.min(Math.max(lat, bbox.minLat), bbox.maxLat);
  const clampLng = Math.min(Math.max(lng, bbox.minLng), bbox.maxLng);
  if (clampLat === lat && clampLng === lng) return 0;
  const dx = (lng - clampLng) * metersPerDegLng(lat);
  const dy = (lat - clampLat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

function nearestTwo(searchable, lat, lng) {
  let first = null;
  let second = null;
  for (const b of searchable) {
    const bd = bboxDistMeters(lat, lng, b.bbox);
    if (second && bd > second.meters) continue;
    const dist = minDistanceMeters(lat, lng, b.rings);
    if (dist.meters == null) continue;
    const hit = { building: b, meters: dist.meters, inside: dist.inside };
    if (!first || hit.meters < first.meters - 1e-9) {
      second = first;
      first = hit;
    } else if (!second || hit.meters < second.meters) {
      second = hit;
    }
  }
  return { first, second };
}

function uniqueNearEnough(first, second, maxM) {
  if (!first || first.meters > maxM) return false;
  if (!second) return true;
  const gap = second.meters - first.meters;
  const minGap = Math.max(8, first.meters * 0.35);
  return gap >= minGap;
}

function isGeneratedName(value) {
  return /^\s*Bina\s*#\d+\s*$/i.test(String(value || "").trim());
}

function nearestCluster(searchable, lat, lng, tieM = 1) {
  let minM = Infinity;
  let hits = [];
  for (const b of searchable) {
    const bd = bboxDistMeters(lat, lng, b.bbox);
    if (bd > minM + tieM) continue;
    const dist = minDistanceMeters(lat, lng, b.rings);
    if (dist.meters == null) continue;
    if (dist.meters < minM - 1e-9) {
      minM = dist.meters;
      hits = hits.filter((h) => h.meters <= minM + tieM);
    }
    if (dist.meters <= minM + tieM) {
      hits.push({ building: b, meters: dist.meters });
    }
  }
  hits.sort((a, b) => a.meters - b.meters || a.building.id - b.building.id);
  return hits;
}

function pickForced(hits) {
  if (!hits.length) return null;
  const resolved = resolveOverlayHits(hits);
  if (resolved.building) {
    const hit = hits.find((h) => h.building.id === resolved.building.id) || hits[0];
    return {
      building: resolved.building,
      overlay: resolved.overlay || "nearest_forced",
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
    return a.building.id - b.building.id;
  });
  return {
    building: ranked[0].building,
    overlay: "nearest_forced_tiebreak",
    meters: ranked[0].meters,
    second: ranked[1]?.meters ?? null,
  };
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

function pushMatch(matched, group, building, method, meters, secondMeters, bilgi) {
  for (const row of group.rows) {
    matched.push({
      ...row,
      bina_id: building.id,
      bina_value: building.value,
      bina_layer: building.layer,
      method,
      meters,
      secondMeters,
      sokak: bilgi.get(building.id)?.sokak || "",
      kapi: bilgi.get(building.id)?.kapi || "",
    });
  }
}

function main() {
  const apply = hasFlag(process.argv, "--apply");
  const force = hasFlag(process.argv, "--force");
  const excelPath = argValue(process.argv, "--excel") || DEFAULT_EXCEL;
  if (!existsSync(excelPath)) {
    console.error("Excel yok:", excelPath);
    process.exit(1);
  }

  const excel = readCoordinateWorkbook(excelPath);
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const index = loadBuildingSpatialIndex(db);
  const bilgi = new Map(
    db
      .prepare("SELECT bina_id, sokak, dis_kapi_no FROM bina_bilgi")
      .all()
      .map((r) => [r.bina_id, { sokak: String(r.sokak || "").trim(), kapi: String(r.dis_kapi_no || "").trim() }])
  );

  const existingExact = new Set(
    db
      .prepare(`SELECT TRIM(sayac_id) id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
      .all()
      .map((r) => r.id)
  );
  const existingDigits = new Set([...existingExact].map((id) => meterDigits(id)).filter(Boolean));

  const seenMeter = new Set();
  const remaining = [];
  let already = 0;
  let duplicate = 0;

  for (const row of excel.rows) {
    if (!row.meter_ok || !row.meter_number || !row.point) continue;
    if (seenMeter.has(row.meter_number)) {
      duplicate++;
      continue;
    }
    seenMeter.add(row.meter_number);
    if (existingExact.has(row.meter_number) || existingDigits.has(meterDigits(row.meter_number))) {
      already++;
      continue;
    }
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
  const distByPoint = [];
  const buckets = {};
  const skipReasons = {};

  let i = 0;
  for (const group of uniqueKeys.values()) {
    i++;
    if (i % 50 === 0) console.error(`nokta ${i}/${uniqueKeys.size}`);
    const pip = matchPointToBuildings(index, group.lat, group.lng, 8, BOUNDARY_EPS_M);
    if (pip.building) {
      pushMatch(matched, group, pip.building, pip.overlay ? `inside:${pip.overlay}` : "inside", pip.meters ?? 0, null, bilgi);
      continue;
    }

    if (force) {
      const cluster = nearestCluster(index.searchable, group.lat, group.lng, 1);
      const meters = cluster[0]?.meters ?? null;
      distByPoint.push(meters);
      const bucket = bucketMeters(meters);
      buckets[bucket] = (buckets[bucket] || 0) + group.rows.length;
      const picked = pickForced(cluster);
      if (picked?.building) {
        pushMatch(matched, group, picked.building, `force:${picked.overlay}`, picked.meters, picked.second, bilgi);
        continue;
      }
      skipReasons.NO_NEAR_BUILDING = (skipReasons.NO_NEAR_BUILDING || 0) + group.rows.length;
      skipped.push({
        meters,
        second: cluster[1]?.meters ?? null,
        rows: group.rows.length,
        nearestBina: cluster[0]?.building.value || "",
        nearestId: cluster[0]?.building.id || null,
        reason: "NO_NEAR_BUILDING",
        lat: group.lat,
        lng: group.lng,
      });
      continue;
    }

    const { first, second } = nearestTwo(index.searchable, group.lat, group.lng);
    const meters = first?.meters ?? null;
    distByPoint.push(meters);
    const bucket = bucketMeters(meters);
    buckets[bucket] = (buckets[bucket] || 0) + group.rows.length;

    if (uniqueNearEnough(first, second, MAX_SAFE_M)) {
      pushMatch(matched, group, first.building, "nearest_unique", first.meters, second?.meters ?? null, bilgi);
      continue;
    }

    let reason = "NO_NEAR_BUILDING";
    if (first && first.meters <= MAX_SAFE_M) reason = "AMBIGUOUS_NEAREST";
    else if (first && first.meters <= 50) reason = "TOO_FAR_NEIGHBOR";
    else if (first) reason = "TOO_FAR_WRONG_SITE";
    skipReasons[reason] = (skipReasons[reason] || 0) + group.rows.length;
    skipped.push({
      meters,
      second: second?.meters ?? null,
      rows: group.rows.length,
      nearestBina: first?.building.value || "",
      nearestId: first?.building.id || null,
      reason,
      lat: group.lat,
      lng: group.lng,
    });
  }

  const finite = distByPoint.filter((m) => m != null).sort((a, b) => a - b);
  const methodDist = matched.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {});
  const matchedDistanceBuckets = matched.reduce((acc, r) => {
    const k = bucketMeters(r.meters);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const report = {
    mode: apply ? "apply" : "dry-run",
    force,
    maxSafeMeters: force ? null : MAX_SAFE_M,
    alreadyInDb: already,
    duplicateSource: duplicate,
    remainingRows: remaining.length,
    remainingPoints: uniqueKeys.size,
    matchedRows: matched.length,
    skippedRows: remaining.length - matched.length,
    methodDist,
    skipReasons,
    distanceBucketsRows: buckets,
    matchedDistanceBuckets,
    nearestOfUnmatchedPoints: {
      n: finite.length,
      min: finite[0] ?? null,
      p10: percentile(finite, 10),
      median: median(finite),
      p90: percentile(finite, 90),
      max: finite[finite.length - 1] ?? null,
    },
    sampleMatched: matched.slice(0, 12).map((r) => ({
      meter: r.meter_number,
      bina: r.bina_value,
      method: r.method,
      m: r.meters,
      second: r.secondMeters,
      sokak: r.sokak,
      kapi: r.kapi,
    })),
    sampleSkipped: skipped.slice(0, 12).map((s) => ({
      rows: s.rows,
      m: s.meters,
      second: s.second,
      bina: s.nearestBina,
      reason: s.reason,
    })),
  };

  const outDir = join(ROOT, "data/import-reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = stampIso();
  writeFileSync(
    join(outDir, `latest-assign-nearest-safe-${apply ? "apply" : "dry-run"}.json`),
    JSON.stringify(report, null, 2)
  );
  writeFileSync(join(outDir, `${stamp}-assign-nearest.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!apply) {
    console.log(force ? "\nUygulamak için: node scripts/assign-nearest-safe.mjs --force --apply" : "\nUygulamak için: node scripts/assign-nearest-safe.mjs --apply");
    db.close();
    return;
  }

  db.close();
  if (!matched.length) {
    console.log("Atama yok; veritabanı değişmedi.");
    return;
  }

  const kaynak = force ? "assign-nearest-forced" : "assign-nearest-safe";
  const backup = createDbBackup(DB_PATH, BACKUP_DIR, force ? "assign-nearest-forced" : "assign-nearest-safe");
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
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, 'DAİRE', 'gecerli', datetime('now'))
  `);
  const insertBilgi = wdb.prepare(`
    INSERT INTO bina_bilgi (
      bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
    ) VALUES (?, 0, ?, 0, ?, 1, '', '', '', datetime('now'))
    ON CONFLICT(bina_id) DO UPDATE SET
      daire_sayisi = CASE WHEN daire_sayisi < excluded.daire_sayisi THEN excluded.daire_sayisi ELSE daire_sayisi END,
      toplam_bagımsız_bolum = CASE WHEN toplam_bagımsız_bolum < excluded.toplam_bagımsız_bolum THEN excluded.toplam_bagımsız_bolum ELSE toplam_bagımsız_bolum END,
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
        row.agreement_number || "",
        kaynak
      );
      inserted++;
      binaCounts.set(row.bina_id, (binaCounts.get(row.bina_id) || 0) + 1);
    }
    for (const [binaId, n] of binaCounts) {
      insertBilgi.run(binaId, n, n);
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
  writeFileSync(join(outDir, "latest-assign-nearest-safe-apply.json"), JSON.stringify(report, null, 2));
  console.log("inserted", inserted, "backup", report.backup);
  wdb.close();
}

main();
