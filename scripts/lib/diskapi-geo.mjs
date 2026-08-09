/** Dış kapı noktası ↔ bina poligonu geometri yardımcıları (WGS84, [lat,lng]). */

const M_PER_DEG_LAT = 111_320;

export function metersPerDegLng(lat) {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function toMeters(lat, lng, refLat, refLng) {
  const x = (lng - refLng) * metersPerDegLng(refLat);
  const y = (lat - refLat) * M_PER_DEG_LAT;
  return { x, y };
}

export function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersect =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI + 0) + lngI;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointSegmentMeters(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/** Kapı noktasının bina poligon kenarına en yakın mesafe (metre). */
export function distanceToBuildingMeters(lat, lng, coordinates) {
  const rings = Array.isArray(coordinates?.[0]?.[0]) ? coordinates : [coordinates];
  const refLat = lat;
  const refLng = lng;
  const p = toMeters(lat, lng, refLat, refLng);

  let minDist = Infinity;
  let insideAny = false;

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    if (pointInRing(lat, lng, ring)) insideAny = true;

    for (let i = 0; i < ring.length; i++) {
      const [latA, lngA] = ring[i];
      const [latB, lngB] = ring[(i + 1) % ring.length];
      const a = toMeters(latA, lngA, refLat, refLng);
      const b = toMeters(latB, lngB, refLat, refLng);
      minDist = Math.min(minDist, distPointSegmentMeters(p.x, p.y, a.x, a.y, b.x, b.y));
    }
  }

  return { edgeDistanceM: minDist === Infinity ? null : minDist, inside: insideAny };
}

export function classifyDoorAlignment(edgeDistanceM, inside) {
  if (edgeDistanceM == null) return "invalid_geometry";
  if (edgeDistanceM <= 8) return "on_edge";
  if (inside) return "inside_polygon";
  if (edgeDistanceM <= 25) return "near_edge";
  return "far_from_building";
}

export function parseKmlSimpleData(placemarkXml) {
  const data = {};
  const re = /<SimpleData name="([^"]+)">([^<]*)<\/SimpleData>/g;
  let m;
  while ((m = re.exec(placemarkXml))) {
    data[m[1]] = m[2].trim();
  }
  return data;
}

export function parseKmlPoint(placemarkXml) {
  const coordMatch = placemarkXml.match(/<Point>\s*<coordinates>\s*([^<]+)\s*<\/coordinates>/i);
  if (!coordMatch) return null;
  const [lng, lat] = coordMatch[1].trim().split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Büyük KML dosyasını parça parça placemark olarak okur. */
export function* iterKmlPlacemarks(kmlText) {
  const re = /<Placemark>[\s\S]*?<\/Placemark>/g;
  let m;
  while ((m = re.exec(kmlText))) {
    yield m[0];
  }
}
