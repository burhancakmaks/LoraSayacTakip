import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function bbox(coords) {
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const ring of coords) {
    for (const [lat, lng] of ring) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

function intersects(a, b) {
  return !(a.maxLat < b.minLat || a.minLat > b.maxLat || a.maxLng < b.minLng || a.minLng > b.maxLng);
}

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
const target = db.prepare("SELECT id, value, coordinates FROM binalar WHERE id = 1094").get();
const targetBox = bbox(JSON.parse(target.coordinates));

const onTop = [];
for (const r of db.prepare("SELECT id, value, coordinates FROM binalar WHERE id != 1094").all()) {
  try {
    const box = bbox(JSON.parse(r.coordinates));
    if (!intersects(targetBox, box)) continue;
    const bilgi = db.prepare("SELECT 1 as x FROM bina_bilgi WHERE bina_id = ?").get(r.id);
    const sc = db
      .prepare(
        "SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''"
      )
      .get(r.id);
    onTop.push({
      id: r.id,
      value: r.value,
      green: !!(bilgi || (sc?.c ?? 0) > 0),
      sayac_count: sc?.c ?? 0,
    });
  } catch {
    /* skip */
  }
}

console.log(
  JSON.stringify(
    {
      target: { id: target.id, value: target.value, box: targetBox },
      overlapping: onTop,
      blue_covering: onTop.filter((o) => !o.green),
    },
    null,
    2
  )
);
