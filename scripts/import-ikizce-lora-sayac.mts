/**
 * İkizce LoRa cihazlarını sayac tablosuna yazar.
 * sayac_id = DevEUI (CSV). Blok, daire, kat CSV'den gelir. Sokak uydurulmaz.
 *
 *   node --experimental-strip-types scripts/import-ikizce-lora-sayac.mts
 *   node --experimental-strip-types scripts/import-ikizce-lora-sayac.mts --apply
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { clearIkizceCache, resolveIkizceBlok } from "../src/lib/sayac-search.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const APPLY = process.argv.includes("--apply");

function katLabel(raw: string) {
  const t = String(raw || "").trim();
  if (!t || t === "0") return "ZEMİN KAT";
  if (/^\d+$/.test(t)) return `${t}. KAT`;
  return t;
}

function kapiFromDaire(raw: string) {
  const t = String(raw || "").trim();
  const m = t.match(/daire\s*(\d+)/i) || t.match(/^(\d+)$/);
  return m ? m[1] : t;
}

const db = new DatabaseSync(DB_PATH);
const devices = db
  .prepare(
    `SELECT id, dev_eui, bolge, blok, daire, kat, bina_id, sayac_id, durum
     FROM lora_devices
     WHERE TRIM(COALESCE(dev_eui,'')) != ''
       AND (
         REPLACE(REPLACE(UPPER(COALESCE(bolge,'')), 'İ','I'), 'İ','I') LIKE '%IKIZCE%'
       )`
  )
  .all() as Array<{
  id: number;
  dev_eui: string;
  bolge: string;
  blok: string;
  daire: string;
  kat: string;
  bina_id: number | null;
  sayac_id: string | null;
  durum: string;
}>;

const existingSayac = new Set(
  db
    .prepare(`SELECT TRIM(sayac_id) id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
    .all()
    .map((r: { id: string }) => String(r.id).toLowerCase())
);

const planned = [];
const skippedNoBina = [];
const skippedExists = [];

for (const d of devices) {
  if (
    existingSayac.has(String(d.dev_eui).toLowerCase()) ||
    (d.sayac_id && existingSayac.has(String(d.sayac_id).toLowerCase()))
  ) {
    skippedExists.push(d.dev_eui);
    continue;
  }
  const bina = resolveIkizceBlok(db, d.blok || "");
  if (!bina) {
    skippedNoBina.push({ dev_eui: d.dev_eui, blok: d.blok });
    continue;
  }
  planned.push({
    lora_id: d.id,
    bina_id: bina.id,
    bina_value: bina.value,
    sayac_id: d.dev_eui,
    blok_no: String(d.blok || "").trim(),
    kat: katLabel(d.kat),
    kapi_no: kapiFromDaire(d.daire),
    durum: d.durum === "active" || d.durum === "registered" ? "gecerli" : "gecerli",
  });
}

const byBina = new Map();
for (const row of planned) {
  byBina.set(row.bina_id, (byBina.get(row.bina_id) || 0) + 1);
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  devices: devices.length,
  planned: planned.length,
  skipped_exists: skippedExists.length,
  skipped_no_bina: skippedNoBina.length,
  buildings: byBina.size,
  sample: planned.filter((p) => p.sayac_id.includes("40010392")).concat(planned.slice(0, 5)),
  missing_bloks: skippedNoBina.slice(0, 12),
  backup: "",
  inserted: 0,
};

if (!APPLY) {
  console.log(JSON.stringify(report, null, 2));
  console.log("\nUygulamak için: node --experimental-strip-types scripts/import-ikizce-lora-sayac.mts --apply");
  db.close();
  process.exit(0);
}

const backupDir = join(ROOT, "data/backups");
mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = join(backupDir, `binalar.before-ikizce-lora-sayac-${stamp}.db`);
copyFileSync(DB_PATH, backup);

const maxBirim = new Map(
  db.prepare("SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id").all().map((r: { bina_id: number; m: number }) => [r.bina_id, r.m || 0])
);
const nextBirim = (binaId: number) => {
  const n = (maxBirim.get(binaId) || 0) + 1;
  maxBirim.set(binaId, n);
  return n;
};

const insertSayac = db.prepare(`
  INSERT INTO sayac (
    bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
    sayac_markasi, sayac_id, sicil_no, abone_no, sayac_durum, kaynak, updated_at
  ) VALUES (?, ?, ?, ?, ?, 'YOK', 'DAİRE', '', ?, '', '', ?, 'ikizce-lora', datetime('now'))
`);
const updateLora = db.prepare(`UPDATE lora_devices SET bina_id = ?, sayac_id = ?, updated_at = datetime('now') WHERE id = ?`);
const upsertBilgi = db.prepare(`
  INSERT INTO bina_bilgi (
    bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
    has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
  ) VALUES (?, ?, ?, 0, ?, ?, '', '', '', datetime('now'))
  ON CONFLICT(bina_id) DO UPDATE SET
    kat_sayisi = CASE WHEN kat_sayisi < excluded.kat_sayisi THEN excluded.kat_sayisi ELSE kat_sayisi END,
    daire_sayisi = CASE WHEN daire_sayisi < excluded.daire_sayisi THEN excluded.daire_sayisi ELSE daire_sayisi END,
    toplam_bagımsız_bolum = CASE WHEN toplam_bagımsız_bolum < excluded.toplam_bagımsız_bolum THEN excluded.toplam_bagımsız_bolum ELSE toplam_bagımsız_bolum END,
    has_zemin = CASE WHEN excluded.has_zemin = 1 THEN 1 ELSE has_zemin END,
    updated_at = datetime('now')
`);

let inserted = 0;
db.exec("BEGIN IMMEDIATE");
try {
  for (const row of planned) {
    insertSayac.run(row.bina_id, nextBirim(row.bina_id), row.blok_no, row.kat, row.kapi_no, row.sayac_id, row.durum);
    updateLora.run(row.bina_id, row.sayac_id, row.lora_id);
    inserted++;
  }
  if (byBina.size) {
    const bilgiRows = db
      .prepare(
        `SELECT bina_id,
                SUM(CASE WHEN TRIM(COALESCE(sayac_id,'')) != '' THEN 1 ELSE 0 END) AS sayac_count,
                MAX(birim_no) AS max_birim
         FROM sayac
         WHERE bina_id IN (${[...byBina.keys()].map(() => "?").join(",")})
         GROUP BY bina_id`
      )
      .all(...byBina.keys()) as Array<{ bina_id: number; sayac_count: number; max_birim: number }>;

    for (const row of bilgiRows) {
      const meters = db
        .prepare(`SELECT kat FROM sayac WHERE bina_id = ? AND TRIM(COALESCE(sayac_id,'')) != ''`)
        .all(row.bina_id) as Array<{ kat: string }>;
      let floor = 0;
      let zemin = false;
      for (const m of meters) {
        const u = String(m.kat || "").toLocaleUpperCase("tr-TR");
        if (u.includes("ZEMİN") || u.includes("ZEMIN") || u.trim() === "0") zemin = true;
        const match = u.match(/(\d{1,2})\s*\.?\s*KAT/);
        if (match) floor = Math.max(floor, Number(match[1]) || 0);
      }
      const needed = Math.max(Number(row.sayac_count) || 0, Number(row.max_birim) || 0);
      upsertBilgi.run(row.bina_id, floor, needed, needed, zemin || floor === 0 ? 1 : 0);
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK:", e);
  db.close();
  process.exit(1);
}

clearIkizceCache();
report.backup = backup.replace(/\\/g, "/");
report.inserted = inserted;
const outDir = join(ROOT, "data/import-reports");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "latest-ikizce-lora-sayac-apply.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
db.close();
