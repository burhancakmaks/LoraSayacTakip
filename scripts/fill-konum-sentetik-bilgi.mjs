/**
 * KOORDINAT_SENTETIK binalar için bina_bilgi, bina adı ve sayaç detaylarını doldurur.
 * Kaynak: sayac_konum (installation_number, agreement_number, meter_type)
 *
 *   node scripts/fill-konum-sentetik-bilgi.mjs --dry-run
 *   node scripts/fill-konum-sentetik-bilgi.mjs --apply
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

const dryRun = !process.argv.includes("--apply");
const MAHALLE = "İkizce Mahallesi";
const SOKAK = "İkizce (uzaktan okuma)";

function normMeter(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function aboneFromAgreement(agreement) {
  const digits = String(agreement ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 8) return digits;
  return digits.slice(-8);
}

function markaFromType(t) {
  const s = String(t ?? "").toUpperCase();
  if (s.includes("POLIMETER")) return "POLIMETER";
  if (s.includes("BAYLAN")) return "BAYLAN";
  return s.includes("LORA") ? "LORA" : "";
}

function inferKatSayisi(daire) {
  if (daire <= 2) return 1;
  if (daire <= 6) return 2;
  if (daire <= 12) return 3;
  if (daire <= 24) return 4;
  if (daire <= 40) return 5;
  return Math.min(8, Math.ceil(daire / 8));
}

function estimateKatForRow(index, katSayisi, total) {
  if (katSayisi <= 1) return index === 0 ? "ZEMİN KAT" : "1. KAT";
  const floors = ["ZEMİN KAT"];
  for (let k = 1; k <= katSayisi; k++) floors.push(`${k}. KAT`);
  const per = Math.ceil(total / floors.length);
  const slot = Math.min(floors.length - 1, Math.floor(index / Math.max(per, 1)));
  return floors[slot];
}

const db = new DatabaseSync(DB_PATH);

const synthetics = db
  .prepare(
    `SELECT b.id, b.value, b.abone_sayisi, b.aktif_abone_sayisi
     FROM binalar b
     WHERE b.layer LIKE '%KOORDINAT_SENTETIK%'
     ORDER BY b.id`
  )
  .all();

const getKonum = db.prepare(
  `SELECT id, meter_number, meter_key, installation_number, agreement_number, meter_type, lat, lng, sayac_id_matched
   FROM sayac_konum WHERE bina_id = ? ORDER BY installation_number, meter_number`
);

const getSayac = db.prepare(
  `SELECT id, birim_no, sayac_id, abone_no, kapi_no, kat, sayac_markasi, lat, lng
   FROM sayac WHERE bina_id = ? ORDER BY birim_no`
);

const stats = {
  binalar: synthetics.length,
  bina_renamed: 0,
  bilgi_upserted: 0,
  sayac_updated: 0,
  sayac_inserted: 0,
  konum_matched: 0,
};

const plan = [];

for (const b of synthetics) {
  const konumRows = getKonum.all(b.id);
  const sayacRows = getSayac.all(b.id);

  const daire = Math.max(konumRows.length, sayacRows.filter((s) => String(s.sayac_id ?? "").trim()).length, 1);
  const katSayisi = inferKatSayisi(daire);
  const primaryInst =
    konumRows.map((r) => String(r.installation_number ?? "").trim()).filter(Boolean).sort()[0] || "";
  const disKapi = primaryInst;
  const label = disKapi
    ? `İKİZCE / Kapı ${disKapi} (${daire} sayaç)`
    : `İKİZCE / Konum ${b.id} (${daire} sayaç)`;

  plan.push({
    bina_id: b.id,
    label,
    daire,
    katSayisi,
    disKapi,
    konum: konumRows.length,
    sayac: sayacRows.length,
  });
}

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", ...stats, sample: plan.slice(0, 5) }, null, 2));

if (dryRun) {
  console.log("\nUygulamak için: node scripts/fill-konum-sentetik-bilgi.mjs --apply");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = join(DATA_DIR, `binalar.before-fill-sentetik-bilgi-${stamp}.db`);
copyFileSync(DB_PATH, backup);

const updBina = db.prepare(`
  UPDATE binalar
  SET value = ?, abone_sayisi = ?, aktif_abone_sayisi = ?
  WHERE id = ?
`);

const upsertBilgi = db.prepare(`
  INSERT INTO bina_bilgi (
    bina_id, kat_sayisi, daire_sayisi, daire_per_kat, ortak_alan_sayisi,
    toplam_bagımsız_bolum, has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
  ) VALUES (?, ?, ?, ?, 0, ?, 1, ?, ?, ?, datetime('now'))
  ON CONFLICT(bina_id) DO UPDATE SET
    kat_sayisi = excluded.kat_sayisi,
    daire_sayisi = excluded.daire_sayisi,
    daire_per_kat = excluded.daire_per_kat,
    toplam_bagımsız_bolum = excluded.toplam_bagımsız_bolum,
    has_zemin = 1,
    ada_parsel = excluded.ada_parsel,
    sokak = excluded.sokak,
    dis_kapi_no = excluded.dis_kapi_no,
    updated_at = datetime('now')
`);

const updSayac = db.prepare(`
  UPDATE sayac SET
    abone_no = CASE WHEN TRIM(COALESCE(abone_no,'')) = '' THEN ? ELSE abone_no END,
    kapi_no = ?,
    kat = ?,
    sayac_markasi = CASE WHEN TRIM(COALESCE(sayac_markasi,'')) = '' THEN ? ELSE sayac_markasi END,
    blok_no = CASE WHEN TRIM(COALESCE(blok_no,'')) = '' THEN 'İKİZCE' ELSE blok_no END,
    lat = COALESCE(lat, ?),
    lng = COALESCE(lng, ?),
    updated_at = datetime('now')
  WHERE id = ?
`);

const insertSayac = db.prepare(`
  INSERT INTO sayac (
    bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
    sayac_markasi, sayac_id, sicil_no, abone_no, sayac_durum, lat, lng, updated_at
  ) VALUES (?, ?, 'İKİZCE', ?, ?, 'YOK', 'DAİRE', ?, ?, '', ?, 'gecerli', ?, ?, datetime('now'))
`);

const updKonumMatch = db.prepare(`
  UPDATE sayac_konum SET sayac_id_matched = ?, updated_at = datetime('now') WHERE id = ?
`);

db.exec("BEGIN IMMEDIATE");
try {
  for (const item of plan) {
    const konumRows = getKonum.all(item.bina_id);
    const sayacRows = getSayac.all(item.bina_id);
    const dairePerKat = Math.max(1, Math.ceil(item.daire / Math.max(item.katSayisi, 1)));

    updBina.run(item.label, item.daire, item.daire, item.bina_id);
    stats.bina_renamed++;

    upsertBilgi.run(
      item.bina_id,
      item.katSayisi,
      item.daire,
      dairePerKat,
      item.daire,
      MAHALLE,
      SOKAK,
      item.disKapi
    );
    stats.bilgi_upserted++;

    const sayacByKey = new Map();
    for (const s of sayacRows) {
      const k = normMeter(s.sayac_id);
      if (k) sayacByKey.set(k, s);
    }

    const usedSayacIds = new Set();
    let birim = Math.max(...sayacRows.map((s) => s.birim_no), 0);

    for (let i = 0; i < konumRows.length; i++) {
      const k = konumRows[i];
      const meterKey = k.meter_key || normMeter(k.meter_number);
      const abone = aboneFromAgreement(k.agreement_number);
      const kapi = String(k.installation_number ?? "").trim();
      const marka = markaFromType(k.meter_type);
      const kat = estimateKatForRow(i, item.katSayisi, konumRows.length);

      let sayacRow = meterKey ? sayacByKey.get(meterKey) : null;
      if (!sayacRow && meterKey) {
        for (const s of sayacRows) {
          if (usedSayacIds.has(s.id)) continue;
          if (normMeter(s.sayac_id) === meterKey) {
            sayacRow = s;
            break;
          }
        }
      }

      if (sayacRow) {
        usedSayacIds.add(sayacRow.id);
        updSayac.run(abone, kapi, kat, marka, k.lat, k.lng, sayacRow.id);
        stats.sayac_updated++;
        if (!String(k.sayac_id_matched ?? "").trim() && sayacRow.sayac_id) {
          updKonumMatch.run(String(sayacRow.sayac_id), k.id);
          stats.konum_matched++;
        }
      } else if (meterKey) {
        birim++;
        insertSayac.run(
          item.bina_id,
          birim,
          kat,
          kapi,
          marka,
          String(k.meter_number ?? "").trim(),
          abone,
          k.lat,
          k.lng
        );
        stats.sayac_inserted++;
        updKonumMatch.run(String(k.meter_number ?? "").trim(), k.id);
        stats.konum_matched++;
      }
    }

    // Kalan sayaçlara da abone/kapi eşlemesi (konum eşleşmeyenler)
    for (const s of sayacRows) {
      if (usedSayacIds.has(s.id)) continue;
      const matchKonum = konumRows.find((k) => normMeter(k.meter_number) === normMeter(s.sayac_id));
      if (!matchKonum) continue;
      const abone = aboneFromAgreement(matchKonum.agreement_number);
      const kapi = String(matchKonum.installation_number ?? "").trim();
      const kat = estimateKatForRow(s.birim_no - 1, item.katSayisi, konumRows.length);
      const marka = markaFromType(matchKonum.meter_type);
      updSayac.run(abone, kapi, kat, marka, matchKonum.lat, matchKonum.lng, s.id);
      stats.sayac_updated++;
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const reportPath = join(DATA_DIR, `fill-sentetik-bilgi-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify({ backup, ...stats, finished_at: new Date().toISOString() }, null, 2));

console.log(JSON.stringify({ ok: true, backup, report: reportPath, ...stats }, null, 2));
