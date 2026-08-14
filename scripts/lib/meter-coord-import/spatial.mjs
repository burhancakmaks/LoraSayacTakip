import { pointInRing, toMeters } from "../diskapi-geo.mjs";
import { MATCH_METHOD, SKIP_BUILDING_LAYER, unicodeFold } from "./common.mjs";

const CELL = 0.0008;
export const BOUNDARY_EPS_M = 0.05;

function ringsFromCoordinates(raw) {
  let coordinates;
  try {
    coordinates = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(coordinates) || !coordinates.length) return [];
  if (Array.isArray(coordinates[0]?.[0])) {
    return coordinates.filter((r) => Array.isArray(r) && r.length >= 3);
  }
  return coordinates.length >= 3 ? [coordinates] : [];
}

function bboxOf(rings) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const ring of rings) {
    for (const p of ring) {
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

export function pointInBuilding(lat, lng, rings) {
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(lat, lng, ring)) inside = !inside;
  }
  return inside;
}

export function minDistanceMeters(lat, lng, rings) {
  const p = toMeters(lat, lng, lat, lng);
  let minDist = Infinity;
  const inside = pointInBuilding(lat, lng, rings);
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [latA, lngA] = ring[i];
      const [latB, lngB] = ring[(i + 1) % ring.length];
      const a = toMeters(latA, lngA, lat, lng);
      const b = toMeters(latB, lngB, lat, lng);
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const apx = p.x - a.x;
      const apy = p.y - a.y;
      const ab2 = abx * abx + aby * aby;
      const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
      const d = Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
      if (d < minDist) minDist = d;
    }
  }
  return { meters: minDist === Infinity ? null : minDist, inside };
}

function isRyaLayer(layer) {
  return /^RYA_/i.test(String(layer || ""));
}

function ringsAreaM2(rings) {
  let total = 0;
  for (const ring of rings || []) {
    if (!ring || ring.length < 3) continue;
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
    total += Math.abs(a / 2);
  }
  return total;
}

function foldedName(value) {
  return unicodeFold(value).toLocaleUpperCase("tr-TR");
}

function isGeneratedBuildingName(value) {
  return /^\s*Bina\s*#\d+\s*$/i.test(unicodeFold(value));
}

function similarArea(a, b, ratio = 0.2) {
  const mx = Math.max(a, b);
  if (!mx || !Number.isFinite(mx)) return false;
  return Math.abs(a - b) / mx <= ratio;
}

function dropUnnamedFootprintCopies(hits) {
  const named = hits.filter((h) => foldedName(h.building.value) && !isGeneratedBuildingName(h.building.value));
  if (!named.length || named.length === hits.length) return hits;
  const namedAreas = named.map((h) => ringsAreaM2(h.building.rings));
  const kept = hits.filter((h) => {
    if (!isGeneratedBuildingName(h.building.value)) return true;
    const area = ringsAreaM2(h.building.rings);
    return !namedAreas.some((na) => similarArea(area, na));
  });
  return kept.length ? kept : hits;
}

