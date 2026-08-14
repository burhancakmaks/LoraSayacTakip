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

export function resolveOverlayHits(hits) {
  if (!hits.length) return { building: null, reason: "NO_BUILDING_CANDIDATE", hitIds: [] };
  if (hits.length === 1) {
    return { building: hits[0].building, reason: null, hitIds: [hits[0].building.id] };
  }

  const names = new Set(hits.map((h) => unicodeFold(h.building.value).toLocaleUpperCase("tr-TR")));
  if (names.size !== 1 || ![...names][0]) {
    return {
      building: null,
      reason: "AMBIGUOUS_BUILDING",
      hitIds: hits.map((h) => h.building.id),
    };
  }

  const withSayac = hits.filter((h) => (h.building.sayacCount || 0) > 0);
  if (withSayac.length === 1) {
    return { building: withSayac[0].building, reason: null, hitIds: hits.map((h) => h.building.id), overlay: "existing_sayac" };
  }
  if (withSayac.length > 1) {
    return { building: null, reason: "AMBIGUOUS_BUILDING", hitIds: hits.map((h) => h.building.id) };
  }

  const withBilgi = hits.filter((h) => h.building.hasBilgi);
  if (withBilgi.length === 1) {
    return { building: withBilgi[0].building, reason: null, hitIds: hits.map((h) => h.building.id), overlay: "existing_bina_bilgi" };
  }

  const primary = hits.filter((h) => !isRyaLayer(h.building.layer));
  if (primary.length === 1) {
    return { building: primary[0].building, reason: null, hitIds: hits.map((h) => h.building.id), overlay: "same_name_primary_layer" };
  }

  return { building: null, reason: "AMBIGUOUS_BUILDING", hitIds: hits.map((h) => h.building.id) };
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
