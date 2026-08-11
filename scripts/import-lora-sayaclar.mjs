/**
 * İKİZCE LoRa sayaç CSV import
 * Kaynak: Bölge;Blok;Daire;Kat;DevEUI;Durum;Son Uplink;Kaydeden;Kayıt Tarihi;Notlar
 *
 * DevEUI ≠ MASKİ sayaç no — ayrı lora_cihaz tablosuna yazılır.
 * GB/DB/DC blokları 5. ETAP bina haritasına bağlanır.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");
const DEFAULT_CSV = join(DATA_DIR, "sayaclar_lora_ikizce.csv");

const SHEET_5ETAP = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

function findCsv() {
  const arg = process.argv.find((a) => a.endsWith(".csv"));
  if (arg && existsSync(arg)) return arg;
  if (existsSync(DEFAULT_CSV)) return DEFAULT_CSV;

  const downloads = "C:/Users/Surface/Downloads";
  for (const dir of [downloads, DATA_DIR]) {
    if (!existsSync(dir)) continue;
    const hits = readdirSync(dir)
      .filter((f) => /^sayaclar_.*\.csv$/i.test(f))
      .map((f) => join(dir, f));
    if (hits.length) {
      hits.sort();
      return hits[hits.length - 1];
    }
  }
  return null;
}

function parseCsvLine(line) {
  const parts = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ";" && !q) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function readCsv(path) {
  let text = readFileSync(path, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/^\r?\n/, "");
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line, idx) => {
    const parts = parseCsvLine(line);
    const row = { _row: idx + 2 };
    header.forEach((h, i) => {
      row[h] = (parts[i] ?? "").trim();
    });
    return row;
  });
}

/** DB 1 / GB-05 / gb1 -> GB1 */
export function canonBlok(raw) {
  let s = String(raw ?? "")
    .toLocaleUpperCase("tr-TR")
    .replace(/\s+/g, "")
    .replace(/BLOK/g, "");
  s = s.replace(/^([A-ZÇĞİÖŞÜ]+)[-_]?0*(\d+)(.*)$/i, (_, a, n, rest) => {
    return `${a}${parseInt(n, 10)}${rest || ""}`;
  });
  return s;
}

