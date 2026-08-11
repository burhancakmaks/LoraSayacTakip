/**
 * 4. ETAP binalarinin haritada gorunurluk analizi
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = new DatabaseSync(join(ROOT, "data/binalar.db"));

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

const binaIds = [...new Set(Object.values(VERIFIED_4ETAP))];

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

const blokList = Object.entries(VERIFIED_4ETAP).map(([key, id]) => {
  const b = rows.find((r) => r.id === id);
  const olcu = b ? measurePolygon(b.coordinates) : { alan_m2: 0, nokta: 0, gecerli: false };
  return {
    blok: key,
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
  toplam_blok_eslesmesi: blokList.length,
  benzersiz_bina: uniqueBinalar.length,
  haritada_gorunur_poligon: uniqueBinalar.filter((r) => measurePolygon(r.coordinates).gecerli).length,
  nokta_gibi_kucuk: uniqueBinalar.filter((r) => {
    const m = measurePolygon(r.coordinates);
    return m.alan_m2 > 0 && m.alan_m2 < 10;
  }).length,
  koordinat_yok_veya_sifir: uniqueBinalar.filter((r) => measurePolygon(r.coordinates).alan_m2 === 0).length,
  yapilandirilmis_yesil: uniqueBinalar.filter((r) => r.yapilandirilmis).length,
  sayacli_bina: uniqueBinalar.filter((r) => r.numarali > 0).length,
  toplam_numarali_sayac: uniqueBinalar.reduce((a, r) => a + r.numarali, 0),
};

const sorunlular = blokList.filter((b) => !b.haritada_poligon || b.nokta_gibi);
const adaOzet = {};
for (const b of blokList) {
  const ada = b.blok.split("|")[0];
  if (!adaOzet[ada]) adaOzet[ada] = { blok: 0, gorunur: 0, nokta: 0, sayacsiz: 0, numarali_toplam: 0 };
  adaOzet[ada].blok++;
  if (b.haritada_poligon) adaOzet[ada].gorunur++;
  if (b.nokta_gibi) adaOzet[ada].nokta++;
  if (b.numarali === 0) adaOzet[ada].sayacsiz++;
  adaOzet[ada].numarali_toplam += b.numarali;
}

console.log(
  JSON.stringify(
    {
      ozet,
      ada_bazli: adaOzet,
      haritada_gorunmeyen_ornekler: sorunlular.slice(0, 20),
      not: "Haritada gorunur = poligon alani >= 10 m2. Kucuk/nokta poligonlar aramada popup cikar ama bina secilemez gibi gorunur.",
    },
    null,
    2
  )
);
