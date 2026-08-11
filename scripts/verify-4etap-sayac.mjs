/**
 * 4. ETAP Excel vs veritabani sayac karsilastirmasi
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const ETAP4_PATH = "C:/Users/Surface/Downloads/4.ETAP TS SAYAÇ NO (3).xlsx";

const VERIFIED_4ETAP = {
  "01|DB-01": 716, "01|DB-02": 717, "01|DB-03": 713, "01|DB-04": 718,
  "01|DB-05": 1939, "01|DB-06": 2646,
  "01|DC-01": 2642, "01|DC-02": 2642, "01|DC-03": 2614, "01|DC-04": 1763,
  "01|DC-05": 2629, "01|DC-06": 4690, "01|DC-07": 4690,
  "02|DB-07": 2676, "02|DB-08": 1907, "02|DB-09": 2755, "02|DB-10": 2776,
  "02|DB-11": 2689, "02|DB-12": 2673, "02|DC-08": 2669, "02|DC-09": 1127,
  "02|DC-10": 2764, "02|GB-01": 2628, "02|GB-02": 2000,
  "03|DB-13": 2675, "03|DB-14": 1764, "03|DB-15": 1764,
  "03|DC-11": 1940, "03|DC-12": 1940, "03|DC-13": 1654,
  "03|GB-03": 2601, "03|GB-04": 2601, "03|GB-05": 4674,
  "03|GB-06": 1942, "03|GB-07": 1942,
  "04|DB-16": 2767, "04|DB-17": 4692, "04|DB-18": 8, "04|DB-19": 300,
  "04|DB-20": 2777, "04|DB-21": 2602, "04|DC-14": 302, "04|DC-15": 1722,
  "04|DC-16": 1985, "04|DC-17": 2663, "04|DC-18": 2609, "04|DC-19": 1941,
  "05|DB-22": 1752, "05|DB-23": 716, "05|DC-20": 2001, "05|DC-21": 2610,
  "05|DC-22": 2631, "05|GB-08": 4669, "05|GB-09": 1103, "05|GB-10": 2002,
  "06|DB-24": 2772, "06|DB-25": 1998, "06|DB-26": 2685, "06|DB-27": 1999,
  "06|DB-28": 303, "06|DB-29": 2622, "06|DC-23": 1997, "06|DC-24": 4686,
  "06|DC-25": 1753, "06|DC-26": 2604, "06|DC-27": 4677,
  "06|GB-11": 1724, "06|GB-12": 2670, "06|GB-13": 4696, "06|GB-14": 623,
  "06|GB-15": 2606, "06|GB-16": 1714,
};

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

if (!existsSync(ETAP4_PATH)) {
  console.error("Excel bulunamadi:", ETAP4_PATH);
  process.exit(1);
}

const wb = XLSX.read(readFileSync(ETAP4_PATH), { type: "buffer" });
const excelRecords = [];
const sheetStats = {};
const durumToplam = { bos: 0, gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0 };
const uniqueSayac = new Set();
const unmappedBlok = [];

for (const sheetName of wb.SheetNames) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "", header: 1 });
  const adaM = sheetName.match(/ADA-(\d+)/i);
  const ada = adaM ? adaM[1].padStart(2, "0") : null;
  if (!ada) continue;

  const headerRow = data[1] || [];
  const colBlok = {};
  for (let c = 1; c < headerRow.length; c++) {
    const h = String(headerRow[c] ?? "").trim();
    if (h && /^(DB|DC|GB)-/.test(h)) colBlok[c] = h.replace(/\*$/, "");
  }

  const stat = { hucre_dolu: 0, gecerli: 0, okunmadi: 0, eksik: 0, hatali: 0, kapi_sayisi: 0 };

  for (let r = 3; r < data.length; r++) {
    const row = data[r];
    for (const [cStr, blok] of Object.entries(colBlok)) {
      const c = Number(cStr);
      const kapi = String(row[c] ?? "").trim();
      const raw = row[c + 1];
      const durum = classify(raw);
      durumToplam[durum] = (durumToplam[durum] || 0) + 1;
      if (durum === "bos") continue;

      const mapKey = `${ada}|${blok}`;
      const binaId = VERIFIED_4ETAP[mapKey] ?? null;
      if (!binaId) unmappedBlok.push({ sheet: sheetName, ada, blok, mapKey });

      stat.hucre_dolu++;
      stat[durum] = (stat[durum] || 0) + 1;
      if (kapi) stat.kapi_sayisi++;

      const key = extractDigits(raw);
      if (durum === "gecerli" && key) uniqueSayac.add(key);

      excelRecords.push({
        sheet: sheetName,
        ada,
        blok,
        mapKey,
        bina_id: binaId,
        kapi,
        raw: String(raw).trim(),
        durum,
        sayac_key: key || null,
      });
    }
  }
  sheetStats[sheetName] = stat;
}

const binaIds = [...new Set(Object.values(VERIFIED_4ETAP))];
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
    .map((r) => extractDigits(r.sayac_id))
    .filter(Boolean)
);

const excelGecerliKeys = new Set(
  excelRecords.filter((r) => r.durum === "gecerli" && r.sayac_key).map((r) => r.sayac_key)
);

const onlyExcel = [...excelGecerliKeys].filter((k) => !dbSayacKeys.has(k));
const onlyDb = [...dbSayacKeys].filter((k) => !excelGecerliKeys.has(k));

const excelGecerli = excelRecords.filter((r) => r.durum === "gecerli").length;
const excelEksik = excelRecords.filter((r) => r.durum === "eksik").length;
const excelOkunmadi = excelRecords.filter((r) => r.durum === "okunmadi").length;
const excelTumDolu = excelRecords.filter((r) => r.durum !== "bos").length;

// Blok bazli (ada|blok)
const blokMap = new Map();
for (const r of excelRecords) {
  if (!r.bina_id) continue;
  const k = r.mapKey;
  if (!blokMap.has(k)) blokMap.set(k, { mapKey: k, bina_id: r.bina_id, excel_gecerli: 0, excel_eksik: 0, excel_okunmadi: 0 });
  const b = blokMap.get(k);
  if (r.durum === "gecerli") b.excel_gecerli++;
  if (r.durum === "eksik") b.excel_eksik++;
  if (r.durum === "okunmadi") b.excel_okunmadi++;
}

const blokKiyas = [...blokMap.values()]
  .map((b) => {
    const dbRow = dbPerBina.find((r) => r.bina_id === b.bina_id);
    return {
      ...b,
      db_numarali: dbRow?.numarali ?? 0,
      db_eksik: dbRow?.eksik_durum ?? 0,
      db_okunmadi: dbRow?.okunmadi_durum ?? 0,
      fark_gecerli: b.excel_gecerli - (dbRow?.gecerli_durum ?? 0),
    };
  })
  .sort((a, b) => Math.abs(b.fark_gecerli) - Math.abs(a.fark_gecerli));

const eksikOrnekler = excelRecords
  .filter((r) => r.durum === "gecerli" && r.sayac_key && !dbSayacKeys.has(r.sayac_key))
  .slice(0, 25);

// Maski index 4 etap count
let maski4 = null;
try {
  const maski = JSON.parse(readFileSync(join(ROOT, "data/maski-arama-index.json"), "utf8"));
  maski4 = (maski.records || []).filter((r) => r.kaynak === "4. ETAP").length;
} catch {}

const dbAdaParsel = db
  .prepare(
    `SELECT bb.ada_parsel,
            COUNT(s.id) AS kayit,
            SUM(CASE WHEN TRIM(COALESCE(s.sayac_id,'')) != '' THEN 1 ELSE 0 END) AS numarali
     FROM bina_bilgi bb
     LEFT JOIN sayac s ON s.bina_id = bb.bina_id
     WHERE bb.ada_parsel LIKE '%4%ETAP%' OR bb.ada_parsel LIKE '%4. Etap%'
     GROUP BY bb.ada_parsel`
  )
  .all();

const dbSokak4 = db
  .prepare(
    `SELECT COUNT(*) AS numarali
     FROM sayac s
     JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
     WHERE bb.sokak LIKE '%4. ETAP%'
       AND TRIM(COALESCE(s.sayac_id,'')) != ''`
  )
  .get();

// Excel: sadece gecerli + eksik (tum dolu hucreler)
const excelGecerliVeEksik = excelGecerli + excelEksik;

console.log(
  JSON.stringify(
    {
      excel_dosyasi: ETAP4_PATH,
      excel_ozet: {
        sayfa_sayisi: Object.keys(sheetStats).length,
        hucre_dolu_toplam: excelTumDolu,
        gecerli_numarali: excelGecerli,
        eksik_isaretli: excelEksik,
        okunmadi: excelOkunmadi,
        benzersiz_gecerli_sayac: uniqueSayac.size,
        gecerli_artı_eksik_artı_okunmadi: excelTumDolu,
        gecerli_artı_eksik: excelGecerliVeEksik,
      },
      veritabani_4etap_binalari: {
        bina_sayisi: binaIds.length,
        ...dbTotal,
        benzersiz_sayac_no: dbSayacKeys.size,
      },
      veritabani_ada_parsel_4etap: dbAdaParsel,
      veritabani_sokak_4etap_numarali: dbSokak4?.numarali ?? 0,
      maski_indeks_4etap: maski4,
      karsilastirma: {
        excel_gecerli_vs_db_numarali: excelGecerli - dbTotal.numarali,
        excel_gecerli_vs_db_gecerli_durum: excelGecerli - dbTotal.gecerli_durum,
        excel_benzersiz_vs_db_benzersiz: uniqueSayac.size - dbSayacKeys.size,
        excelde_var_dbde_yok: onlyExcel.length,
        dbde_var_excelde_yok: onlyDb.length,
        excel_eksik_vs_db_eksik: excelEksik - dbTotal.eksik_durum,
      },
      blok_bazli_en_buyuk_farklar: blokKiyas.filter((b) => b.fark_gecerli !== 0).slice(0, 15),
      eksik_ornekler: eksikOrnekler,
      eslesmeyen_blok_sayisi: [...new Set(unmappedBlok.map((u) => u.mapKey))].length,
    },
    null,
    2
  )
);
