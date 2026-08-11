/**
 * Sayaçlı binalar için bina_bilgi doldurma / zenginleştirme.
 * - Mevcut dolu alanları korur (ada_parsel, sokak, dis_kapi_no, kat>1)
 * - sayac sayısından daire / toplam bağımsız bölüm
 * - kat bilgisini sayac.kat / kapi_no'dan çıkarır
 * - diskapi primary kapı → dis_kapi_no
 * - bina adından ada/parsel tahmini
 *
 *   node scripts/fill-bina-bilgi.mjs
 *   node scripts/fill-bina-bilgi.mjs --dry-run
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");
const DISKAPI_PATH = join(DATA_DIR, "diskapi-by-bina.json");
const dryRun = process.argv.includes("--dry-run");

function inferAdaFromValue(value) {
  const s = String(value ?? "").toLocaleUpperCase("tr-TR");
  if (/4\.?\s*ETAP/.test(s)) return "4. ETAP";
  if (/5\.?\s*ETAP/.test(s)) return "5. ETAP";
  if (/Ş[İI]RE|SIRE/.test(s)) return "ŞİRE";
  const m =
    s.match(/(\d{1,4})\s*ADA/) ||
    s.match(/ADA[-\s]*(\d{1,4})/) ||
    s.match(/(\d{2,4})[-\s](\d{1,4})\s*ADA/) ||
    s.match(/\b(\d{2,3}-\d{1,3})\b/);
  if (!m) return "";
  if (m[2] && m[0].includes("-")) return `${m[1]}-${m[2]}`.replace(/ADA.*/i, "").trim();
  // 41-134 style already in m[1]
  if (/^\d+-\d+$/.test(m[1])) return m[1];
  return m[1];
}

function parseKatLabel(kat) {
  const k = String(kat ?? "").toLocaleUpperCase("tr-TR").trim();
  if (!k) return null;
  if (k.includes("ZEMİN") || k.includes("ZEMIN")) return { zemin: true, n: 0 };
  if (k.includes("BODRUM")) return { zemin: false, n: 0 };
  if (k.includes("ORTAK")) return null;
  const m = k.match(/(\d+)\s*\.?\s*KAT/);
  if (m) return { zemin: false, n: parseInt(m[1], 10) };
  return null;
}

function inferKatFromKapi(kapi) {
  const raw = String(kapi ?? "").trim().toLocaleUpperCase("tr-TR");
  if (!raw) return null;
  if (/ZEM[İI]N|^Z\d/.test(raw)) return { zemin: true, n: 0 };
  const m = raw.match(/^(\d{1,3})/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num >= 100) return { zemin: false, n: Math.floor(num / 100) }; // 201 → 2. kat
  if (num >= 1 && num <= 50) return null; // daire no, kat bilinmiyor
  return null;
}

function estimateKat(daireCount, maxKatFromData, hasZemin) {
  if (maxKatFromData > 0) return maxKatFromData;
  if (daireCount <= 2) return hasZemin ? 0 : 1;
  if (daireCount <= 6) return 1;
  if (daireCount <= 12) return 2;
  if (daireCount <= 24) return 3;
  if (daireCount <= 40) return 4;
  return Math.min(8, Math.max(4, Math.ceil(daireCount / 8)));
}

const db = new DatabaseSync(DB_PATH);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
if (!dryRun) {
  copyFileSync(DB_PATH, join(DATA_DIR, `binalar.before-fill-bilgi-${stamp}.db`));
}

