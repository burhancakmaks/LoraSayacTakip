import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kml = readFileSync(join(process.cwd(), "data/Binalar.kml"), "utf8");
const block = kml.slice(kml.indexOf("38.3218370967905"), kml.indexOf("38.3218370967905") + 5000);
const get = (name) => {
  const r = kml.slice(kml.indexOf("38.3218370967905") - 3000, kml.indexOf("38.3218370967905") + 500).match(
    new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`)
  );
  return r ? r[1].trim() : "";
};

// parse the large C08 placemark at 4039
const idx = kml.indexOf("38.3218370967905,38.3480013376852");
const placemarkStart = kml.lastIndexOf("<Placemark>", idx);
const placemarkEnd = kml.indexOf("</Placemark>", idx) + 12;
const pm = kml.slice(placemarkStart, placemarkEnd);
const g = (name) => {
  const r = pm.match(new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`));
  return r ? r[1].trim() : "";
};
const coordsText = pm.match(/<coordinates>([\s\S]*?)<\/coordinates>/)[1];
const ring = coordsText
  .trim()
  .split(/\s+/)
  .filter(Boolean)
  .map((pt) => {
    const [lng, lat] = pt.split(",").map(Number);
    return [lat, lng];
  });

let minLat = 99, maxLat = -99, minLng = 99, maxLng = -99;
for (const [lat, lng] of ring) {
  minLat = Math.min(minLat, lat);
  maxLat = Math.max(maxLat, lat);
  minLng = Math.min(minLng, lng);
  maxLng = Math.max(maxLng, lng);
}

const kmlC08 = {
  value: g("value"),
  id_2: g("id_2"),
  kml_id: g("id"),
  oda_id: g("oda_id"),
  layer: g("layer"),
  points: ring.length,
  center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
  area_m2: (maxLat - minLat) * 111000 * (maxLng - minLng) * 85000,
};

const db = new DatabaseSync(join(process.cwd(), "data/binalar.db"));
const b1094 = db.prepare("SELECT id,value,kml_id,id_2,oda_id,coordinates FROM binalar WHERE id=1094").get();
const c1094 = JSON.parse(b1094.coordinates)[0];
let bminLat = 99, bmaxLat = -99;
for (const [lat, lng] of c1094) {
  bminLat = Math.min(bminLat, lat);
  bmaxLat = Math.max(bmaxLat, lat);
}

// find DB building with nearest center to kmlC08
const all = db.prepare("SELECT id,value,kml_id,id_2,coordinates FROM binalar").all();
let nearest = null;
let bestD = Infinity;
for (const b of all) {
  try {
    const ring = JSON.parse(b.coordinates)[0];
    let minLat = 99, maxLat = -99, minLng = 99, maxLng = -99;
    for (const [lat, lng] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
    const clat = (minLat + maxLat) / 2;
    const clng = (minLng + maxLng) / 2;
    const d = Math.hypot(clat - kmlC08.center[0], clng - kmlC08.center[1]);
    if (d < bestD) {
      bestD = d;
      nearest = { id: b.id, value: b.value, dist: d, kml_id: b.kml_id };
    }
  } catch {
    /* skip */
  }
}

console.log(
  JSON.stringify(
    {
      kml_gercek_c08: kmlC08,
      db_bina_1094: {
        value: b1094.value,
        kml_id: b1094.kml_id,
        center_approx: [(bminLat + bmaxLat) / 2, c1094[0][1]],
        size_m: ((bmaxLat - bminLat) * 111000).toFixed(1),
      },
      en_yakin_db_bina: nearest,
      mesafe_km: (bestD * 111).toFixed(2),
    },
    null,
    2
  )
);
