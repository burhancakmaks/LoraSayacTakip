import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const name = process.argv[2] || "53 ADA B BLOK";
const db = new DatabaseSync("data/binalar.db", { readOnly: true });
const byBina = JSON.parse(readFileSync("data/diskapi-by-bina.json", "utf8"));
const index = JSON.parse(readFileSync("data/diskapi-index.json", "utf8"));

const binalar = db
  .prepare(
    `SELECT b.id, b.value, b.id_2, b.layer, bb.dis_kapi_no, bb.sokak
     FROM binalar b
     LEFT JOIN bina_bilgi bb ON bb.bina_id = b.id
     WHERE b.value = ?`
  )
  .all(name);

console.log("DB binalar:", JSON.stringify(binalar, null, 2));

for (const b of binalar) {
  const entry = byBina.binalar[String(b.id)];
  console.log(`\nBina ${b.id} diskapi-by-bina:`, entry || "YOK");
  const doors = (index.records || []).filter((r) => r.bina_id === b.id);
  console.log(`KML kapı sayısı: ${doors.length}`);
  if (doors.length) {
    console.log(
      "Kapılar:",
      doors.map((d) => ({
        kapi: d.value,
        align: d.alignment,
        edge_m: d.edge_distance_m,
      }))
    );
  }
}
