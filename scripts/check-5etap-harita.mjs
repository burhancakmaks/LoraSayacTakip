/**
 * 5. ETAP binalarinin haritada gorunurluk analizi
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(ROOT, "data/binalar.db"));

const SHEET_5ETAP = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

function measurePolygon(coordsJson) {
  try {
    const ring = JSON.parse(coordsJson)[0] || [];
    if (!ring.length) return { alan_m2: 0, nokta: 0, gecerli: false };
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
    const alan = (maxLat - minLat) * 111000 * (maxLng - minLng) * 85000;
    return { alan_m2: +alan.toFixed(2), nokta: ring.length, gecerli: alan >= 10 };
  } catch {
    return { alan_m2: 0, nokta: 0, gecerli: false };
  }
}

const binaIds = [...new Set(Object.values(SHEET_5ETAP))];

const rows = db
  .prepare(
    `SELECT b.id, b.value, b.coordinates,
            EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS yapilandirilmis,
            (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id) AS sayac_kayit,
            (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id,'')) != '') AS numarali,
            bb.sokak, bb.ada_parsel
     FROM binalar b
     LEFT JOIN bina_bilgi bb ON bb.bina_id = b.id
     WHERE b.id IN (${binaIds.map(() => "?").join(",")})`
  )
  .all(...binaIds);

const blokList = Object.entries(SHEET_5ETAP).map(([blok, id]) => {
  const b = rows.find((r) => r.id === id);
  const olcu = b ? measurePolygon(b.coordinates) : { alan_m2: 0, nokta: 0, gecerli: false };
  return {
    blok,
    bina_id: id,
    bina_adi: b?.value ?? "?",
    haritada_poligon: olcu.gecerli,
    alan_m2: olcu.alan_m2,
    nokta_gibi: olcu.alan_m2 > 0 && olcu.alan_m2 < 10,
    yapilandirilmis: !!b?.yapilandirilmis,
    sayac_kayit: b?.sayac_kayit ?? 0,
    numarali: b?.numarali ?? 0,
    sokak: b?.sokak ?? "",
  };
});

const uniqueBinalar = [...new Map(rows.map((r) => [r.id, r])).values()];

const ozet = {
  toplam_blok: blokList.length,
  benzersiz_bina: uniqueBinalar.length,
  haritada_gorunur_poligon: uniqueBinalar.filter((r) => measurePolygon(r.coordinates).gecerli).length,
  nokta_gibi_kucuk: uniqueBinalar.filter((r) => {
    const m = measurePolygon(r.coordinates);
    return m.alan_m2 > 0 && m.alan_m2 < 10;
  }).length,
  koordinat_yok: uniqueBinalar.filter((r) => measurePolygon(r.coordinates).alan_m2 === 0).length,
  yapilandirilmis_yesil: uniqueBinalar.filter((r) => r.yapilandirilmis).length,
  sayacli_bina: uniqueBinalar.filter((r) => r.numarali > 0).length,
  toplam_numarali_sayac: uniqueBinalar.reduce((a, r) => a + r.numarali, 0),
};

const sorunlular = blokList.filter((b) => !b.haritada_poligon || b.nokta_gibi);

const tipOzet = { GB: { b: 0, g: 0, n: 0 }, DB: { b: 0, g: 0, n: 0 }, DC: { b: 0, g: 0, n: 0 } };
for (const b of blokList) {
  const tip = b.blok.startsWith("GB") ? "GB" : b.blok.startsWith("DB") ? "DB" : "DC";
  tipOzet[tip].b++;
  if (b.haritada_poligon) tipOzet[tip].g++;
  if (b.nokta_gibi) tipOzet[tip].n++;
}

console.log(
  JSON.stringify(
    {
      ozet,
      tip_bazli: tipOzet,
      sorunlu_bloklar: sorunlular,
      not: "Poligon alani < 10 m2 ise haritada nokta gibi gorunur (E04/D11 duzeltildi).",
    },
    null,
    2
  )
);
