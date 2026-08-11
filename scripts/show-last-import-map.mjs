/**
 * Son Excel aktarımının haritadaki bina konumlarını listeler.
 * node scripts/show-last-import-map.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = process.cwd();
const history = JSON.parse(readFileSync(join(ROOT, "data/import-history.json"), "utf8"));

if (!history.last) {
  console.error("Son aktarım kaydı yok.");
  process.exit(1);
}

const { filename, timestamp, backupPath, stats, rowCount } = history.last;
console.log("Son aktarım:", filename);
console.log("Tarih:", new Date(timestamp).toLocaleString("tr-TR"));
console.log("Satır:", rowCount, stats);

if (!existsSync(backupPath)) {
  console.error("Yedek DB bulunamadı:", backupPath);
  process.exit(1);
}

const before = new DatabaseSync(backupPath, { readOnly: true });
const after = new DatabaseSync(join(ROOT, "data/binalar.db"), { readOnly: true });

const beforeKeys = new Set(
  before
    .prepare(
      `SELECT bina_id || '|' || birim_no || '|' || COALESCE(sayac_id,'') AS k FROM sayac`
    )
    .all()
    .map((r) => r.k)
);

const newRows = after
  .prepare(
    `SELECT s.bina_id, s.birim_no, s.blok_no, s.kapi_no, s.kat, s.kullanilis_sekli, s.sayac_id,
            b.value AS bina_adi, b.layer, b.coordinates, b.oda_id
     FROM sayac s
     JOIN binalar b ON b.id = s.bina_id
     ORDER BY b.value, s.blok_no, s.kapi_no`
  )
  .all()
  .filter((r) => !beforeKeys.has(`${r.bina_id}|${r.birim_no}|${r.sayac_id ?? ""}`));

function centerFromCoords(json) {
  const coords = JSON.parse(json);
  let lat = 0;
  let lng = 0;
  let n = 0;
  for (const ring of coords) {
    for (const [la, ln] of ring) {
      lat += la;
      lng += ln;
      n++;
    }
  }
  return n ? { lat: lat / n, lng: lng / n } : null;
}

const byBina = new Map();
for (const r of newRows) {
  if (!byBina.has(r.bina_id)) {
    const c = centerFromCoords(r.coordinates);
    byBina.set(r.bina_id, {
      bina_id: r.bina_id,
      bina_adi: r.bina_adi,
      layer: r.layer,
      oda_id: r.oda_id,
      lat: c?.lat ?? null,
      lng: c?.lng ?? null,
      sayac_sayisi: 0,
      ornek_sayaclar: [],
    });
  }
  const g = byBina.get(r.bina_id);
  g.sayac_sayisi++;
  if (g.ornek_sayaclar.length < 5) {
    g.ornek_sayaclar.push({
      sayac_id: r.sayac_id,
      blok: r.blok_no,
      kapi: r.kapi_no,
      kat: r.kat,
    });
  }
}

const binalar = [...byBina.values()].sort((a, b) => b.sayac_sayisi - a.sayac_sayisi || a.bina_adi.localeCompare(b.bina_adi, "tr"));

const report = {
  import: { filename, timestamp, rowCount, stats },
  yeni_sayac_kaydi: newRows.length,
  bina_sayisi: binalar.length,
  binalar: binalar.map((b) => ({
    ...b,
    harita_link: `http://localhost:3000/map?bina_id=${b.bina_id}`,
    google_maps: b.lat != null ? `https://www.google.com/maps?q=${b.lat},${b.lng}&z=19` : null,
  })),
};

const outPath = join(ROOT, "data/last-import-map-report.json");
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

console.log("\n=== HARİTA ÖZETİ ===");
console.log("Yeni sayaç kaydı:", report.yeni_sayac_kaydi);
console.log("Etkilenen bina:", report.bina_sayisi);
console.log("\nBinalar (sayaç adedine göre):");
for (const b of binalar) {
  console.log(
    `  [${b.bina_id}] ${b.bina_adi} — ${b.sayac_sayisi} sayaç` +
      (b.lat != null ? ` @ ${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}` : "")
  );
  console.log(`       Harita: /map?bina_id=${b.bina_id}`);
}
console.log("\nRapor:", outPath);
