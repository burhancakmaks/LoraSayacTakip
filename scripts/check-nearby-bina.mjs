import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const binaId = Number(process.argv[2] || 1068);
const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const target = db
  .prepare(
    `SELECT b.id, b.value, b.oda_id, b.coordinates,
            EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured,
            (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id) AS sayac_sayisi
     FROM binalar b WHERE b.id = ?`
  )
  .get(binaId);

if (!target) {
  console.log("Bina bulunamadi");
  process.exit(1);
}

const coords = JSON.parse(target.coordinates);
const lat = coords[0]?.[0]?.[0];
const lng = coords[0]?.[0]?.[1];

const nearby = db
  .prepare(
    `SELECT b.id, b.value, b.oda_id,
            EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured,
            (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id) AS sayac_sayisi
     FROM binalar b
     WHERE b.id != ?
     LIMIT 5000`
  )
  .all(binaId)
  .map((b) => {
    try {
      const c = JSON.parse(
        db.prepare("SELECT coordinates FROM binalar WHERE id = ?").get(b.id).coordinates
      );
      const blat = c[0]?.[0]?.[0];
      const blng = c[0]?.[0]?.[1];
      const dist = Math.hypot((blat - lat) * 111000, (blng - lng) * 85000);
      return { ...b, dist_m: Math.round(dist) };
    } catch {
      return { ...b, dist_m: 99999 };
    }
  })
  .filter((b) => b.dist_m < 30)
  .sort((a, b) => a.dist_m - b.dist_m);

console.log(
  JSON.stringify(
    {
      hedef_bina: {
        id: target.id,
        ad: target.value,
        oda_id: target.oda_id,
        is_configured: !!target.is_configured,
        sayac_sayisi: target.sayac_sayisi,
        merkez: { lat, lng },
      },
      yakin_binalar_30m: nearby.slice(0, 15),
    },
    null,
    2
  )
);
