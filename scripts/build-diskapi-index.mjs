/**
 * Dış kapı KML → güvenli indeks + denetim raporu.
 * binalar.db'ye YAZMAZ; yalnızca okur.
 *
 * Kullanım:
 *   node scripts/build-diskapi-index.mjs
 *   node scripts/build-diskapi-index.mjs --kml "path/to/file.kml"
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  classifyDoorAlignment,
  distanceToBuildingMeters,
  iterKmlPlacemarks,
  parseKmlPoint,
  parseKmlSimpleData,
} from "./lib/diskapi-geo.mjs";

const ROOT = process.cwd();
const DEFAULT_KML = join(ROOT, "data/DiskapiRezervAlanlar.kml");
const INDEX_PATH = join(ROOT, "data/diskapi-index.json");
const REPORT_PATH = join(ROOT, "data/diskapi-audit-report.json");
const DB_PATH = join(ROOT, "data/binalar.db");

const kmlArg = process.argv.find((a) => a.startsWith("--kml="));
const KML_PATH = kmlArg ? kmlArg.slice("--kml=".length) : DEFAULT_KML;

function loadBuildings(db) {
  const rows = db
    .prepare(`SELECT id, kml_id, id_2, oda_id, value, layer, coordinates FROM binalar`)
    .all();

  const byId2 = new Map();
  const byKmlId = new Map();
  const byOdaId = new Map();
  const parsed = [];

  for (const row of rows) {
    let coordinates;
    try {
      coordinates = JSON.parse(row.coordinates);
    } catch {
      continue;
    }
    const item = { ...row, coordinates };
    parsed.push(item);

    if (row.id_2 != null && row.id_2 !== "") {
      const key = String(row.id_2);
      if (!byId2.has(key)) byId2.set(key, []);
      byId2.get(key).push(item);
    }
    if (row.kml_id != null) {
      const key = String(row.kml_id);
      if (!byKmlId.has(key)) byKmlId.set(key, []);
      byKmlId.get(key).push(item);
    }
    if (row.oda_id != null) {
      const key = String(row.oda_id);
      if (!byOdaId.has(key)) byOdaId.set(key, []);
      byOdaId.get(key).push(item);
    }
  }

  return { parsed, byId2, byKmlId, byOdaId };
}

function pickBestAmongCandidates(lat, lng, candidates) {
  let best = null;
  let bestEdge = Infinity;
  for (const building of candidates) {
    const dist = distanceToBuildingMeters(lat, lng, building.coordinates);
    if (dist.edgeDistanceM != null && dist.edgeDistanceM < bestEdge) {
      bestEdge = dist.edgeDistanceM;
      best = building;
    }
  }
  return best;
}

function matchBuilding(buildingId, maps, point) {
  const key = String(buildingId);
  const viaId2 = maps.byId2.get(key) || [];
  if (viaId2.length === 1) return { building: viaId2[0], matchMethod: "id_2" };
  if (viaId2.length > 1) {
    const building = pickBestAmongCandidates(point.lat, point.lng, viaId2);
    return {
      building,
      matchMethod: "id_2_spatial",
      candidates: viaId2,
    };
  }

  const viaKml = maps.byKmlId.get(key) || [];
  if (viaKml.length === 1) return { building: viaKml[0], matchMethod: "kml_id_fallback" };
  if (viaKml.length > 1) {
    const building = pickBestAmongCandidates(point.lat, point.lng, viaKml);
    return { building, matchMethod: "kml_id_spatial", candidates: viaKml };
  }

  const viaOda = maps.byOdaId.get(key) || [];
  if (viaOda.length === 1) return { building: viaOda[0], matchMethod: "oda_id_fallback" };
  if (viaOda.length > 1) {
    const building = pickBestAmongCandidates(point.lat, point.lng, viaOda);
    return { building, matchMethod: "oda_id_spatial", candidates: viaOda };
  }

  return { building: null, matchMethod: "no_match" };
}

function looksLikeProjectedCrs(samples) {
  // EPSG:5257 metre değerleri; WGS84 Malatya ~38.x lat, ~37-39 lng
  return samples.some(({ lat, lng }) => Math.abs(lat) > 90 || Math.abs(lng) > 180 || lat > 1_000 || lng > 1_000);
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

  console.log("Kaynak KML:", KML_PATH);
  console.log("Veritabanı (salt okunur):", DB_PATH);

  const kmlText = readFileSync(KML_PATH, "utf8");
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const buildingMaps = loadBuildings(db);

  const records = [];
  const alignmentStats = {
    on_edge: 0,
    near_edge: 0,
    inside_polygon: 0,
    far_from_building: 0,
    invalid_geometry: 0,
  };
  const matchStats = {
    id_2: 0,
    id_2_spatial: 0,
    kml_id_fallback: 0,
    kml_id_spatial: 0,
    oda_id_fallback: 0,
    oda_id_spatial: 0,
    no_match: 0,
  };
  const issues = {
    no_building_match: [],
    far_from_building: [],
    nearest_disagrees_with_id: [],
    ambiguous_id_2: [],
    projected_crs_suspect: [],
  };

  const coordSamples = [];
  let parsedCount = 0;

  for (const placemark of iterKmlPlacemarks(kmlText)) {
    const point = parseKmlPoint(placemark);
    if (!point) continue;
    const attrs = parseKmlSimpleData(placemark);
    const buildingId = attrs.building_id;
    if (!buildingId) continue;

    parsedCount += 1;
    if (coordSamples.length < 20) coordSamples.push(point);

    const { building, matchMethod, candidates } = matchBuilding(buildingId, buildingMaps, point);
    matchStats[matchMethod] = (matchStats[matchMethod] || 0) + 1;

    let edgeDistanceM = null;
    let alignment = "no_building";
    let binaId = null;
    let binaValue = null;

    if (building) {
      binaId = building.id;
      binaValue = building.value;
      const dist = distanceToBuildingMeters(point.lat, point.lng, building.coordinates);
      edgeDistanceM = dist.edgeDistanceM;
      alignment = classifyDoorAlignment(dist.edgeDistanceM, dist.inside);
      alignmentStats[alignment] = (alignmentStats[alignment] || 0) + 1;

      if (alignment === "far_from_building" && issues.far_from_building.length < 50) {
        issues.far_from_building.push({
          diskapi_id: attrs.id,
          building_id: buildingId,
          bina_id: binaId,
          value: attrs.value,
          edge_distance_m: Math.round(edgeDistanceM),
        });
      }
    } else {
      if (issues.no_building_match.length < 50) {
        issues.no_building_match.push({
          diskapi_id: attrs.id,
          building_id: buildingId,
          value: attrs.value,
          lat: point.lat,
          lng: point.lng,
        });
      }
    }

    if (matchMethod.endsWith("_spatial") && issues.ambiguous_id_2.length < 30) {
      issues.ambiguous_id_2.push({
        building_id: buildingId,
        diskapi_id: attrs.id,
        candidate_bina_ids: candidates.map((c) => c.id),
      });
    }

    records.push({
      diskapi_id: Number(attrs.id) || attrs.id,
      building_id: Number(buildingId) || buildingId,
      value: attrs.value || "",
      building_number: attrs.building_number || "",
      national_code: attrs.national_code || "",
      integration_code: attrs.integration_code || "",
      dma_kodu: attrs.dma_kodu ? Number(attrs.dma_kodu) : null,
      lat: point.lat,
      lng: point.lng,
      bina_id: binaId,
      bina_value: binaValue,
      match_method: matchMethod,
      alignment,
      edge_distance_m: edgeDistanceM != null ? Math.round(edgeDistanceM * 100) / 100 : null,
    });
  }

  if (looksLikeProjectedCrs(coordSamples)) {
    issues.projected_crs_suspect.push({
      message:
        "Koordinatlar WGS84 gibi görünmüyor; EPSG:5257 dönüşümü gerekebilir.",
      samples: coordSamples.slice(0, 5),
    });
  }

  const builtAt = new Date().toISOString();
  const index = {
    built_at: builtAt,
    source_kml: KML_PATH.replace(/\\/g, "/"),
    crs_note:
      "KML koordinatları lon,lat (WGS84) olarak okundu. Kaynak EPSG:5257 ise export sırasında dönüştürülmüş olabilir.",
    total_doors: records.length,
    match_stats: matchStats,
    alignment_stats: alignmentStats,
    records,
  };

  const report = {
    built_at: builtAt,
    source_kml: KML_PATH.replace(/\\/g, "/"),
    database: DB_PATH.replace(/\\/g, "/"),
    read_only: true,
    total_placemarks_parsed: parsedCount,
    summary: {
      total_doors: records.length,
      matched_id_2: matchStats.id_2,
      matched_id_2_spatial: matchStats.id_2_spatial,
      matched_ambiguous: matchStats.id_2_spatial + matchStats.kml_id_spatial + matchStats.oda_id_spatial,
      no_match: matchStats.no_match,
      on_edge: alignmentStats.on_edge,
      near_edge: alignmentStats.near_edge,
      far_from_building: alignmentStats.far_from_building,
    },
    issues,
    safe_next_steps: [
      "binalar.db ve bina_bilgi tablolarına henüz yazılmadı",
      "Harita katmanı için data/diskapi-index.json kullanılabilir",
      "Uyuşmayan kayıtlar issues altında listelendi; karşı tarafa iletilmeli",
    ],
  };

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  console.log("\n=== Dış Kapı İndeks Özeti ===");
  console.log("Toplam kapı:", records.length);
  console.log("id_2 eşleşmesi:", matchStats.id_2);
  console.log("Eşleşmeyen:", matchStats.no_match);
  console.log("Kenarda (≤8m):", alignmentStats.on_edge);
  console.log("Yakın (8-25m):", alignmentStats.near_edge);
  console.log("Uzak (>25m):", alignmentStats.far_from_building);
  console.log("\nYazıldı:", INDEX_PATH);
  console.log("Rapor:", REPORT_PATH);
}

main();
