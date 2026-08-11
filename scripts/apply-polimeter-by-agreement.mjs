/**
 * Polimeter sayaçları → mevcut sözleşme / abone numarasına göre eşle
 *
 * Öncelik:
 * 1) agreement_number = sayac.abone_no  (sözleşme)
 * 2) installation_number = sayac.abone_no (tesisat ≈ abone)
 *
 * Ayrıca sayac_konum ile bağlı Polimeter kayıtlarında boş abone_no'ya
 * agreement_number yazılır.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

function digits(v) {
  return String(v ?? "")
    .trim()
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

const db = new DatabaseSync(DB_PATH, { timeout: 60000 });
try {
  db.exec("PRAGMA busy_timeout = 60000");
} catch {
  /* ignore */
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(DB_PATH, join(DATA_DIR, `binalar.before-poly-agreement-${stamp}.db`));

/** @type {Map<string, Array<{id:number, sayac_id:string, bina_id:number, abone_no:string}>>} */
const byAbone = new Map();
/** @type {Map<string, {id:number, sayac_id:string, bina_id:number, abone_no:string}>} */
const bySayacId = new Map();

for (const r of db
  .prepare(
    `SELECT id, sayac_id, bina_id, abone_no FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '' OR TRIM(COALESCE(abone_no,'')) != ''`
  )
  .all()) {
  const abone = String(r.abone_no ?? "").trim();
  const sayacId = String(r.sayac_id ?? "").trim();
  if (abone) {
    const k = digits(abone);
    if (k) {
      if (!byAbone.has(k)) byAbone.set(k, []);
      byAbone.get(k).push(r);
    }
  }
  if (sayacId && !bySayacId.has(sayacId)) {
    bySayacId.set(sayacId, r);
  }
}

const stats = {
  poly_total: 0,
  matched_agreement: 0,
  matched_installation: 0,
  skipped_already_linked: 0,
  skipped_no_abone_hit: 0,
  abone_backfilled: 0,
  latlng_updated: 0,
  konum_updated: 0,
  ambiguous: 0,
};

const updateSayac = db.prepare(`
  UPDATE sayac SET
    lat = COALESCE(?, lat),
    lng = COALESCE(?, lng),
    sayac_markasi = CASE
      WHEN TRIM(COALESCE(sayac_markasi,'')) = '' THEN 'Polimeter'
      ELSE sayac_markasi
    END,
    abone_no = CASE
      WHEN TRIM(COALESCE(abone_no,'')) = '' THEN ?
      ELSE abone_no
    END,
    updated_at = datetime('now')
  WHERE id = ?
`);

const updateKonum = db.prepare(`
  UPDATE sayac_konum SET
    bina_id = ?,
    sayac_id_matched = ?,
    match_kaynak = ?,
    updated_at = datetime('now')
  WHERE id = ?
`);

const backfillAbone = db.prepare(`
  UPDATE sayac SET abone_no = ?, updated_at = datetime('now')
  WHERE id = ? AND TRIM(COALESCE(abone_no,'')) = ''
`);

db.exec("BEGIN");

const polyRows = db
  .prepare(
    `
    SELECT id, meter_number, agreement_number, installation_number,
           lat, lng, bina_id, sayac_id_matched, match_kaynak
    FROM sayac_konum
    WHERE meter_type = 'POLIMETER_LORA_W'
  `
  )
  .all();

stats.poly_total = polyRows.length;

for (const row of polyRows) {
  const agr = digits(row.agreement_number);
  const inst = digits(row.installation_number);
  const agreementRaw = String(row.agreement_number ?? "").trim();
  const matchedId = String(row.sayac_id_matched ?? "").trim();

  // Zaten bağlı → sözleşme (agreement) boş abone_no'ya yaz
  if (matchedId) {
    stats.skipped_already_linked++;
    const linked = bySayacId.get(matchedId);
    if (linked && !String(linked.abone_no ?? "").trim() && agreementRaw) {
      backfillAbone.run(agreementRaw, linked.id);
      linked.abone_no = agreementRaw;
      stats.abone_backfilled++;
    }
    continue;
  }

  let hits = agr ? byAbone.get(agr) || [] : [];
  let kaynak = "abone_agreement";
  if (!hits.length && inst) {
    hits = byAbone.get(inst) || [];
    kaynak = "abone_installation";
  }

  if (!hits.length) {
    stats.skipped_no_abone_hit++;
    continue;
  }

  if (hits.length > 1) stats.ambiguous++;
  const hit = hits[0];

  updateSayac.run(
    row.lat ?? null,
    row.lng ?? null,
    agreementRaw || String(hit.abone_no),
    hit.id
  );
  stats.latlng_updated++;

  if (!String(hit.abone_no ?? "").trim() && agreementRaw) {
    hit.abone_no = agreementRaw;
    stats.abone_backfilled++;
  }

  updateKonum.run(hit.bina_id, String(hit.sayac_id), kaynak, row.id);
  stats.konum_updated++;

  if (kaynak === "abone_agreement") stats.matched_agreement++;
  else stats.matched_installation++;
}

db.exec("COMMIT");

const report = {
  ...stats,
  finished_at: new Date().toISOString(),
};

const reportPath = join(DATA_DIR, `polimeter-agreement-report-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, ...report, report: reportPath }, null, 2));
