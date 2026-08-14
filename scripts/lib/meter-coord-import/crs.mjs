/** Transverse Mercator / UTM inverse without extra GIS dependencies. */

const WGS84 = { a: 6378137, f: 1 / 298.257223563, name: "WGS84" };
const GRS80 = { a: 6378137, f: 1 / 298.257222101, name: "GRS80" };
const INTL1924 = { a: 6378388, f: 1 / 297, name: "intl1924" };

function degToRad(d) {
  return (d * Math.PI) / 180;
}

function radToDeg(r) {
  return (r * 180) / Math.PI;
}

export function inverseTmerc(easting, northing, opts) {
  const { lon0, k0, falseEasting = 500000, falseNorthing = 0, ellipsoid = WGS84 } = opts;
  const a = ellipsoid.a;
  const f = ellipsoid.f;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const M = (northing - falseNorthing) / k0;
  const mu =
    M /
    (a *
      (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const ep2 = e2 / (1 - e2);
  const sinP = Math.sin(phi1);
  const cosP = Math.cos(phi1);
  const tanP = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T1 = tanP * tanP;
  const C1 = ep2 * cosP * cosP;
  const R1 = (a * (1 - e2)) / (1 - e2 * sinP * sinP) ** 1.5;
  const D = (easting - falseEasting) / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * tanP) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    degToRad(lon0) +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cosP;
  return { lat: radToDeg(lat), lng: radToDeg(lon) };
}

function geodeticToEcef(latDeg, lngDeg, ellipsoid) {
  const a = ellipsoid.a;
  const e2 = ellipsoid.f * (2 - ellipsoid.f);
  const lat = degToRad(latDeg);
  const lng = degToRad(lngDeg);
  const sin = Math.sin(lat);
  const cos = Math.cos(lat);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  return {
    x: N * cos * Math.cos(lng),
    y: N * cos * Math.sin(lng),
    z: N * (1 - e2) * sin,
  };
}

function ecefToGeodetic(x, y, z, ellipsoid) {
  const a = ellipsoid.a;
  const e2 = ellipsoid.f * (2 - ellipsoid.f);
  const b = a * (1 - ellipsoid.f);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.hypot(x, y);
  const th = Math.atan2(a * z, b * p);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3);
  const lng = Math.atan2(y, x);
  return { lat: radToDeg(lat), lng: radToDeg(lng) };
}

/** Common 3-parameter ED50 → WGS84 shift used in Turkey. */
const ED50_TO_WGS84 = { dx: -84.1, dy: -101.8, dz: -129.7 };

function applyHelmert3(lat, lng, fromEllipsoid, toEllipsoid, shift) {
  const p = geodeticToEcef(lat, lng, fromEllipsoid);
  return ecefToGeodetic(p.x + shift.dx, p.y + shift.dy, p.z + shift.dz, toEllipsoid);
}

export const CRS_CANDIDATES = [
  {
    code: "EPSG:32637",
    name: "WGS84 / UTM zone 37N",
    convert(x, y) {
      return inverseTmerc(x, y, { lon0: 39, k0: 0.9996, ellipsoid: WGS84 });
    },
  },
  {
    code: "EPSG:5258",
    name: "TUREF / TM39",
    convert(x, y) {
      return inverseTmerc(x, y, { lon0: 39, k0: 1, ellipsoid: GRS80 });
    },
  },
  {
    code: "EPSG:5257",
    name: "TUREF / TM36",
    convert(x, y) {
      return inverseTmerc(x, y, { lon0: 36, k0: 1, ellipsoid: GRS80 });
    },
  },
  {
    code: "EPSG:5256",
    name: "TUREF / TM33",
    convert(x, y) {
      return inverseTmerc(x, y, { lon0: 33, k0: 1, ellipsoid: GRS80 });
    },
  },
  {
    code: "EPSG:5255",
    name: "TUREF / TM30",
    convert(x, y) {
      return inverseTmerc(x, y, { lon0: 30, k0: 1, ellipsoid: GRS80 });
    },
  },
  {
    code: "EPSG:23037",
    name: "ED50 / UTM zone 37N",
    convert(x, y) {
      const ed = inverseTmerc(x, y, { lon0: 39, k0: 0.9996, ellipsoid: INTL1924 });
      return applyHelmert3(ed.lat, ed.lng, INTL1924, WGS84, ED50_TO_WGS84);
    },
  },
  {
    code: "EPSG:32637-SWAP",
    name: "WGS84 / UTM 37N with X/Y swapped",
    convert(x, y) {
      return inverseTmerc(y, x, { lon0: 39, k0: 0.9996, ellipsoid: WGS84 });
    },
  },
];

export function projectPoint(x, y, crsCode) {
  const crs = CRS_CANDIDATES.find((c) => c.code === crsCode);
  if (!crs) return null;
  const out = crs.convert(x, y);
  if (!Number.isFinite(out.lat) || !Number.isFinite(out.lng)) return null;
  return out;
}

export function describeCrs(code) {
  return CRS_CANDIDATES.find((c) => c.code === code) || null;
}
