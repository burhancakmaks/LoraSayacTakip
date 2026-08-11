import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("c:/Users/Surface/Desktop/LoraLast/LoraSayacTakip/data/binalar.db", {
  readOnly: true,
});
const idx = JSON.parse(
  readFileSync("c:/Users/Surface/Desktop/LoraLast/LoraSayacTakip/data/diskapi-index.json", "utf8")
);

const byBina = new Map();
for (const r of idx.records) {
  if (!r.bina_id || !r.value) continue;
  if (!["on_edge", "near_edge"].includes(r.alignment)) continue;
  if (!byBina.has(r.bina_id)) byBina.set(r.bina_id, []);
  byBina.get(r.bina_id).push(r.value.trim());
}

let single = 0;
let multi = 0;
for (const vals of byBina.values()) {
  const uniq = [...new Set(vals)];
  if (uniq.length === 1) single++;
  else multi++;
}

const bilgi = db
  .prepare(`SELECT COUNT(*) AS c FROM bina_bilgi WHERE TRIM(COALESCE(dis_kapi_no,'')) != ''`)
  .get().c;
const totalBilgi = db.prepare(`SELECT COUNT(*) AS c FROM bina_bilgi`).get().c;

console.log(JSON.stringify({ bina_with_door: single + multi, single_door: single, multi_door: multi, bilgi_with_kapi: bilgi, total_bilgi: totalBilgi }, null, 2));
