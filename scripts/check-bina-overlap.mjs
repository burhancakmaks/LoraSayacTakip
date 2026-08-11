import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const binaId = Number(process.argv[2] || 1094);
const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const target = db.prepare("SELECT id, value, coordinates FROM binalar WHERE id = ?").get(binaId);
const coords = JSON.parse(target.coordinates);
let minLat = Infinity,
  maxLat = -Infinity,
  minLng = Infinity,
  maxLng = -Infinity;
for (const ring of coords) {
  for (const [lat, lng] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
}

const rows = db.prepare("SELECT id, value, coordinates FROM binalar").all();
const overlaps = [];
for (const r of rows) {
  if (r.id === binaId) continue;
  try {
    const c = JSON.parse(r.coordinates);
    for (const ring of c) {
      for (const [lat, lng] of ring) {
        if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
          const bilgi = db.prepare("SELECT 1 as x FROM bina_bilgi WHERE bina_id = ?").get(r.id);
          const sc = db
            .prepare(
              "SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''"
            )
            .get(r.id);
          overlaps.push({
            id: r.id,
            value: r.value,
            green: !!(bilgi || (sc?.c ?? 0) > 0),
            sayac_count: sc?.c ?? 0,
          });
          break;
        }
      }
    }
  } catch {
    /* skip */
  }
}

const unique = [...new Map(overlaps.map((o) => [o.id, o])).values()];
console.log(
  JSON.stringify(
    {
      target: { id: target.id, value: target.value, bounds: { minLat, maxLat, minLng, maxLng } },
      overlap_count: unique.length,
      overlaps: unique.slice(0, 20),
      blue_on_top: unique.filter((o) => !o.green).length,
    },
    null,
    2
  )
);
