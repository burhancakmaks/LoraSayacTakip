/**
 * 5. ETAP Excel vs veritabani sayac karsilastirmasi
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const ETAP5_PATH = "C:/Users/Surface/Downloads/5. ETAP SAYAÇ NUMARALARI (1) (2).xlsx";

const SHEET_5ETAP = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

const COLS_5ETAP = [
  { idx: 1, tip: "SICAK SU" },
  { idx: 2, tip: "KALORIMETRE" },
  { idx: 3, tip: "SOGUK SU" },
  { idx: 4, tip: "KAZAN SOGUK" },
  { idx: 5, tip: "KAZAN KALORI" },
];

function extractDigits(v) {
  return String(v ?? "").trim().replace(/^2025-/i, "").replace(/\D/g, "");
}

function classify(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "bos";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s)) return "eksik";
  const d = extractDigits(s);
  if (d.length >= 6 && d.length <= 12) return "gecerli";
  return "hatali";
}

function normKey(v) {
  return extractDigits(v);
}

if (!existsSync(ETAP5_PATH)) {
  console.error("Excel bulunamadi:", ETAP5_PATH);
  process.exit(1);
}

const wb = XLSX.read(readFileSync(ETAP5_PATH), { type: "buffer" });
const excelRecords = [];
const sheetStats = {};
const durumToplam = { bos: 0, gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 };
const uniqueSayac = new Set();

for (const sheet of wb.SheetNames) {
  const binaId = SHEET_5ETAP[sheet];
  if (!binaId) continue;

  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const stat = { hucre_dolu: 0, gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0, daire_sayisi: 0, bina_id: binaId };

  for (let r = 2; r < data.length; r++) {
    const daire = String(data[r][0] ?? "").trim();
    if (!daire || daire === "KAPICI") continue;
    stat.daire_sayisi++;

    for (const col of COLS_5ETAP) {
      const raw = data[r][col.idx];
      const durum = classify(raw);
      durumToplam[durum] = (durumToplam[durum] || 0) + 1;
      if (durum === "bos") continue;

      stat.hucre_dolu++;
      stat[durum] = (stat[durum] || 0) + 1;

      const key = normKey(raw);
      if (durum === "gecerli" && key) uniqueSayac.add(key);

      excelRecords.push({
        sheet,
        bina_id: binaId,
        daire,
        tip: col.tip,
        raw: String(raw).trim(),
        durum,
        sayac_key: key || null,
      });
    }
  }
  sheetStats[sheet] = stat;
}

const binaIds = [...new Set(Object.values(SHEET_5ETAP))];
const db = new DatabaseSync(DB_PATH);

const dbPerBina = db
  .prepare(
    `SELECT bina_id,
            COUNT(*) AS toplam_birim,
            SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS numarali,
            SUM(CASE WHEN COALESCE(sayac_durum,'gecerli') = 'gecerli' THEN 1 ELSE 0 END) AS gecerli_durum,
            SUM(CASE WHEN COALESCE(sayac_durum,'gecerli') = 'okunmadi' THEN 1 ELSE 0 END) AS okunmadi_durum,
            SUM(CASE WHEN COALESCE(sayac_durum,'gecerli') = 'eksik' THEN 1 ELSE 0 END) AS eksik_durum
     FROM sayac
     WHERE bina_id IN (${binaIds.map(() => "?").join(",")})
     GROUP BY bina_id`
  )
  .all(...binaIds);

const dbTotal = dbPerBina.reduce(
  (a, r) => ({
    toplam_birim: a.toplam_birim + r.toplam_birim,
    numarali: a.numarali + r.numarali,
    gecerli_durum: a.gecerli_durum + r.gecerli_durum,
    okunmadi_durum: a.okunmadi_durum + r.okunmadi_durum,
    eksik_durum: a.eksik_durum + r.eksik_durum,
  }),
  { toplam_birim: 0, numarali: 0, gecerli_durum: 0, okunmadi_durum: 0, eksik_durum: 0 }
);

const dbSayacKeys = new Set(
  db
    .prepare(
      `SELECT sayac_id FROM sayac
       WHERE bina_id IN (${binaIds.map(() => "?").join(",")})
         AND TRIM(COALESCE(sayac_id,'')) != ''`
    )
    .all(...binaIds)
    .map((r) => normKey(r.sayac_id))
    .filter(Boolean)
);

const excelGecerliKeys = new Set(
  excelRecords.filter((r) => r.durum === "gecerli" && r.sayac_key).map((r) => r.sayac_key)
);

const onlyExcel = [...excelGecerliKeys].filter((k) => !dbSayacKeys.has(k));
const onlyDb = [...dbSayacKeys].filter((k) => !excelGecerliKeys.has(k));

const excelHucreDolu = excelRecords.length;
const excelGecerli = excelRecords.filter((r) => r.durum === "gecerli").length;
const excelTumDolu = excelRecords.filter((r) => r.durum !== "bos").length;

// Blok bazli karsilastirma
const blokKiyas = Object.entries(sheetStats).map(([sheet, st]) => {
  const dbRow = dbPerBina.find((r) => r.bina_id === st.bina_id);
  return {
    blok: sheet,
    bina_id: st.bina_id,
    excel_gecerli: st.gecerli,
    excel_hucre_dolu: st.hucre_dolu,
    excel_okunmadi: st.okunmadi,
    excel_eksik: st.eksik,
    db_numarali: dbRow?.numarali ?? 0,
    db_toplam_birim: dbRow?.toplam_birim ?? 0,
    fark_gecerli: st.gecerli - (dbRow?.numarali ?? 0),
  };
});

const eksikOrnekler = excelRecords
  .filter((r) => r.durum === "gecerli" && r.sayac_key && !dbSayacKeys.has(r.sayac_key))
  .slice(0, 20);

const kolonBazli = {};
for (const r of excelRecords) {
  if (r.durum === "bos") continue;
  kolonBazli[r.tip] = kolonBazli[r.tip] || { gecerli: 0, dolu: 0 };
  kolonBazli[r.tip].dolu++;
  if (r.durum === "gecerli") kolonBazli[r.tip].gecerli++;
}

const dbTip = db
  .prepare(
    `SELECT UPPER(COALESCE(kullanilis_sekli,'')) AS tip, COUNT(*) AS c
     FROM sayac
     WHERE bina_id IN (${binaIds.map(() => "?").join(",")})
       AND TRIM(COALESCE(sayac_id,'')) != ''
     GROUP BY tip
     ORDER BY c DESC`
  )
  .all(...binaIds);

const dbSicakSoguk = db
  .prepare(
    `SELECT COUNT(*) AS c FROM sayac
     WHERE bina_id IN (${binaIds.map(() => "?").join(",")})
       AND TRIM(COALESCE(sayac_id,'')) != ''
       AND UPPER(kullanilis_sekli) IN ('SICAK SU','SOGUK SU')`
  )
  .get(...binaIds).c;

const excelSicakSoguk =
  (kolonBazli["SICAK SU"]?.gecerli || 0) + (kolonBazli["SOGUK SU"]?.gecerli || 0);

let daireSatir = 0;
for (const st of Object.values(sheetStats)) daireSatir += st.daire_sayisi;

console.log(
  JSON.stringify(
    {
      excel_dosyasi: ETAP5_PATH,
      excel_ozet: {
        sayfa_sayisi: Object.keys(sheetStats).length,
        daire_satirlari: daireSatir,
        hucre_dolu_toplam: excelHucreDolu,
        gecerli_numarali: excelGecerli,
        sicak_soguk_gecerli: excelSicakSoguk,
        benzersiz_gecerli_sayac: uniqueSayac.size,
        okunmadi: durumToplam.okunmadi,
        eksik: durumToplam.eksik,
        hatali: durumToplam.hatali,
        kolon_bazli: kolonBazli,
      },
      veritabani_5etap_binalari: {
        bina_sayisi: binaIds.length,
        ...dbTotal,
        sicak_soguk_numarali: dbSicakSoguk,
        tip_dagilimi: dbTip,
        benzersiz_sayac_no: dbSayacKeys.size,
      },
      karsilastirma: {
        excel_gecerli_vs_db_numarali: excelGecerli - dbTotal.numarali,
        excel_sicak_soguk_vs_db: excelSicakSoguk - dbSicakSoguk,
        excel_benzersiz_vs_db_benzersiz: uniqueSayac.size - dbSayacKeys.size,
        excelde_var_dbde_yok: onlyExcel.length,
        dbde_var_excelde_yok: onlyDb.length,
      },
      blok_bazli_farklar: blokKiyas
        .filter((b) => b.fark_gecerli !== 0)
        .sort((a, b) => b.fark_gecerli - a.fark_gecerli),
      eksik_ornekler: eksikOrnekler,
    },
    null,
    2
  )
);
