/**
 * Son polygon fix'teki aktif abone / sayacli binalar icin bina_bilgi olusturur -> haritada yesil.
 * Kullanim: node scripts/green-polygon-fixed.mjs [--apply]
 */
import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const apply = process.argv.includes("--apply");
const MIN_AREA_M2 = 10;

function measureRing(ring) {
  if (!ring?.length) return 0;
  let minLat = 999,
    maxLat = -999,
    minLng = 999,
    maxLng = -999;
  for (const [lat, lng] of ring) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return (maxLat - minLat) * 111000 * (maxLng - minLng) * 85000;
}

function measureStored(coordsJson) {
  try {
    return measureRing(JSON.parse(coordsJson)[0]);
  } catch {
    return 0;
  }
}

const db = new DatabaseSync(DB_PATH);

const backups = readdirSync(join(ROOT, "data"))
  .filter((f) => f.startsWith("binalar.before-polygon-fix-"))
  .sort()
  .reverse();

const fixedIds = [];
if (backups.length) {
  const backupDb = new DatabaseSync(join(ROOT, "data", backups[0]));
  const backupMap = new Map(
    backupDb.prepare("SELECT id, coordinates FROM binalar").all().map((r) => [r.id, r.coordinates])
  );
  for (const row of db.prepare("SELECT id, coordinates FROM binalar").all()) {
    const prev = backupMap.get(row.id);
    if (!prev) continue;
    if (measureStored(prev) < MIN_AREA_M2 && measureStored(row.coordinates) >= MIN_AREA_M2) {
      fixedIds.push(row.id);
    }
  }
  backupDb.close();
}

const plan = [];
for (const binaId of fixedIds) {
  const bina = db.prepare("SELECT id, value, aktif_abone_sayisi FROM binalar WHERE id=?").get(binaId);
  if (!bina) continue;
  const bilgi = db.prepare("SELECT 1 FROM bina_bilgi WHERE bina_id=?").get(binaId);
  if (bilgi) continue;

  const sayacStats = db
    .prepare(
      `
    SELECT
      COUNT(*) AS sayac_kayit,
      SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS numarali
    FROM sayac WHERE bina_id=?
  `
    )
    .get(binaId);

  const kapasite = Math.max(sayacStats.numarali || 0, sayacStats.sayac_kayit || 0, bina.aktif_abone_sayisi || 0);
  if (kapasite <= 0) continue;

  plan.push({
    bina_id: binaId,
    value: bina.value,
    aktif_abone: bina.aktif_abone_sayisi,
    numarali_sayac: sayacStats.numarali,
    kapasite,
  });
}

console.log(
  JSON.stringify(
    {
      apply,
      son_fix_bina_sayisi: fixedIds.length,
      yesil_yapilacak: plan.length,
      plan,
    },
    null,
    2
  )
);

if (apply && plan.length) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  copyFileSync(DB_PATH, join(ROOT, `data/binalar.before-green-fix-${stamp}.db`));

  const insert = db.prepare(`
    INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
      has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
    VALUES (?, 0, ?, 0, ?, 0, '', '', '', datetime('now'))
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const p of plan) {
      insert.run(p.bina_id, p.kapasite, p.kapasite);
    }
    db.exec("COMMIT");
    console.log(`Uygulandi: ${plan.length} bina yesil yapildi.`);
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
