import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const q = process.argv[2] || "";
const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));

const digits = String(q).replace(/^2025-/i, "").replace(/\D/g, "");
const sayacRows = db
  .prepare(
    `SELECT * FROM sayac WHERE REPLACE(REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ',''),'-','') LIKE '%' || ? || '%'`
  )
  .all(digits);

const out = { aranan: q, kayitlar: sayacRows };

for (const s of sayacRows) {
  const binaId = s.bina_id;
  const bina = db.prepare("SELECT id, value, layer FROM binalar WHERE id = ?").get(binaId);
  const bilgi = db.prepare("SELECT bina_id, toplam_bagımsız_bolum FROM bina_bilgi WHERE bina_id = ?").get(binaId);
  const sayacCount = db
    .prepare(`SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''`)
    .get(binaId);
  const coords = db.prepare("SELECT length(coordinates) as len FROM binalar WHERE id = ?").get(binaId);
  out[`bina_${binaId}`] = {
    bina,
    bina_bilgi: bilgi || null,
    sayac_count: sayacCount?.c ?? 0,
    coords_len: coords?.len ?? 0,
    is_configured_api: !!(bilgi || (sayacCount?.c ?? 0) > 0),
  };
}

const c08 = db.prepare("SELECT id, value, length(coordinates) as clen FROM binalar WHERE value = 'C08'").all();
out.c08_binalar = c08;
for (const row of c08) {
  const bilgi = db.prepare("SELECT 1 as x FROM bina_bilgi WHERE bina_id = ?").get(row.id);
  const sc = db
    .prepare(`SELECT COUNT(*) as c FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id, '')) != ''`)
    .get(row.id);
  out[`c08_${row.id}`] = { bina_bilgi: !!bilgi, sayac_count: sc?.c ?? 0, green: !!(bilgi || (sc?.c ?? 0) > 0) };
}

console.log(JSON.stringify(out, null, 2));
