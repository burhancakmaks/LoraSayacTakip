/**
 * diskapi-index.json → bina bazlı özet (harita/arama için).
 * Veritabanına yazmaz.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const INDEX_PATH = join(ROOT, "data/diskapi-index.json");
const OUT_PATH = join(ROOT, "data/diskapi-by-bina.json");

const GOOD_ALIGN = new Set(["on_edge", "near_edge"]);
const MAX_EDGE_M = 25;

function doorRank(d) {
  const align = d.alignment === "on_edge" ? 0 : d.alignment === "near_edge" ? 1 : 9;
  return [align, d.edge_distance_m ?? 999, d.kapi_no];
}

function main() {
  if (!existsSync(INDEX_PATH)) {
    console.error("Önce diskapi-index oluşturun: npm run build:diskapi-index");
    process.exit(1);
  }

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  const grouped = new Map();

  for (const rec of index.records || []) {
    if (!rec.bina_id || !rec.value) continue;
    if (!GOOD_ALIGN.has(rec.alignment)) continue;
    if (rec.edge_distance_m != null && rec.edge_distance_m > MAX_EDGE_M) continue;

    const door = {
      diskapi_id: rec.diskapi_id,
      kapi_no: String(rec.value).trim(),
      lat: rec.lat,
      lng: rec.lng,
      alignment: rec.alignment,
      edge_distance_m: rec.edge_distance_m,
    };

    if (!grouped.has(rec.bina_id)) grouped.set(rec.bina_id, []);
    grouped.get(rec.bina_id).push(door);
  }

  const binalar = {};
  for (const [binaId, doors] of grouped) {
    const uniq = new Map();
    for (const d of doors) {
      const key = d.kapi_no.toLocaleUpperCase("tr-TR");
      if (!uniq.has(key) || (d.edge_distance_m ?? 999) < (uniq.get(key).edge_distance_m ?? 999)) {
        uniq.set(key, d);
      }
    }
    const list = [...uniq.values()].sort((a, b) => {
      const ra = doorRank(a);
      const rb = doorRank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2], "tr");
    });
    if (!list.length) continue;

    binalar[String(binaId)] = {
      primary_kapi: list[0].kapi_no,
      doors: list,
    };
  }

  const out = {
    built_at: new Date().toISOString(),
    source: INDEX_PATH.replace(/\\/g, "/"),
    total_binalar: Object.keys(binalar).length,
    binalar,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log("Yazıldı:", OUT_PATH);
  console.log("Bina sayısı:", out.total_binalar);
}

main();
