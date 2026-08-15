/**
 * Maks_Dış_Kapı_No.kml → bina_bilgi.dis_kapi_no + diskapi-by-bina.json birleştirme.
 *
 * - Mevcut dolu dis_kapi_no ezilmez
 * - TOKİ diskapi-index.json üzerine yazılmaz
 * - building_id → binalar.id_2/kml_id kimlik eşleşmesi
 * - Kimlik yoksa yalnızca tek on_edge (≤8m) aday kabul edilir
 * - İki yakın aday / far / kimliksiz near_edge atlanır
 *
 *   node scripts/import-maks-diskapi.mjs
 *   node scripts/import-maks-diskapi.mjs --apply
 *   node scripts/import-maks-diskapi.mjs --kml="C:/Users/Surface/Downloads/Maks_Dış_Kapı_No.kml" --apply
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  classifyDoorAlignment,
  distanceToBuildingMeters,
  iterKmlPlacemarks,
  parseKmlPoint,
  parseKmlSimpleData,
} from "./lib/diskapi-geo.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_KML = "C:/Users/Surface/Downloads/Maks_Dış_Kapı_No.kml";
const APPLY = process.argv.includes("--apply");
const kmlArg = process.argv.find((a) => a.startsWith("--kml="));
const KML_PATH = kmlArg ? kmlArg.slice("--kml=".length) : DEFAULT_KML;
const DB_PATH = join(ROOT, "data/binalar.db");
const BY_BINA_PATH = join(ROOT, "data/diskapi-by-bina.json");
const REPORT_DIR = join(ROOT, "data/import-reports");
const BACKUP_DIR = join(ROOT, "data/backups");
const GOOD_ALIGN = new Set(["on_edge", "near_edge", "inside_polygon"]);

function stampIso() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function doorRank(d) {
  const align =
    d.alignment === "on_edge" ? 0 : d.alignment === "inside_polygon" ? 1 : d.alignment === "near_edge" ? 2 : 9;
  return [align, d.edge_distance_m ?? 999, String(d.kapi_no)];
}

export function pickPrimaryDoor(doors) {
  const uniq = new Map();
  for (const d of doors) {
    const key = String(d.kapi_no || "")
      .trim()
      .toLocaleUpperCase("tr-TR");
    if (!key) continue;
    const prev = uniq.get(key);
    if (!prev || (d.edge_distance_m ?? 999) < (prev.edge_distance_m ?? 999)) uniq.set(key, d);
  }
  return [...uniq.values()].sort((a, b) => {
    const ra = doorRank(a);
    const rb = doorRank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || String(ra[2]).localeCompare(String(rb[2]), "tr");
  });
}

function loadBuildings(db) {
  const byId2 = new Map();
  const byKml = new Map();
  const spatial = [];
  for (const row of db.prepare("SELECT id, kml_id, id_2, value, layer, coordinates FROM binalar").all()) {
    let coordinates;
    try {
      coordinates = JSON.parse(row.coordinates);
    } catch {
      continue;
    }
    const item = { ...row, coordinates };
    spatial.push(item);
    if (row.id_2 != null && String(row.id_2).trim() !== "") {
      const k = String(row.id_2);
      if (!byId2.has(k)) byId2.set(k, []);
      byId2.get(k).push(item);
    }
    if (row.kml_id != null) {
      const k = String(row.kml_id);
      if (!byKml.has(k)) byKml.set(k, []);
      byKml.get(k).push(item);
    }
  }
  return { byId2, byKml, spatial };
}

function identityHits(bid, maps) {
  const a = maps.byId2.get(bid) || [];
  if (a.length) return { hits: a, method: a.length === 1 ? "id_2" : "id_2_ambiguous" };
  const b = maps.byKml.get(bid) || [];
  if (b.length) return { hits: b, method: b.length === 1 ? "kml_id" : "kml_id_ambiguous" };
  return { hits: [], method: "none" };
}

function uniqueOnEdgeSpatial(lat, lng, buildings) {
  const onEdge = [];
  for (const b of buildings) {
    const dist = distanceToBuildingMeters(lat, lng, b.coordinates);
    const alignment = classifyDoorAlignment(dist.edgeDistanceM, dist.inside);
    if (alignment === "on_edge") onEdge.push({ building: b, dist, alignment });
  }
  if (onEdge.length === 1) return onEdge[0];
  return null;
}

function parseDoors(kmlText, maps) {
  const parsed = [];
  const skip = [];
  for (const xml of iterKmlPlacemarks(kmlText)) {
    const attrs = parseKmlSimpleData(xml);
    const point = parseKmlPoint(xml);
    const kapi = String(attrs.value ?? "").trim();
    const rec = {
      diskapi_id: attrs.id || "",
      building_id: String(attrs.building_id ?? "").trim(),
      kapi_no: kapi,
      national_code: String(attrs.national_code ?? "").trim(),
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
    };
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      skip.push({ ...rec, reason: "INVALID_COORDINATE" });
      continue;
    }
    if (!kapi) {
      skip.push({ ...rec, reason: "EMPTY_KAPI_NO" });
      continue;
    }

    let building = null;
    let method = "none";
    if (rec.building_id) {
      const ident = identityHits(rec.building_id, maps);
      method = ident.method;
      if (ident.hits.length === 1) building = ident.hits[0];
      else if (ident.hits.length > 1) {
        skip.push({ ...rec, reason: "AMBIGUOUS_BUILDING", method });
        continue;
      }
    }

    if (!building) {
      const spatial = uniqueOnEdgeSpatial(point.lat, point.lng, maps.spatial);
      if (!spatial) {
        skip.push({ ...rec, reason: "NO_BUILDING_CANDIDATE" });
        continue;
      }
      building = spatial.building;
      method = rec.building_id ? "spatial_on_edge_fallback" : "spatial_on_edge";
    }

    const dist = distanceToBuildingMeters(point.lat, point.lng, building.coordinates);
    const alignment = classifyDoorAlignment(dist.edgeDistanceM, dist.inside);
    if (!GOOD_ALIGN.has(alignment)) {
      skip.push({
        ...rec,
        reason: "TOO_FAR_FROM_BUILDING",
        bina_id: building.id,
        meters: dist.edgeDistanceM,
        alignment,
        method,
      });
      continue;
    }

    parsed.push({
      ...rec,
      bina_id: building.id,
      bina_value: building.value,
      bina_layer: building.layer,
      method,
      alignment,
      edge_distance_m: dist.edgeDistanceM,
    });
  }
  return { parsed, skip };
}

function main() {
  if (!existsSync(KML_PATH)) {
    console.error("KML bulunamadı:", KML_PATH);
    process.exit(1);
  }
  if (!existsSync(DB_PATH)) {
    console.error("Veritabanı bulunamadı:", DB_PATH);
    process.exit(1);
  }

  const db = APPLY ? new DatabaseSync(DB_PATH) : new DatabaseSync(DB_PATH, { readOnly: true });
  const maps = loadBuildings(db);
  const kmlText = readFileSync(KML_PATH, "utf8");
  const { parsed, skip } = parseDoors(kmlText, maps);

  const byBina = new Map();
  for (const door of parsed) {
    if (!byBina.has(door.bina_id)) byBina.set(door.bina_id, []);
    byBina.get(door.bina_id).push(door);
  }

  const existingBilgi = new Map(
    db
      .prepare("SELECT bina_id, TRIM(COALESCE(dis_kapi_no,'')) kapi FROM bina_bilgi")
      .all()
      .map((r) => [r.bina_id, r.kapi])
  );

  const updateEmpty = [];
  const insertNew = [];
  const keep = [];
  const grouped = [];

  for (const [binaId, doors] of byBina) {
    const ranked = pickPrimaryDoor(doors);
    const primary = ranked[0];
    if (!primary) continue;
    grouped.push({
      bina_id: binaId,
      bina_value: primary.bina_value,
      bina_layer: primary.bina_layer,
      primary_kapi: primary.kapi_no,
      door_count: ranked.length,
      doors: ranked,
    });
    const hasRow = existingBilgi.has(binaId);
    const current = hasRow ? existingBilgi.get(binaId) : "";
    if (hasRow && current) {
      keep.push({ bina_id: binaId, bina: primary.bina_value, mevcut: current, yeni: primary.kapi_no });
    } else if (hasRow) {
      updateEmpty.push({ bina_id: binaId, bina: primary.bina_value, kapi_no: primary.kapi_no });
    } else {
      insertNew.push({ bina_id: binaId, bina: primary.bina_value, kapi_no: primary.kapi_no });
    }
  }

  const skipReasons = {};
  for (const s of skip) skipReasons[s.reason] = (skipReasons[s.reason] || 0) + 1;

  const stamp = stampIso();
  const report = {
    mode: APPLY ? "apply" : "dry-run",
    generated_at: new Date().toISOString(),
    kml: KML_PATH.replace(/\\/g, "/"),
    doors_parsed: parsed.length + skip.length,
    doors_matched: parsed.length,
    doors_skipped: skip.length,
    skipReasons,
    unique_buildings: byBina.size,
    multi_door_buildings: [...byBina.values()].filter((d) => pickPrimaryDoor(d).length > 1).length,
    bina_bilgi: {
      insert_new: insertNew.length,
      update_empty: updateEmpty.length,
      keep_existing: keep.length,
    },
    samples: {
      update_empty: updateEmpty.slice(0, 8),
      insert_new: insertNew.slice(0, 8),
      skipped: skip.slice(0, 12),
      multi: grouped.filter((g) => g.door_count > 1).slice(0, 8),
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const prefix = join(REPORT_DIR, `${stamp}-maks-diskapi-${APPLY ? "apply" : "dry-run"}`);
  writeFileSync(`${prefix}-summary.json`, JSON.stringify(report, null, 2));
  writeFileSync(join(REPORT_DIR, `latest-maks-diskapi-${APPLY ? "apply" : "dry-run"}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log("\nUygulamak için: node scripts/import-maks-diskapi.mjs --apply");
    db.close();
    return;
  }

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupDb = join(BACKUP_DIR, `binalar.before-maks-diskapi-${stamp}.db`);
  copyFileSync(DB_PATH, backupDb);
  if (!existsSync(backupDb) || statSync(backupDb).size !== statSync(DB_PATH).size) {
    throw new Error("DB yedeği doğrulanamadı");
  }

  let backupIndex = null;
  if (existsSync(BY_BINA_PATH)) {
    backupIndex = join(BACKUP_DIR, `diskapi-by-bina.before-maks-diskapi-${stamp}.json`);
    copyFileSync(BY_BINA_PATH, backupIndex);
  }

  const insertStmt = db.prepare(`
    INSERT INTO bina_bilgi (
      bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
    ) VALUES (?, 0, 0, 0, 0, 0, '', '', ?, datetime('now'))
  `);
  const updateStmt = db.prepare(`
    UPDATE bina_bilgi
    SET dis_kapi_no = ?, updated_at = datetime('now')
    WHERE bina_id = ? AND TRIM(COALESCE(dis_kapi_no, '')) = ''
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of insertNew) insertStmt.run(row.bina_id, row.kapi_no);
    for (const row of updateEmpty) updateStmt.run(row.kapi_no, row.bina_id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const existingIndex = existsSync(BY_BINA_PATH)
    ? JSON.parse(readFileSync(BY_BINA_PATH, "utf8"))
    : { built_at: "", source: "", total_binalar: 0, binalar: {} };
  const binalar = { ...(existingIndex.binalar || {}) };
  let merged = 0;
  for (const g of grouped) {
    const key = String(g.bina_id);
    if (binalar[key]?.primary_kapi && g.bina_layer !== "Maks_Bina") continue;
    binalar[key] = {
      primary_kapi: g.primary_kapi,
      doors: g.doors.map((d) => ({
        diskapi_id: Number(d.diskapi_id) || d.diskapi_id,
        kapi_no: d.kapi_no,
        lat: d.lat,
        lng: d.lng,
        alignment: d.alignment,
        edge_distance_m: d.edge_distance_m == null ? null : Math.round(d.edge_distance_m * 100) / 100,
      })),
    };
    merged++;
  }
  writeFileSync(
    BY_BINA_PATH,
    JSON.stringify(
      {
        built_at: new Date().toISOString(),
        source: existingIndex.source || BY_BINA_PATH.replace(/\\/g, "/"),
        extra_source: KML_PATH.replace(/\\/g, "/"),
        total_binalar: Object.keys(binalar).length,
        binalar,
      },
      null,
      2
    )
  );

  const after = db
    .prepare(
      `SELECT COUNT(*) n FROM bina_bilgi bb
       JOIN binalar b ON b.id = bb.bina_id
       WHERE b.layer='Maks_Bina' AND TRIM(COALESCE(bb.dis_kapi_no,'')) != ''`
    )
    .get().n;
  const integrity = db.prepare("PRAGMA integrity_check").get();
  report.backup = { db: backupDb.replace(/\\/g, "/"), index: backupIndex ? backupIndex.replace(/\\/g, "/") : null };
  report.applied = {
    inserted: insertNew.length,
    updated: updateEmpty.length,
    index_merged: merged,
    maks_dis_kapi_filled: after,
    integrity: integrity.integrity_check || integrity["integrity_check"],
  };
  writeFileSync(`${prefix}-summary.json`, JSON.stringify(report, null, 2));
  writeFileSync(join(REPORT_DIR, "latest-maks-diskapi-apply.json"), JSON.stringify(report, null, 2));
  console.log("backup:", report.backup);
  console.log("applied:", report.applied);
  db.close();
}

main();
