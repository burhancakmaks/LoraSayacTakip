import { readFileSync } from "node:fs";
import { join } from "node:path";

const kml = readFileSync(join(process.cwd(), "data/Binalar.kml"), "utf8");

function measureRing(ring) {
  let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
  for (const [lat, lng] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return {
    area: (maxLat - minLat) * 111000 * (maxLng - minLng) * 85000,
    center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2],
    points: ring.length,
  };
}

const re = /<Placemark>[\s\S]*?<\/Placemark>/g;
let m;
const hits = [];
while ((m = re.exec(kml))) {
  const block = m[0];
  const get = (name) => {
    const r = block.match(new RegExp(`<SimpleData name="${name}">([^<]*)</SimpleData>`));
    return r ? r[1].trim() : "";
  };
  const value = get("value");
  const id2 = get("id_2") || get("code");
  if (value !== "C08" && id2 !== "254292") continue;
  const cm = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
  if (!cm) continue;
  const ring = cm[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((pt) => {
      const [lng, lat] = pt.split(",").map(Number);
      return [lat, lng];
    });
  const m2 = measureRing(ring);
  hits.push({
    value,
    id2,
    kml_id: get("id"),
    oda_id: get("oda_id"),
    layer: get("layer"),
    ...m2,
    area: +m2.area.toFixed(1),
  });
}
hits.sort((a, b) => b.area - a.area);
console.log(JSON.stringify(hits, null, 2));
