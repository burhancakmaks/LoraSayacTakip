import { CRS_CANDIDATES, projectPoint } from "./crs.mjs";
import { loadBuildingSpatialIndex, matchPointToBuildings, BOUNDARY_EPS_M } from "./spatial.mjs";
import {
  EXPECTED_REGION,
  MATCH_METHOD,
  REASON,
  inExpectedRegion,
  median,
  meterDigits,
  percentile,
} from "./common.mjs";

export const MARKA_FROM_VALUE = {
  BAYLAN_LORA_W: "Baylan",
  POLIMETER_LORA_W: "Polimeter",
  "BRT METER LORA": "BRT Meter",
};

export const EXPECTED_EXCEL_ROWS = 12740;
export const EXPECTED_CSV_ROWS = 7000;
export const DEFAULT_MAX_NEAREST_M = 0.5;
export const MIN_IN_REGION_RATIO = 0.85;

function countBy(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item) || "(empty)";
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function evaluateCrsCandidates(uniquePoints, index, region = EXPECTED_REGION) {
  const results = [];
  for (const crs of CRS_CANDIDATES) {
    let inRegion = 0;
    let inside = 0;
    let ambiguous = 0;
    let outside = 0;
    let invalid = 0;
    const dists = [];
    let sample = null;
    for (const p of uniquePoints) {
      const wgs = projectPoint(p.x, p.y, crs.code);
      if (!wgs || !Number.isFinite(wgs.lat) || !Number.isFinite(wgs.lng)) {
        invalid++;
        continue;
      }
      if (!sample) sample = wgs;
      if (inExpectedRegion(wgs.lat, wgs.lng, region)) inRegion++;
      const m = matchPointToBuildings(index, wgs.lat, wgs.lng, 0, BOUNDARY_EPS_M);
      if (m.method === MATCH_METHOD.INSIDE) inside++;
      else if (m.reason === REASON.AMBIGUOUS_BUILDING) ambiguous++;
      else outside++;
      if (m.meters != null) dists.push(m.meters);
    }
    dists.sort((a, b) => a - b);
    const n = uniquePoints.length || 1;
    results.push({
      code: crs.code,
      name: crs.name,
      sample,
      inRegion,
      inRegionRatio: inRegion / n,
      inside,
      insideRatio: inside / n,
      ambiguous,
      outside,
      invalid,
      distance: {
        min: dists[0] ?? null,
        median: median(dists),
        p95: percentile(dists, 95),
        max: dists.at(-1) ?? null,
      },
      score: inRegion / n + inside / n,
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function sayacHasColumn(db, name) {
  return db.prepare("PRAGMA table_info(sayac)").all().some((c) => c.name === name);
}

function loadExistingMeters(db) {
  const hasTesisat = sayacHasColumn(db, "tesisat_no");
  const hasSozlesme = sayacHasColumn(db, "sozlesme_no");
  const rows = db
    .prepare(
      `SELECT id, bina_id, birim_no, sayac_id, sicil_no, abone_no, sayac_markasi,
              ${hasTesisat ? "COALESCE(tesisat_no,'')" : "''"} AS tesisat_no,
              ${hasSozlesme ? "COALESCE(sozlesme_no,'')" : "''"} AS sozlesme_no
       FROM sayac`
    )
    .all();
  const byExact = new Map();
  const byDigits = new Map();
  for (const row of rows) {
    const id = String(row.sayac_id ?? "").trim();
    if (!id) continue;
    if (!byExact.has(id)) byExact.set(id, []);
    byExact.get(id).push(row);
    const digits = meterDigits(id);
    if (digits) {
      if (!byDigits.has(digits)) byDigits.set(digits, []);
      byDigits.get(digits).push(row);
    }
  }
  const maxBirim = new Map();
  const filledByBina = new Map();
  const bilgiSet = new Set(db.prepare("SELECT bina_id FROM bina_bilgi").all().map((r) => r.bina_id));
  for (const row of db.prepare("SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id").all()) {
    maxBirim.set(row.bina_id, row.m || 0);
  }
  for (const row of db
    .prepare(
      `SELECT bina_id, COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!='' GROUP BY bina_id`
    )
    .all()) {
    filledByBina.set(row.bina_id, row.c);
  }
  return { byExact, byDigits, maxBirim, filledByBina, bilgiSet, rows };
}

function findExisting(meterNumber, existing) {
  const exact = existing.byExact.get(meterNumber) || [];
  if (exact.length) return exact;
  const digits = meterDigits(meterNumber);
  if (!digits) return [];
  return existing.byDigits.get(digits) || [];
}

function fieldsEqual(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function classifySayacAction(row, building, existingRows) {
  if (!existingRows.length) {
    return { action: "insert", reason: null };
  }
  const binaIds = [...new Set(existingRows.map((r) => r.bina_id))];
  if (binaIds.length > 1 || (binaIds[0] !== building.id)) {
    if (!(binaIds.length === 1 && binaIds[0] === building.id)) {
      return { action: "skip", reason: REASON.METER_ALREADY_IN_OTHER_BUILDING, existing: existingRows };
    }
  }
  const rec = existingRows.find((r) => r.bina_id === building.id) || existingRows[0];
  const marka = MARKA_FROM_VALUE[row.value] || "";
  const wouldChangeId = rec.sayac_id && !fieldsEqual(rec.sayac_id, row.meter_number) && meterDigits(rec.sayac_id) === meterDigits(row.meter_number);
  const overwriteMarka = rec.sayac_markasi && marka && !fieldsEqual(rec.sayac_markasi, marka);
  const overwriteAbone =
    rec.abone_no && row.installation_number && !fieldsEqual(rec.abone_no, row.installation_number);
  if (overwriteMarka || overwriteAbone) {
    return { action: "skip", reason: REASON.WOULD_OVERWRITE_HIGHER_QUALITY_DATA, existing: [rec] };
  }
  const same =
    fieldsEqual(rec.sayac_id, row.meter_number) &&
    (!marka || fieldsEqual(rec.sayac_markasi, marka) || !rec.sayac_markasi) &&
    (!row.installation_number || fieldsEqual(rec.tesisat_no, row.installation_number) || !rec.tesisat_no) &&
    (!row.agreement_number || fieldsEqual(rec.sozlesme_no, row.agreement_number) || !rec.sozlesme_no);
  const needsFill =
    (!rec.sayac_markasi && marka) ||
    (!rec.tesisat_no && row.installation_number) ||
    (!rec.sozlesme_no && row.agreement_number) ||
    (!rec.abone_no && row.installation_number);
  if (wouldChangeId) {
    return { action: "skip", reason: REASON.WOULD_OVERWRITE_HIGHER_QUALITY_DATA, existing: [rec] };
  }
  if (needsFill) return { action: "update", reason: null, existing: [rec] };
  if (same || !needsFill) return { action: "unchanged", reason: null, existing: [rec] };
  return { action: "unchanged", reason: null, existing: [rec] };
}

export function buildImportPlan({
  db,
  excel,
  csv,
  crsCode = null,
  maxNearestMeters = DEFAULT_MAX_NEAREST_M,
}) {
  const index = loadBuildingSpatialIndex(db);
  const uniquePoints = [];
  const byWkt = new Map();
  for (const row of excel.rows) {
    if (!row.point) continue;
    const key = `${row.point.x}|${row.point.y}`;
    if (!byWkt.has(key)) {
      byWkt.set(key, row.point);
      uniquePoints.push(row.point);
    }
  }

  const crsEval = evaluateCrsCandidates(uniquePoints, index);
  const selected = crsCode
    ? crsEval.find((c) => c.code === crsCode) || null
    : crsEval[0];

  const stopReasons = [];
  if (!selected || selected.inRegionRatio < MIN_IN_REGION_RATIO) {
    stopReasons.push("CRS güvenilir biçimde belirlenemedi veya noktaların önemli kısmı beklenen bölge dışında.");
  }
  if (excel.rows.length !== EXPECTED_EXCEL_ROWS) {
    stopReasons.push(`Excel satır sayısı beklenen ${EXPECTED_EXCEL_ROWS} değil: ${excel.rows.length}`);
  }
  if (csv.rows.length !== EXPECTED_CSV_ROWS) {
    stopReasons.push(`CSV satır sayısı beklenen ${EXPECTED_CSV_ROWS} değil: ${csv.rows.length}`);
  }

  const spatialByKey = new Map();
  const gis = {
    parsed: 0,
    invalid: 0,
    inside: 0,
    nearest: 0,
    ambiguous: 0,
    tooFar: 0,
    none: 0,
    distances: [],
  };

  if (selected) {
    for (const [key, point] of byWkt) {
      gis.parsed++;
      const wgs = projectPoint(point.x, point.y, selected.code);
      if (!wgs) {
        gis.invalid++;
        spatialByKey.set(key, { reason: REASON.UNKNOWN_CRS, method: MATCH_METHOD.NONE, wgs: null, point });
        continue;
      }
      const match = matchPointToBuildings(index, wgs.lat, wgs.lng, maxNearestMeters, BOUNDARY_EPS_M);
      const rec = { ...match, wgs, point, crs: selected.code };
      spatialByKey.set(key, rec);
      if (match.meters != null) gis.distances.push(match.meters);
      if (match.method === MATCH_METHOD.INSIDE) gis.inside++;
      else if (match.method === MATCH_METHOD.NEAREST) gis.nearest++;
      else if (match.reason === REASON.AMBIGUOUS_BUILDING) gis.ambiguous++;
      else if (match.reason === REASON.TOO_FAR_FROM_BUILDING) gis.tooFar++;
      else if (match.reason === REASON.INVALID_COORDINATE) gis.invalid++;
      else gis.none++;
    }
  } else {
    gis.invalid = uniquePoints.length;
  }

  gis.distances.sort((a, b) => a - b);
  gis.distanceSummary = {
    min: gis.distances[0] ?? null,
    median: median(gis.distances),
    p95: percentile(gis.distances, 95),
    max: gis.distances.at(-1) ?? null,
  };

  const meterGroups = new Map();
  const digitGroups = new Map();
  for (const row of excel.rows) {
    if (!row.meter_ok || !row.meter_number) continue;
    if (!meterGroups.has(row.meter_number)) meterGroups.set(row.meter_number, []);
    meterGroups.get(row.meter_number).push(row);
    const d = meterDigits(row.meter_number);
    if (d) {
      if (!digitGroups.has(d)) digitGroups.set(d, new Set());
      digitGroups.get(d).add(row.meter_number);
    }
  }
  const collidingNorm = new Set();
  for (const [, set] of digitGroups) {
    if (set.size > 1) {
      for (const m of set) collidingNorm.add(m);
    }
  }

  const duplicateMeters = new Set();
  for (const [meter, rows] of meterGroups) {
    if (rows.length > 1) duplicateMeters.add(meter);
  }

  const existing = loadExistingMeters(db);
  const sayacPlan = [];
  const locBuilding = new Map();

  for (const row of excel.rows) {
    const base = {
      source_row: row.source_row,
      meter_number: row.meter_number,
      installation_number: row.installation_number,
      agreement_number: row.agreement_number,
      value: row.value,
      location: row.location,
      source_x: row.point?.x ?? null,
      source_y: row.point?.y ?? null,
    };

    if (!row.point) {
      sayacPlan.push({ ...base, action: "skip", reason: REASON.INVALID_COORDINATE });
      continue;
    }
    if (!row.meter_ok || !row.meter_number) {
      sayacPlan.push({ ...base, action: "skip", reason: REASON.EMPTY_METER_NUMBER });
      continue;
    }
    if (collidingNorm.has(row.meter_number)) {
      sayacPlan.push({ ...base, action: "skip", reason: REASON.METER_NORMALIZATION_COLLISION });
      continue;
    }
    if (duplicateMeters.has(row.meter_number)) {
      sayacPlan.push({ ...base, action: "skip", reason: REASON.DUPLICATE_SOURCE_METER });
      continue;
    }
    if (!selected) {
      sayacPlan.push({ ...base, action: "skip", reason: REASON.UNKNOWN_CRS });
      continue;
    }

    const key = `${row.point.x}|${row.point.y}`;
    const spatial = spatialByKey.get(key);
    if (!spatial?.building) {
      sayacPlan.push({
        ...base,
        action: "skip",
        reason: spatial?.reason || REASON.NO_BUILDING_CANDIDATE,
        latitude: spatial?.wgs?.lat ?? null,
        longitude: spatial?.wgs?.lng ?? null,
        crs: selected.code,
        meters: spatial?.meters ?? null,
        hitIds: spatial?.hitIds || [],
      });
      continue;
    }

    const prev = locBuilding.get(key);
    if (prev && prev !== spatial.building.id) {
      sayacPlan.push({
        ...base,
        action: "skip",
        reason: REASON.AMBIGUOUS_BUILDING,
        bina_id: null,
      });
      continue;
    }
    locBuilding.set(key, spatial.building.id);

    const existingRows = findExisting(row.meter_number, existing);
    const classified = classifySayacAction(row, spatial.building, existingRows);
    sayacPlan.push({
      ...base,
      action: classified.action,
      reason: classified.reason,
      bina_id: classified.action === "skip" ? spatial.building.id : spatial.building.id,
      bina_value: spatial.building.value,
      bina_layer: spatial.building.layer,
      method: spatial.method,
      meters: spatial.meters,
      confidence: spatial.confidence,
      overlay: spatial.overlay,
      latitude: spatial.wgs.lat,
      longitude: spatial.wgs.lng,
      crs: selected.code,
      hitIds: spatial.hitIds,
      existing_id: classified.existing?.[0]?.id ?? null,
      existing_bina_ids: existingRows.map((r) => r.bina_id),
    });
  }

  const binaIdsForBilgi = new Set();
  for (const p of sayacPlan) {
    if ((p.action === "insert" || p.action === "update" || p.action === "unchanged") && p.bina_id) {
      binaIdsForBilgi.add(p.bina_id);
    }
  }
  const binaBilgiCreate = [...binaIdsForBilgi].filter((id) => !existing.bilgiSet.has(id));
  const binaBilgiKeep = [...binaIdsForBilgi].filter((id) => existing.bilgiSet.has(id));

  const willHaveSayac = new Set(existing.filledByBina.keys());
  for (const p of sayacPlan) {
    if (p.action === "insert" && p.bina_id) willHaveSayac.add(p.bina_id);
  }
  const alreadyGreen = existing.filledByBina.size;
  const willBeGreen = willHaveSayac.size;
  const newlyGreen = [...willHaveSayac].filter((id) => !existing.filledByBina.has(id)).length;

  const deveuiSet = new Set();
  const duplicateDeveui = new Set();
  for (const row of csv.rows) {
    if (!row.deveui) continue;
    if (deveuiSet.has(row.deveui)) duplicateDeveui.add(row.deveui);
    deveuiSet.add(row.deveui);
  }

  const existingDevices = new Map(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lora_devices'")
      .get()
      ? db.prepare("SELECT * FROM lora_devices").all().map((r) => [r.dev_eui, r])
      : []
  );

  const devicePlan = [];
  const unitDeviceCount = new Map();
  for (const row of csv.rows) {
    const unitKey = `${row.bolge}|${row.blok}|${row.daire}`;
    unitDeviceCount.set(unitKey, (unitDeviceCount.get(unitKey) || 0) + 1);
  }

  for (const row of csv.rows) {
    const rec = {
      source_row: row.source_row,
      deveui: row.deveui,
      bolge: row.bolge,
      blok: row.blok,
      daire: row.daire,
      kat: row.kat,
      durum: row.durum,
      son_uplink: row.son_uplink,
      kaydeden: row.kaydeden,
      kayit_tarihi: row.kayit_tarihi,
      notlar: row.notlar,
      bina_id: null,
      sayac_id: null,
    };
    if (!row.deveui) {
      devicePlan.push({ ...rec, action: "skip", reason: REASON.TEST_OR_SUSPICIOUS_RECORD });
      continue;
    }
    if (row.suspicious) {
      devicePlan.push({ ...rec, action: "skip", reason: REASON.TEST_OR_SUSPICIOUS_RECORD });
      continue;
    }
    if (duplicateDeveui.has(row.deveui)) {
      devicePlan.push({ ...rec, action: "skip", reason: REASON.TEST_OR_SUSPICIOUS_RECORD, detail: "duplicate_deveui" });
      continue;
    }
    rec.reason = REASON.NO_DETERMINISTIC_DEVICE_LINK;
    const prev = existingDevices.get(row.deveui);
    if (!prev) {
      devicePlan.push({ ...rec, action: "insert" });
    } else {
      const same =
        fieldsEqual(prev.bolge, row.bolge) &&
        fieldsEqual(prev.blok, row.blok) &&
        fieldsEqual(prev.daire, row.daire) &&
        fieldsEqual(prev.durum, row.durum) &&
        fieldsEqual(prev.son_uplink, row.son_uplink);
      devicePlan.push({ ...rec, action: same ? "unchanged" : "update", existing_id: prev.id });
    }
  }

  const skipReasons = countBy(
    sayacPlan.filter((p) => p.action === "skip"),
    (p) => p.reason
  );

  const excelSummary = {
    rows: excel.rows.length,
    uniqueCoordinates: byWkt.size,
    uniqueRawMeters: new Set(excel.rows.map((r) => String(r.meter_raw ?? ""))).size,
    uniqueNormalizedMeters: meterGroups.size,
    emptyMeters: excel.rows.filter((r) => !r.meter_ok).length,
    duplicateMeters: duplicateMeters.size,
    normalizationCollisions: collidingNorm.size,
    valueDist: countBy(excel.rows, (r) => r.value),
  };

  const csvSummary = {
    rows: csv.rows.length,
    uniqueDeveui: deveuiSet.size,
    duplicateDeveui: duplicateDeveui.size,
    durumDist: countBy(csv.rows, (r) => r.durum),
    uniqueBlocks: new Set(csv.rows.map((r) => r.blok)).size,
    multiDeviceUnits: [...unitDeviceCount.values()].filter((n) => n > 1).length,
  };

  const dbSummary = {
    sayacInsert: sayacPlan.filter((p) => p.action === "insert").length,
    sayacUnchanged: sayacPlan.filter((p) => p.action === "unchanged").length,
    sayacUpdate: sayacPlan.filter((p) => p.action === "update").length,
    sayacSkip: sayacPlan.filter((p) => p.action === "skip").length,
    sayacConflict: sayacPlan.filter((p) =>
      [REASON.METER_ALREADY_IN_OTHER_BUILDING, REASON.DUPLICATE_SOURCE_METER, REASON.METER_NORMALIZATION_COLLISION].includes(p.reason)
    ).length,
    binaBilgiCreate: binaBilgiCreate.length,
    binaBilgiKeep: binaBilgiKeep.length,
    deviceInsert: devicePlan.filter((p) => p.action === "insert").length,
    deviceUpdate: devicePlan.filter((p) => p.action === "update").length,
    deviceUnchanged: devicePlan.filter((p) => p.action === "unchanged").length,
    provenDeviceMeterLinks: 0,
    unmatchedDeveui: devicePlan.length,
    newlyGreen,
    stillBlueOrUncertain: index.searchable.length - willBeGreen,
    alreadyGreen,
    willBeGreen,
  };

  const accounted =
    dbSummary.sayacInsert + dbSummary.sayacUnchanged + dbSummary.sayacUpdate + dbSummary.sayacSkip;
  if (accounted !== excel.rows.length) {
    stopReasons.push(`Reconcile hatası: excel ${excel.rows.length} != ${accounted}`);
  }
  const csvAccounted = devicePlan.length;
  if (csvAccounted !== csv.rows.length) {
    stopReasons.push(`CSV reconcile hatası: ${csv.rows.length} != ${csvAccounted}`);
  }

  const provenMeters = sayacPlan.filter((p) => p.action !== "skip").length;
  if (selected && gis.inside + gis.nearest < uniquePoints.length * 0.4) {
    stopReasons.push("Çok sayıda koordinat bina poligonlarıyla yüksek güvenle uyuşmuyor.");
  }

  return {
    selectedCrs: selected,
    crsEval,
    maxNearestMeters,
    excelSummary,
    csvSummary,
    gis: {
      selectedCrs: selected?.code || null,
      crsEvidence: selected,
      parsedCoordinates: gis.parsed,
      invalidCoordinates: gis.invalid + excel.rows.filter((r) => !r.point).length,
      inside: gis.inside,
      multiPolygon: gis.ambiguous,
      none: gis.none,
      nearestWithinThreshold: gis.nearest,
      leftUncertain: gis.ambiguous + gis.tooFar + gis.none,
      distance: gis.distanceSummary,
    },
    dbSummary,
    skipReasons,
    provenMeters,
    skippedMeters: dbSummary.sayacSkip,
    binaBilgiCreate,
    sayacPlan,
    devicePlan,
    stopReasons,
    applyAllowed: stopReasons.length === 0,
    existingMaxBirim: Object.fromEntries(existing.maxBirim),
  };
}

export function summarizePlan(plan) {
  return {
    applyAllowed: plan.applyAllowed,
    stopReasons: plan.stopReasons,
    selectedCrs: plan.selectedCrs,
    excelSummary: plan.excelSummary,
    csvSummary: plan.csvSummary,
    gis: plan.gis,
    dbSummary: plan.dbSummary,
    skipReasons: plan.skipReasons,
    provenMeters: plan.provenMeters,
    skippedMeters: plan.skippedMeters,
  };
}
