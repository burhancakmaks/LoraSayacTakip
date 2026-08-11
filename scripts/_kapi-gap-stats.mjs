import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/binalar.db", { readOnly: true });
const index = JSON.parse(readFileSync("data/diskapi-index.json", "utf8"));
const byBina = JSON.parse(readFileSync("data/diskapi-by-bina.json", "utf8"));

const totalBinalar = db.prepare("SELECT COUNT(*) AS c FROM binalar").get().c;
const bilgiRows = db.prepare("SELECT COUNT(*) AS c FROM bina_bilgi").get().c;
const kapiDolu = db
  .prepare("SELECT COUNT(*) AS c FROM bina_bilgi WHERE TRIM(COALESCE(dis_kapi_no, '')) != ''")
  .get().c;

const binaIds = new Set(db.prepare("SELECT id FROM binalar").all().map((r) => r.id));
const indexedIds = new Set(Object.keys(byBina.binalar || {}).map(Number));

let noIndex = 0;
let noIndexSamples = [];
for (const id of binaIds) {
  if (!indexedIds.has(id)) {
    noIndex++;
    if (noIndexSamples.length < 8) {
      const b = db.prepare("SELECT id, value, layer FROM binalar WHERE id = ?").get(id);
      noIndexSamples.push(b);
    }
  }
}

const align = { on_edge: 0, near_edge: 0, inside_polygon: 0, far_from_building: 0, no_match: 0 };
for (const rec of index.records || []) {
  if (rec.bina_id) align[rec.alignment] = (align[rec.alignment] || 0) + 1;
  else align.no_match++;
}

const bilgiYokKapiYok = db
  .prepare(
    `SELECT COUNT(*) AS c FROM binalar b
     LEFT JOIN bina_bilgi bb ON bb.bina_id = b.id
     WHERE bb.id IS NULL OR TRIM(COALESCE(bb.dis_kapi_no, '')) = ''`
  )
  .get().c;

console.log(
  JSON.stringify(
    {
      total_binalar: totalBinalar,
      bina_bilgi_kayit: bilgiRows,
      dis_kapi_no_dolu: kapiDolu,
      dis_kapi_no_bos_veya_yok: bilgiYokKapiYok,
      diskapi_by_bina_eslesen: indexedIds.size,
      diskapi_eslesmeyen_bina: noIndex,
      no_index_samples: noIndexSamples,
      diskapi_alignment: align,
      total_diskapi_kayit: index.records?.length ?? 0,
    },
    null,
    2
  )
);
