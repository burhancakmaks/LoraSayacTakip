import { DatabaseSync } from "node:sqlite";
import { copyFileSync } from "node:fs";

const db = new DatabaseSync("data/binalar.db");

function centroid(j) {
  const c = JSON.parse(j);
  let la = 0, ln = 0, n = 0;
  for (const p of c) for (const [a, b] of p) la += a, ln += b, n++;
  return n ? [la / n, ln / n] : null;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) * 111000;
}

const all = db.prepare(`SELECT id, value, coordinates, oda_id, kml_id FROM binalar`).all().map((b) => ({
  ...b,
  name: String(b.value ?? "").trim().toUpperCase(),
  c: centroid(b.coordinates),
  cfg: !!db.prepare(`SELECT 1 FROM bina_bilgi WHERE bina_id=?`).get(b.id),
  sc: db.prepare(`SELECT COUNT(*) c FROM sayac WHERE bina_id=? AND TRIM(COALESCE(sayac_id,''))!=''`).get(b.id).c,
}));

const toDelete = [];
for (const b of all) {
  if (!b.c || b.cfg || b.sc > 0) continue;
  if (!b.name) continue;

  const configuredSibling = all.find(
    (o) =>
      o.id !== b.id &&
      o.name === b.name &&
      o.c &&
      (o.cfg || o.sc > 0) &&
      dist(b.c, o.c) < 80
  );
  if (configuredSibling) {
    toDelete.push({
      id: b.id,
      value: b.value,
      kml_id: b.kml_id,
      oda_id: b.oda_id,
      keep: configuredSibling.id,
      keep_sc: configuredSibling.sc,
    });
  }
}

console.log("Silinecek bos kopya poligon:", toDelete.length);
toDelete.forEach((d) =>
  console.log(`  id=${d.id} "${d.value}" kml=${d.kml_id} -> tutulan id=${d.keep} (sc=${d.keep_sc})`)
);

if (!process.argv.includes("--apply")) {
  console.log("\nUygulamak icin: node scripts/clean-5etap-overlay-dupes.mjs --apply");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backup = `data/binalar.before-overlay-clean-${stamp}.db`;
copyFileSync("data/binalar.db", backup);
console.log("\nYedek:", backup);

const ids = toDelete.map((d) => d.id);
if (!ids.length) {
  console.log("Silinecek kayit yok.");
  process.exit(0);
}

const guard = db.prepare(`
  SELECT bina_id, COUNT(*) c FROM sayac
  WHERE bina_id IN (${ids.map(() => "?").join(",")}) AND TRIM(COALESCE(sayac_id,''))!=''
  GROUP BY bina_id
`).all(...ids);
if (guard.length) {
  console.error("Guvenlik: hedefte gercek sayac var!", guard);
  process.exit(1);
}

db.exec("BEGIN");
try {
  const delSayac = db.prepare(`DELETE FROM sayac WHERE bina_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  const delBilgi = db.prepare(`DELETE FROM bina_bilgi WHERE bina_id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  const delBina = db.prepare(`DELETE FROM binalar WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
  db.exec("COMMIT");
  console.log(`Silindi: binalar=${delBina.changes}, bina_bilgi=${delBilgi.changes}, sayac=${delSayac.changes}`);
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