function pickNestedOrPrimary(hits) {
  const ranked = hits
    .map((h) => ({ ...h, area: ringsAreaM2(h.building.rings) || Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.area - b.area);
  const smallest = ranked[0];
  const second = ranked[1];
  if (smallest && second && Number.isFinite(smallest.area) && second.area >= smallest.area * 3) {
    return { building: smallest.building, overlay: "smallest_nested" };
  }

  const maks = ranked.filter((h) => /Maks_Bina/i.test(h.building.layer || ""));
  if (maks.length === 1) {
    return { building: maks[0].building, overlay: "unique_maks_bina" };
  }
  if (maks.length > 1) {
    const a = maks[0];
    const b = maks[1];
    if (Number.isFinite(a.area) && b.area >= a.area * 3) {
      return { building: a.building, overlay: "smallest_maks_bina" };
    }
  }
  return null;
}

function pickCanonicalSameName(hits) {
  const ranked = hits
    .map((h) => ({
      ...h,
      area: ringsAreaM2(h.building.rings) || Number.POSITIVE_INFINITY,
      sayac: h.building.sayacCount || 0,
      rya: isRyaLayer(h.building.layer),
      bilgi: !!h.building.hasBilgi,
    }))
    .sort((a, b) => {
      if (b.sayac !== a.sayac) return b.sayac - a.sayac;
      if (a.bilgi !== b.bilgi) return a.bilgi ? -1 : 1;
      if (a.rya !== b.rya) return a.rya ? 1 : -1;
      return a.area - b.area;
    });
  const best = ranked[0];
  let overlay = "same_name_canonical";
  if (best.sayac > 0) overlay = "same_name_existing_sayac";
  else if (best.bilgi && ranked.some((r) => !r.bilgi)) overlay = "existing_bina_bilgi";
  else if (!best.rya && ranked.some((r) => r.rya)) overlay = "same_name_primary_layer";
  return { building: best.building, overlay };
}

export function resolveOverlayHits(hits) {
  if (!hits.length) return { building: null, reason: "NO_BUILDING_CANDIDATE", hitIds: [] };
  if (hits.length === 1) {
    return { building: hits[0].building, reason: null, hitIds: [hits[0].building.id] };
  }

  const deduped = dropUnnamedFootprintCopies(hits);
  if (deduped.length === 1) {
    return {
      building: deduped[0].building,
      reason: null,
      hitIds: hits.map((h) => h.building.id),
      overlay: "named_over_unnamed_copy",
    };
  }

  const names = new Set(deduped.map((h) => foldedName(h.building.value)));
  if (names.size !== 1 || ![...names][0]) {
    const nested = pickNestedOrPrimary(deduped);
    if (nested?.building) {
      return {
        building: nested.building,
        reason: null,
        hitIds: hits.map((h) => h.building.id),
        overlay: nested.overlay,
      };
    }
    return {
      building: null,
      reason: "AMBIGUOUS_BUILDING",
      hitIds: hits.map((h) => h.building.id),
    };
  }

  const picked = pickCanonicalSameName(deduped);
  return {
    building: picked.building,
    reason: null,
    hitIds: hits.map((h) => h.building.id),
    overlay: picked.overlay,
  };
}

export function loadBuildingSpatialIndex(db) {
  const sayacCounts = new Map(
    db
      .prepare(
        `SELECT bina_id, COUNT(*) c FROM sayac
         WHERE TRIM(COALESCE(sayac_id,'')) != ''
         GROUP BY bina_id`
      )
      .all()
      .map((r) => [r.bina_id, r.c])
  );
  const bilgiSet = new Set(
    db.prepare("SELECT bina_id FROM bina_bilgi").all().map((r) => r.bina_id)
  );

  const rows = db.prepare("SELECT id, value, layer, coordinates FROM binalar").all();
  const buildings = [];
  const grid = new Map();

  for (const row of rows) {
    const skipLayer = SKIP_BUILDING_LAYER.test(String(row.layer || ""));
    const rings = ringsFromCoordinates(row.coordinates);
    if (!rings.length) continue;
    const bbox = bboxOf(rings);
    const building = {
      id: row.id,
      value: row.value || "",
      layer: row.layer || "",
      skipLayer,
      rings,
      bbox,
      sayacCount: sayacCounts.get(row.id) || 0,
      hasBilgi: bilgiSet.has(row.id),
    };
    buildings.push(building);
    if (skipLayer) continue;
    const minI = Math.floor(bbox.minLat / CELL);
    const maxI = Math.floor(bbox.maxLat / CELL);
    const minJ = Math.floor(bbox.minLng / CELL);
    const maxJ = Math.floor(bbox.maxLng / CELL);
    for (let i = minI; i <= maxI; i++) {
      for (let j = minJ; j <= maxJ; j++) {
        const key = `${i}_${j}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(building);
      }
    }
  }

  return { buildings, grid, searchable: buildings.filter((b) => !b.skipLayer) };
}

function candidatesNear(index, lat, lng) {
  const seen = new Set();
  const out = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const key = `${Math.floor(lat / CELL) + di}_${Math.floor(lng / CELL) + dj}`;
      const cell = index.grid.get(key);
      if (!cell) continue;
      for (const b of cell) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        out.push(b);
      }
    }
  }
  return out;
}

function emptyMatch(reason, extra = {}) {
  return {
    method: MATCH_METHOD.NONE,
    building: null,
    meters: extra.meters ?? null,
    hitIds: extra.hitIds || [],
    confidence: "skip",
    reason,
    overlay: extra.overlay || null,
    nearestBuilding: extra.nearestBuilding || null,
  };
}

export function matchPointToBuildings(index, lat, lng, maxNearestMeters = 0, boundaryEps = BOUNDARY_EPS_M) {
  const candidates = candidatesNear(index, lat, lng);
  const inside = [];
  let nearest = null;

  for (const b of candidates) {
    const dist = minDistanceMeters(lat, lng, b.rings);
    const inBbox =
      lat >= b.bbox.minLat - 1e-8 &&
      lat <= b.bbox.maxLat + 1e-8 &&
      lng >= b.bbox.minLng - 1e-8 &&
      lng <= b.bbox.maxLng + 1e-8;
    const pip = inBbox && dist.inside;
    const onBoundary = dist.meters != null && dist.meters <= boundaryEps;
    if (pip || onBoundary) {
      inside.push({ building: b, meters: pip ? 0 : dist.meters ?? 0 });
    }
    if (dist.meters != null && (!nearest || dist.meters < nearest.meters)) {
      nearest = { building: b, meters: dist.meters, inside: dist.inside };
    }
  }

  if (inside.length) {
    const resolved = resolveOverlayHits(inside);
    if (resolved.building) {
      const hit = inside.find((h) => h.building.id === resolved.building.id);
      return {
        method: MATCH_METHOD.INSIDE,
        building: resolved.building,
        meters: hit?.meters ?? 0,
        hitIds: resolved.hitIds,
        confidence: "high",
        reason: null,
        overlay: resolved.overlay || null,
      };
    }
    return emptyMatch("AMBIGUOUS_BUILDING", { hitIds: resolved.hitIds, meters: inside[0]?.meters ?? 0 });
  }

  if (maxNearestMeters > 0 && nearest && nearest.meters <= maxNearestMeters) {
    const close = [];
    const tieEps = Math.max(0.25, nearest.meters * 0.15);
    for (const b of candidates) {
      const dist = minDistanceMeters(lat, lng, b.rings);
      if (dist.meters != null && dist.meters <= maxNearestMeters && dist.meters <= nearest.meters + tieEps) {
        close.push({ building: b, meters: dist.meters });
      }
    }
    close.sort((a, b) => a.meters - b.meters);
    const resolved = resolveOverlayHits(close);
    if (resolved.building) {
      const hit = close.find((h) => h.building.id === resolved.building.id);
      return {
        method: MATCH_METHOD.NEAREST,
        building: resolved.building,
        meters: hit?.meters ?? nearest.meters,
        hitIds: resolved.hitIds,
        confidence: "medium",
        reason: null,
        overlay: resolved.overlay || null,
      };
    }
    return emptyMatch("AMBIGUOUS_BUILDING", {
      hitIds: resolved.hitIds,
      meters: nearest.meters,
    });
  }

  if (!nearest) return emptyMatch("NO_BUILDING_CANDIDATE");
  return emptyMatch(maxNearestMeters > 0 ? "TOO_FAR_FROM_BUILDING" : "NO_BUILDING_CANDIDATE", {
    meters: nearest.meters,
    hitIds: [nearest.building.id],
    nearestBuilding: nearest.building,
  });
}