export function extractKapiNo(daire) {
  const s = String(daire ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(?:Daire|Kapı|Kapi)\s*(\d+)$/i);
  if (m) return m[1];
  if (/kap[ıi]c[ıi]/i.test(s)) return "Kapıcı";
  const num = s.match(/Numaras[ıi]z\s*(\d+)/i);
  if (num) return `Numarasız ${num[1]}`;
  const digits = s.replace(/\D/g, "");
  if (digits && /daire|kap/i.test(s)) return digits;
  return s;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lora_cihaz (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deveui TEXT NOT NULL UNIQUE,
      bolge TEXT DEFAULT '',
      blok TEXT DEFAULT '',
      blok_canon TEXT DEFAULT '',
      daire TEXT DEFAULT '',
      kapi_no TEXT DEFAULT '',
      kat TEXT DEFAULT '',
      durum TEXT DEFAULT '',
      son_uplink TEXT DEFAULT '',
      kaydeden TEXT DEFAULT '',
      kayit_tarihi TEXT DEFAULT '',
      notlar TEXT DEFAULT '',
      bina_id INTEGER,
      match_kaynak TEXT DEFAULT '',
      source_file TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_lora_bina ON lora_cihaz(bina_id);
    CREATE INDEX IF NOT EXISTS idx_lora_blok ON lora_cihaz(blok_canon);
    CREATE INDEX IF NOT EXISTS idx_lora_kapi ON lora_cihaz(bina_id, kapi_no);
    CREATE INDEX IF NOT EXISTS idx_lora_durum ON lora_cihaz(durum);
  `);
}

function buildBlokBinaMap(db) {
  const map = new Map();

  for (const [blok, binaId] of Object.entries(SHEET_5ETAP)) {
    map.set(blok, { binaId, kaynak: "5.ETAP" });
  }

  // Existing sayac blok labels (GB1, DB-01, …)
  const rows = db
    .prepare(
      `SELECT blok_no, bina_id, COUNT(*) AS c
       FROM sayac
       WHERE TRIM(COALESCE(blok_no,'')) != ''
       GROUP BY blok_no, bina_id
       ORDER BY c DESC`
    )
    .all();

  for (const r of rows) {
    const key = canonBlok(r.blok_no);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { binaId: r.bina_id, kaynak: "sayac.blok" });
    }
    // also store base without hyphen suffix
    const base = key.split("-")[0];
    if (base && !map.has(base)) {
      map.set(base, { binaId: r.bina_id, kaynak: "sayac.blok-base" });
    }
  }

  return map;
}

function resolveBina(blokCanon, map) {
  if (!blokCanon) return null;
  if (map.has(blokCanon)) return map.get(blokCanon);
  const base = blokCanon.split("-")[0];
  if (base && map.has(base)) return map.get(base);
  // A1-01 -> A1
  const m = blokCanon.match(/^([A-ZÇĞİÖŞÜ]+\d+)/);
  if (m && map.has(m[1])) return map.get(m[1]);
  return null;
}

const csvPath = findCsv();
if (!csvPath) {
  console.error("sayaclar_*.csv bulunamadı (Downloads veya data/).");
  process.exit(1);
}

if (!existsSync(DEFAULT_CSV) || csvPath !== DEFAULT_CSV) {
  try {
    copyFileSync(csvPath, DEFAULT_CSV);
  } catch {
    /* ignore */
  }
}

const rows = readCsv(csvPath);
const db = new DatabaseSync(DB_PATH);
ensureSchema(db);
const blokMap = buildBlokBinaMap(db);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(DB_PATH, join(DATA_DIR, `binalar.before-lora-${stamp}.db`));

const stats = {
  source: csvPath,
  total: rows.length,
  upserted: 0,
  skipped: 0,
  mapped_bina: 0,
  unmapped_bina: 0,
  by_durum: {},
  by_bolge: {},
  mapped_blocks: {},
  unmapped_blocks: {},
};

db.exec("BEGIN");
db.exec("DELETE FROM lora_cihaz");

const insert = db.prepare(`
  INSERT INTO lora_cihaz (
    deveui, bolge, blok, blok_canon, daire, kapi_no, kat, durum,
    son_uplink, kaydeden, kayit_tarihi, notlar, bina_id, match_kaynak, source_file, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

const seen = new Set();

for (const row of rows) {
  const deveui = String(row.DevEUI || row.deveui || "")
    .trim()
    .toLowerCase();
  if (!deveui || deveui.length < 8) {
    stats.skipped++;
    continue;
  }
  if (seen.has(deveui)) {
    stats.skipped++;
    continue;
  }
  seen.add(deveui);

  const bolge = row["Bölge"] || row.Bolge || "";
  const blok = row.Blok || "";
  const blokCanon = canonBlok(blok);
  const daire = row.Daire || "";
  const kapiNo = extractKapiNo(daire);
  const kat = row.Kat || "";
  const durum = String(row.Durum || "").trim().toLowerCase();
  const sonUplink = row["Son Uplink"] || row.SonUplink || "";
  const kaydeden = row.Kaydeden || "";
  const kayitTarihi = row["Kayıt Tarihi"] || row["Kayit Tarihi"] || "";
  const notlar = row.Notlar || "";

  const resolved = resolveBina(blokCanon, blokMap);
  const binaId = resolved?.binaId ?? null;
  const matchKaynak = resolved?.kaynak ?? "";

  if (binaId) {
    stats.mapped_bina++;
    stats.mapped_blocks[blokCanon] = (stats.mapped_blocks[blokCanon] || 0) + 1;
  } else {
    stats.unmapped_bina++;
    stats.unmapped_blocks[blokCanon || "?"] = (stats.unmapped_blocks[blokCanon || "?"] || 0) + 1;
  }

  stats.by_durum[durum || "?"] = (stats.by_durum[durum || "?"] || 0) + 1;
  stats.by_bolge[bolge || "?"] = (stats.by_bolge[bolge || "?"] || 0) + 1;

  insert.run(
    deveui,
    bolge,
    blok,
    blokCanon,
    daire,
    kapiNo,
    kat,
    durum,
    sonUplink,
    kaydeden,
    kayitTarihi,
    notlar,
    binaId,
    matchKaynak,
    csvPath
  );
  stats.upserted++;
}

db.exec("COMMIT");

const reportPath = join(DATA_DIR, `lora-import-report-${stamp}.json`);
const report = {
  ...stats,
  mapped_blocks_top: Object.entries(stats.mapped_blocks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30),
  unmapped_blocks_top: Object.entries(stats.unmapped_blocks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40),
  finished_at: new Date().toISOString(),
};
delete report.mapped_blocks;
delete report.unmapped_blocks;
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      upserted: stats.upserted,
      mapped_bina: stats.mapped_bina,
      unmapped_bina: stats.unmapped_bina,
      by_durum: stats.by_durum,
      report: reportPath,
      csv: csvPath,
    },
    null,
    2
  )
);
