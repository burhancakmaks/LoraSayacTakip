import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync } from "node:fs";

const DB = "data/binalar.db";

// Import kaynakli, gercek sayac verisi olmayan bos yesil kopyalar
const TARGETS = [1910, 1946, 1947, 1948, 1949, 1950, 1954, 1955];

// 1) Yedek
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `data/binalar.backup-clean-green-${stamp}.db`;
copyFileSync(DB, backup);
console.log("Yedek alindi:", backup);

const db = new DatabaseSync(DB);

// 2) Guvenlik kontrolu: hicbir hedefte gercek sayac (dolu sayac_id) OLMAMALI
const guard = db.prepare(`
  SELECT bina_id, COUNT(*) AS c
  FROM sayac
  WHERE bina_id IN (${TARGETS.join(",")}) AND TRIM(COALESCE(sayac_id,''))!=''
  GROUP BY bina_id
`).all();
if (guard.length > 0) {
  console.error("DURDURULDU! Bu hedeflerde gercek sayac var:", guard);
  process.exit(1);
}
console.log("Guvenlik kontrolu OK: hicbir hedefte gercek sayac yok.");

// 3) Onceki durum
const before = {
  binaBilgi: db.prepare(`SELECT COUNT(*) c FROM bina_bilgi`).get().c,
  hedefBilgi: db.prepare(`SELECT COUNT(*) c FROM bina_bilgi WHERE bina_id IN (${TARGETS.join(",")})`).get().c,
  hedefBosSatir: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE bina_id IN (${TARGETS.join(",")})`).get().c,
  toplamGercekSayac: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''`).get().c,
};
console.log("ONCE:", before);

// 4) Sil: once bos placeholder sayac satirlari (bu hedeflerde hepsi bos), sonra bina_bilgi
db.exec("BEGIN");
try {
  const delSayac = db.prepare(`DELETE FROM sayac WHERE bina_id IN (${TARGETS.join(",")})`).run();
  const delBilgi = db.prepare(`DELETE FROM bina_bilgi WHERE bina_id IN (${TARGETS.join(",")})`).run();
  db.exec("COMMIT");
  console.log(`Silinen bos sayac satiri: ${delSayac.changes}, silinen bina_bilgi: ${delBilgi.changes}`);
} catch (e) {
  db.exec("ROLLBACK");
  console.error("HATA, geri alindi:", e);
  process.exit(1);
}

// 5) Sonraki durum
const after = {
  binaBilgi: db.prepare(`SELECT COUNT(*) c FROM bina_bilgi`).get().c,
  hedefBilgi: db.prepare(`SELECT COUNT(*) c FROM bina_bilgi WHERE bina_id IN (${TARGETS.join(",")})`).get().c,
  hedefSatir: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE bina_id IN (${TARGETS.join(",")})`).get().c,
  toplamGercekSayac: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE TRIM(COALESCE(sayac_id,''))!=''`).get().c,
};
console.log("SONRA:", after);

if (after.toplamGercekSayac !== before.toplamGercekSayac) {
  console.error("UYARI! Gercek sayac sayisi degisti! Yedekten geri donun:", backup);
} else {
  console.log("DOGRULAMA OK: gercek sayac sayisi ayni kaldi (", after.toplamGercekSayac, "). Hicbir gercek veri kaybolmadi.");
}
