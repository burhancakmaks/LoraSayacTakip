import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
const etap = db
  .prepare(
    `SELECT id, value, length(coordinates) as clen FROM binalar
     WHERE UPPER(value) LIKE '%ETAP%' OR UPPER(layer) LIKE '%ETAP%'`
  )
  .all();

const bina1094 = db.prepare("SELECT coordinates FROM binalar WHERE id = 1094").get();
const [lat, lng] = JSON.parse(bina1094.coordinates)[0][0];

const near = [];
for (const r of db.prepare("SELECT id, value, coordinates FROM binalar").all()) {
  try {
    const c = JSON.parse(r.coordinates);
    for (const ring of c) {
      for (const [rlat, rlng] of ring) {
        const d = Math.hypot(rlat - lat, rlng - lng);
        if (d < 0.002) {
          const bilgi = db.prepare("SELECT 1 as x FROM bina_bilgi WHERE bina_id = ?").get(r.id);
          const sc = db
            .prepare(
              "SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''"
            )
            .get(r.id);
          near.push({
            id: r.id,
            value: r.value,
            dist: d,
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

near.sort((a, b) => a.dist - b.dist);
const unique = [...new Map(near.map((n) => [n.id, n])).values()].slice(0, 15);

console.log(
  JSON.stringify(
    {
      c08_center: { lat, lng },
      etap_buildings: etap.slice(0, 10),
      nearby: unique,
    },
    null,
    2
  )
);