db.exec(`
  CREATE TABLE IF NOT EXISTS bina_bilgi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bina_id INTEGER NOT NULL UNIQUE,
    kat_sayisi INTEGER NOT NULL DEFAULT 0,
    daire_sayisi INTEGER NOT NULL DEFAULT 0,
    ortak_alan_sayisi INTEGER NOT NULL DEFAULT 0,
    toplam_bagımsız_bolum INTEGER NOT NULL DEFAULT 0,
    has_zemin INTEGER NOT NULL DEFAULT 0,
    ada_parsel TEXT DEFAULT '',
    sokak TEXT DEFAULT '',
    dis_kapi_no TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

let diskapi = {};
if (existsSync(DISKAPI_PATH)) {
  diskapi = JSON.parse(readFileSync(DISKAPI_PATH, "utf8")).binalar || {};
}

const sayacliBinalar = db
  .prepare(
    `SELECT s.bina_id,
            b.value,
            COUNT(*) AS sayac_kayit,
            SUM(CASE WHEN TRIM(COALESCE(s.sayac_id,'')) != '' THEN 1 ELSE 0 END) AS sayac_count,
            SUM(CASE WHEN UPPER(TRIM(COALESCE(s.kullanilis_sekli,''))) LIKE '%ORTAK%' THEN 1 ELSE 0 END) AS ortak_cnt
     FROM sayac s
     JOIN binalar b ON b.id = s.bina_id
     GROUP BY s.bina_id`
  )
  .all();

const getBilgi = db.prepare(`SELECT * FROM bina_bilgi WHERE bina_id = ?`);
const getKats = db.prepare(
  `SELECT kat, kapi_no FROM sayac WHERE bina_id = ? AND (TRIM(COALESCE(kat,'')) != '' OR TRIM(COALESCE(kapi_no,'')) != '')`
);

const upsert = db.prepare(`
  INSERT INTO bina_bilgi (
    bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum,
    has_zemin, ada_parsel, sokak, dis_kapi_no, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(bina_id) DO UPDATE SET
    kat_sayisi = excluded.kat_sayisi,
    daire_sayisi = excluded.daire_sayisi,
    ortak_alan_sayisi = excluded.ortak_alan_sayisi,
    toplam_bagımsız_bolum = excluded.toplam_bagımsız_bolum,
    has_zemin = excluded.has_zemin,
    ada_parsel = excluded.ada_parsel,
    sokak = excluded.sokak,
    dis_kapi_no = excluded.dis_kapi_no,
    updated_at = datetime('now')
`);

const stats = {
  created: 0,
  updated: 0,
  unchanged: 0,
  with_diskapi: 0,
  with_ada: 0,
};

if (!dryRun) db.exec("BEGIN");

for (const row of sayacliBinalar) {
  const binaId = row.bina_id;
  const existing = getBilgi.get(binaId) || null;
  const sayacCount = Number(row.sayac_count) || 0;
  const ortakCnt = Number(row.ortak_cnt) || 0;
  const daireCount = Math.max(1, sayacCount - ortakCnt);

  let hasZemin = existing?.has_zemin === 1;
  let maxKat = 0;
  for (const r of getKats.all(binaId)) {
    const fromKat = parseKatLabel(r.kat);
    if (fromKat) {
      if (fromKat.zemin) hasZemin = true;
      maxKat = Math.max(maxKat, fromKat.n);
    }
    const fromKapi = inferKatFromKapi(r.kapi_no);
    if (fromKapi) {
      if (fromKapi.zemin) hasZemin = true;
      maxKat = Math.max(maxKat, fromKapi.n);
    }
  }

  // Mevcut kat bilgisini koru/yükselt
  const existingKat = Number(existing?.kat_sayisi) || 0;
  let katSayisi = Math.max(existingKat, estimateKat(daireCount, maxKat, hasZemin || existingKat === 0));
  if (!hasZemin && existingKat === 0 && daireCount > 0) hasZemin = true;

  const existingDaire = Number(existing?.daire_sayisi) || 0;
  const existingToplam = Number(existing?.["toplam_bagımsız_bolum"]) || 0;
  const existingOrtak = Number(existing?.ortak_alan_sayisi) || 0;

  const daire_sayisi = Math.max(existingDaire, daireCount);
  const ortak_alan_sayisi = Math.max(existingOrtak, ortakCnt);
  const toplam = Math.max(existingToplam, daire_sayisi + ortak_alan_sayisi, sayacCount);

  let ada = String(existing?.ada_parsel ?? "").trim();
  if (!ada) ada = inferAdaFromValue(row.value);
  if (ada) stats.with_ada++;

  let sokak = String(existing?.sokak ?? "").trim();
  let disKapi = String(existing?.dis_kapi_no ?? "").trim();
  const disk = diskapi[String(binaId)];
  if (!disKapi && disk?.primary_kapi) {
    disKapi = String(disk.primary_kapi).trim();
    stats.with_diskapi++;
  }

  const next = {
    kat_sayisi: katSayisi,
    daire_sayisi,
    ortak_alan_sayisi,
    toplam_bagımsız_bolum: toplam,
    has_zemin: hasZemin ? 1 : 0,
    ada_parsel: ada,
    sokak,
    dis_kapi_no: disKapi,
  };

  const same =
    existing &&
    Number(existing.kat_sayisi) === next.kat_sayisi &&
    Number(existing.daire_sayisi) === next.daire_sayisi &&
    Number(existing.ortak_alan_sayisi) === next.ortak_alan_sayisi &&
    Number(existing["toplam_bagımsız_bolum"]) === next.toplam_bagımsız_bolum &&
    Number(existing.has_zemin) === next.has_zemin &&
    String(existing.ada_parsel ?? "") === next.ada_parsel &&
    String(existing.sokak ?? "") === next.sokak &&
    String(existing.dis_kapi_no ?? "") === next.dis_kapi_no;

  if (same) {
    stats.unchanged++;
    continue;
  }

  if (!existing) stats.created++;
  else stats.updated++;

  if (!dryRun) {
    upsert.run(
      binaId,
      next.kat_sayisi,
      next.daire_sayisi,
      next.ortak_alan_sayisi,
      next.toplam_bagımsız_bolum,
      next.has_zemin,
      next.ada_parsel,
      next.sokak,
      next.dis_kapi_no
    );
  }
}

if (!dryRun) db.exec("COMMIT");

const report = {
  dry_run: dryRun,
  sayacli_bina: sayacliBinalar.length,
  ...stats,
  finished_at: new Date().toISOString(),
};
const reportPath = join(DATA_DIR, `fill-bina-bilgi-report-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, ...report, report: reportPath }, null, 2));
