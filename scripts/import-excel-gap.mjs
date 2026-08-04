/**
 * Excel indeksinde olup DB'de olmayan sayaclari ekler.
 * Kullanim: node scripts/import-excel-gap.mjs [--apply]
 */
import { readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data/binalar.db");
const apply = process.argv.includes("--apply");

const SHEET_5ETAP = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

const ADA51_BLOK = {
  "A BLOK": 1723,
  "B BLOK": 1749,
  "C BLOK": 2016,
  OTOPARK: 2600,
};

const SIRE_BLOK = {
  "A BLOK": 1935,
  "B BLOK": 1938,
  "C BLOK": 1936,
  "D BLOK": 1937,
};

function normSayac(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function normBlok(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

function resolveBina(rec) {
  const kaynak = String(rec.kaynak || "");
  const blok = normBlok(rec.blok);

  if (kaynak.includes("5. ETAP") || kaynak.includes("5 ETAP")) {
    return SHEET_5ETAP[blok.replace(/\s+/g, "")] || SHEET_5ETAP[blok] || null;
  }
  if (kaynak.includes("51 ADA")) {
    return ADA51_BLOK[blok] || null;
  }
  if (kaynak.includes("ŞİRE") || kaynak.includes("SIRE")) {
    return SIRE_BLOK[blok] || null;
  }
  return null;
}

const maski = JSON.parse(readFileSync(join(ROOT, "data/maski-arama-index.json"), "utf8"));
const db = new DatabaseSync(DB_PATH);

const existing = new Set(
  db
    .prepare(`SELECT sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
    .all()
    .map((r) => normSayac(r.sayac_id))
);

const missing = maski.records.filter((r) => {
  const key = normSayac(r.sayac_no);
  return key && !existing.has(key);
});

const plan = [];
const errors = [];

for (const rec of missing) {
  const binaId = resolveBina(rec);
  if (!binaId) {
    errors.push({ sayac: rec.sayac_no, reason: "no_bina", rec });
    continue;
  }
  const bina = db.prepare("SELECT id, value FROM binalar WHERE id=?").get(binaId);
  if (!bina) {
    errors.push({ sayac: rec.sayac_no, reason: "bina_not_found", binaId });
    continue;
  }
  plan.push({
    bina_id: binaId,
    bina_adi: bina.value,
    blok_no: normBlok(rec.blok),
    kapi_no: String(rec.kapi_no || "").trim(),
    kat: String(rec.kat || "").trim(),
    kullanilis_sekli: String(rec.sayac_tipi || rec.nitelik || "DAİRE").trim() || "DAİRE",
    sayac_id: String(rec.sayac_no).trim(),
    abone_no: String(rec.abone_no || "").trim(),
    kaynak: rec.kaynak,
  });
}

const before = db
  .prepare(`SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
  .get().c;

console.log(
  JSON.stringify(
    {
      apply,
      onceki_toplam_sayac: before,
      beklenen_yeni_toplam: before + plan.length,
      eklenecek: plan.length,
      hata: errors.length,
      plan,
      errors,
    },
    null,
    2
  )
);

if (!apply || !plan.length) process.exit(0);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(DB_PATH, join(ROOT, `data/binalar.before-excel-gap-${stamp}.db`));

const insertSayac = db.prepare(`
  INSERT INTO sayac (bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
    sayac_markasi, sayac_id, sicil_no, abone_no, sayac_durum, updated_at)
  SELECT ?, ?, ?, ?, ?, 'YOK', ?, '', ?, '', ?, 'gecerli', datetime('now')
  WHERE NOT EXISTS (
    SELECT 1 FROM sayac
    WHERE TRIM(COALESCE(sayac_id,'')) != ''
      AND REPLACE(REPLACE(REPLACE(UPPER(TRIM(sayac_id)),'2025-',''),'-',''),' ','') = ?
  )
`);

const insertBilgi = db.prepare(`
  INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
    has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at)
  VALUES (?, 0, ?, 0, ?, 0, ?, '', '', datetime('now'))
`);

const expandBilgi = db.prepare(`
  UPDATE bina_bilgi SET
    daire_sayisi = daire_sayisi + ?,
    toplam_bagımsız_bolum = toplam_bagımsız_bolum + ?,
    updated_at = datetime('now')
  WHERE bina_id = ?
`);

const nextBirim = db.prepare(`SELECT COALESCE(MAX(birim_no),0)+1 n FROM sayac WHERE bina_id=?`);
const hasBilgi = db.prepare(`SELECT 1 FROM bina_bilgi WHERE bina_id=?`);

const byBina = new Map();
for (const p of plan) {
  if (!byBina.has(p.bina_id)) byBina.set(p.bina_id, []);
  byBina.get(p.bina_id).push(p);
}

let inserted = 0;
db.exec("BEGIN IMMEDIATE");
try {
  for (const [binaId, items] of byBina) {
    const adaParsel = items[0].kaynak.includes("5. ETAP")
      ? "5. ETAP"
      : items[0].kaynak.includes("51 ADA")
        ? "51 ADA"
        : "ŞİRE";

    if (!hasBilgi.get(binaId)) {
      insertBilgi.run(binaId, items.length, items.length, adaParsel);
    } else {
      expandBilgi.run(items.length, items.length, binaId);
    }

    let birim = nextBirim.get(binaId).n;
    for (const p of items) {
      const key = normSayac(p.sayac_id);
      const res = insertSayac.run(
        binaId,
        birim,
        p.blok_no,
        p.kat,
        p.kapi_no,
        p.kullanilis_sekli,
        p.sayac_id,
        p.abone_no,
        key
      );
      if (res.changes > 0) {
        inserted++;
        birim++;
      }
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const after = db
  .prepare(`SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
  .get().c;

console.log(
  JSON.stringify(
    {
      inserted,
      onceki_toplam_sayac: before,
      yeni_toplam_sayac: after,
      fark: after - before,
    },
    null,
    2
  )
);
