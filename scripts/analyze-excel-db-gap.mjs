/**
 * Excel indeksi ile veritabanı sayaç farkını analiz eder (salt okunur).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const db = new DatabaseSync(path.join(root, "data", "binalar.db"));
const maski = JSON.parse(readFileSync(path.join(root, "data", "maski-arama-index.json"), "utf8"));

function normSayac(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

const maskiRecords = maski.records || [];
const maskiSayacSet = new Set(maskiRecords.map((r) => normSayac(r.sayac_no)).filter(Boolean));

const dbRows = db
  .prepare(
    `SELECT sayac_id, bina_id, blok_no, kapi_no, sayac_durum
     FROM sayac
     WHERE TRIM(COALESCE(sayac_id,'')) != ''`
  )
  .all();

const dbSayacSet = new Set(dbRows.map((r) => normSayac(r.sayac_id)).filter(Boolean));

const onlyMaski = maskiRecords
  .filter((r) => {
    const k = normSayac(r.sayac_no);
    return k && !dbSayacSet.has(k);
  })
  .map((r) => ({
    kaynak: r.kaynak,
    sayac: r.sayac_no,
    abone: r.abone_no,
    blok: r.blok,
    kapi: r.kapi_no,
    adres: String(r.adres || "").slice(0, 80),
  }));

const onlyDb = [...dbSayacSet].filter((s) => !maskiSayacSet.has(s));

const dupes = db
  .prepare(
    `SELECT REPLACE(REPLACE(REPLACE(UPPER(sayac_id), '2025-', ''), ' ', ''), '-', '') AS key, COUNT(*) c
     FROM sayac
     WHERE TRIM(COALESCE(sayac_id,'')) != ''
     GROUP BY key
     HAVING c > 1
     ORDER BY c DESC`
  )
  .all();

const durum = db
  .prepare(
    `SELECT COALESCE(sayac_durum,'gecerli') d, COUNT(*) c
     FROM sayac
     GROUP BY d
     ORDER BY c DESC`
  )
  .all();

const byKaynakEksik = {};
for (const r of onlyMaski) {
  byKaynakEksik[r.kaynak] = (byKaynakEksik[r.kaynak] || 0) + 1;
}

const byKaynakExcel = maski.stats || {};

// Eksik sayaçların DB'de hiç olup olmadığını kontrol et
const missingReasons = { hic_yok: 0, baska_birimde_var: 0 };
const missingDetail = onlyMaski.slice(0, 30).map((r) => {
  const key = normSayac(r.sayac);
  const inDb = db
    .prepare(
      `SELECT bina_id, sayac_id, blok_no, kapi_no
       FROM sayac
       WHERE REPLACE(REPLACE(REPLACE(UPPER(sayac_id), '2025-', ''), ' ', ''), '-', '') = ?`
    )
    .all(key);
  if (inDb.length === 0) missingReasons.hic_yok++;
  else missingReasons.baska_birimde_var++;
  return { ...r, db_eslesme: inDb };
});

console.log(
  JSON.stringify(
    {
      ozet: {
        excel_index_toplam_kayit: maski.total ?? maskiRecords.length,
        excel_benzersiz_sayac: maskiSayacSet.size,
        db_numarali_satir: dbRows.length,
        db_benzersiz_sayac: dbSayacSet.size,
        excelde_var_dbde_yok: onlyMaski.length,
        dbde_var_excelde_yok: onlyDb.length,
        db_tekrarlayan_sayac_gruplari: dupes.length,
        db_tekrar_fazla_satir: dupes.reduce((a, d) => a + (d.c - 1), 0),
        fark_aciklamasi:
          "Excel'deki benzersiz sayaç ile DB benzersiz sayaç farkı; DB'de aynı numara birden fazla satırda olabilir.",
      },
      excel_kaynak_dagilimi: byKaynakExcel,
      eksik_kaynak_dagilimi: byKaynakEksik,
      eksik_neden_ozet: missingReasons,
      db_durum_dagilimi: durum,
      eksik_ornekler: missingDetail,
      dbde_olup_excelde_olmayan_ornek: onlyDb.slice(0, 15),
      tekrar_ornekleri: dupes.slice(0, 10),
    },
    null,
    2
  )
);
