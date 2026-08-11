/**
 * sayac_konum → sayac yerleştirme
 * - Eksik bina_id için poligon / yakın bina eşlemesi
 * - Polimeter: önce agreement/installation → mevcut abone_no eşlemesi
 * - sayac tablosuna meter_number ile kayıt ekler (lat/lng dahil)
 * - Haritada yeşil boyama sayac_count üzerinden gelir
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

function normMeter(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const intersect =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

function dist2(lat1, lng1, lat2, lng2) {
  const dy = (lat1 - lat2) * 111320;
  const dx = (lng1 - lng2) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return dx * dx + dy * dy;
}

function loadBuildings(db) {
  return db
    .prepare(`SELECT id, value, coordinates FROM binalar`)
    .all()
    .map((b) => {
      let rings = [];
      try {
        const coords = JSON.parse(b.coordinates);
        rings = Array.isArray(coords?.[0]?.[0]) ? coords : [coords];
      } catch {
        rings = [];
      }
      let minLat = 90,
        maxLat = -90,
        minLng = 180,
        maxLng = -180;
      let cLat = 0,
        cLng = 0,
        n = 0;
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        for (const p of ring) {
          const lat = p[0],
            lng = p[1];
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          cLat += lat;
          cLng += lng;
          n++;
        }
      }
      return {
        id: b.id,
        value: b.value,
        rings,
        minLat,
        maxLat,
        minLng,
        maxLng,
        centerLat: n ? cLat / n : null,
        centerLng: n ? cLng / n : null,
      };
    })
    .filter((b) => b.rings.length && b.centerLat != null);
}

function resolveBina(lat, lng, buildings) {
  const pad = 0.0008;
  const inside = [];
  for (const b of buildings) {
    if (lat < b.minLat - pad || lat > b.maxLat + pad || lng < b.minLng - pad || lng > b.maxLng + pad) {
      continue;
    }
    for (const ring of b.rings) {
      if (ring.length >= 3 && pointInRing(lat, lng, ring)) {
        inside.push(b);
        break;
      }
    }
  }
  if (inside.length === 1) return { binaId: inside[0].id, kaynak: "spatial_in_polygon" };
  if (inside.length > 1) {
    inside.sort(
      (a, b) =>
        (a.maxLat - a.minLat) * (a.maxLng - a.minLng) - (b.maxLat - b.minLat) * (b.maxLng - b.minLng)
    );
    return { binaId: inside[0].id, kaynak: "spatial_in_polygon_multi" };
  }

  // 40 m yakınlık fallback
  const maxD2 = 40 * 40;
  let best = null;
  for (const b of buildings) {
    if (b.centerLat == null) continue;
    const d = dist2(lat, lng, b.centerLat, b.centerLng);
    if (d > maxD2) continue;
    if (!best || d < best.d) best = { binaId: b.id, d, kaynak: "spatial_nearest_40m" };
  }
  return best ? { binaId: best.binaId, kaynak: best.kaynak } : null;
}

const db = new DatabaseSync(DB_PATH);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
copyFileSync(DB_PATH, join(DATA_DIR, `binalar.before-konum-place-${stamp}.db`));

const buildings = loadBuildings(db);
const stats = {
  spatial_updated: 0,
  abone_matched: 0,
  inserted: 0,
  skipped_existing: 0,
  skipped_no_bina: 0,
  bina_bilgi_created: 0,
  binalar_touched: new Set(),
  by_match: {},
};

db.exec("BEGIN");

const updateKonum = db.prepare(
  `UPDATE sayac_konum SET bina_id = ?, match_kaynak = ?, updated_at = datetime('now') WHERE id = ?`
);
const updateKonumFull = db.prepare(
  `UPDATE sayac_konum SET bina_id = ?, sayac_id_matched = ?, match_kaynak = ?, updated_at = datetime('now') WHERE id = ?`
);
const updateSayacCoordsAbone = db.prepare(`
  UPDATE sayac SET
    lat = COALESCE(?, lat),
    lng = COALESCE(?, lng),
    abone_no = CASE WHEN TRIM(COALESCE(abone_no,'')) = '' THEN ? ELSE abone_no END,
    sayac_markasi = CASE WHEN TRIM(COALESCE(sayac_markasi,'')) = '' THEN ? ELSE sayac_markasi END,
    updated_at = datetime('now')
  WHERE id = ?
`);

/** @type {Map<string, Array<{id:number, sayac_id:string, bina_id:number}>>} */
const byAbone = new Map();
for (const r of db
  .prepare(`SELECT id, sayac_id, bina_id, abone_no FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != ''`)
  .all()) {
  const k = normMeter(r.abone_no);
  if (!k) continue;
  if (!byAbone.has(k)) byAbone.set(k, []);
  byAbone.get(k).push(r);
}

// 0) Polimeter: önce sözleşme / tesisat → mevcut abone_no
const polyUnlinked = db
  .prepare(
    `
    SELECT id, meter_number, agreement_number, installation_number, lat, lng, meter_type
    FROM sayac_konum
    WHERE meter_type = 'POLIMETER_LORA_W'
      AND TRIM(COALESCE(sayac_id_matched,'')) = ''
      AND lat IS NOT NULL AND lng IS NOT NULL
  `
  )
  .all();

for (const row of polyUnlinked) {
  const agr = normMeter(row.agreement_number);
  const inst = normMeter(row.installation_number);
  let hits = agr ? byAbone.get(agr) || [] : [];
  let kaynak = "abone_agreement";
  if (!hits.length && inst) {
    hits = byAbone.get(inst) || [];
    kaynak = "abone_installation";
  }
  if (!hits.length) continue;

  const hit = hits[0];
  const agreementRaw = String(row.agreement_number ?? "").trim();
  updateSayacCoordsAbone.run(row.lat, row.lng, agreementRaw, "Polimeter", hit.id);
  updateKonumFull.run(hit.bina_id, String(hit.sayac_id), kaynak, row.id);
  stats.abone_matched++;
  stats.by_match[kaynak] = (stats.by_match[kaynak] || 0) + 1;
  stats.binalar_touched.add(hit.bina_id);
}

// 1) Eksik bina_id doldur (mekânsal)
const unmatched = db
  .prepare(
    `SELECT id, lat, lng FROM sayac_konum WHERE bina_id IS NULL AND lat IS NOT NULL AND lng IS NOT NULL`
  )
  .all();

for (const row of unmatched) {
  const hit = resolveBina(row.lat, row.lng, buildings);
  if (!hit) continue;
  updateKonum.run(hit.binaId, hit.kaynak, row.id);
  stats.spatial_updated++;
  stats.by_match[hit.kaynak] = (stats.by_match[hit.kaynak] || 0) + 1;
}

// 2) Mevcut sayac anahtarları
const existingKeys = new Set();
for (const r of db.prepare(`SELECT sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`).all()) {
  const k = normMeter(r.sayac_id);
  if (k) existingKeys.add(k);
}

const maxBirim = new Map();
for (const r of db.prepare(`SELECT bina_id, MAX(birim_no) AS m FROM sayac GROUP BY bina_id`).all()) {
  maxBirim.set(r.bina_id, r.m || 0);
}

const insertSayac = db.prepare(`
  INSERT INTO sayac (
    bina_id, birim_no, blok_no, kat, kapi_no, oda_sayisi, kullanilis_sekli,
    sayac_markasi, sayac_id, sicil_no, abone_no, sayac_durum, lat, lng, updated_at
  ) VALUES (?, ?, ?, '', '', 'YOK', 'DAİRE', ?, ?, '', ?, 'gecerli', ?, ?, datetime('now'))
`);

const updateKonumMatched = db.prepare(
  `UPDATE sayac_konum SET sayac_id_matched = ?, updated_at = datetime('now') WHERE id = ?`
);

const ensureBinaBilgi = db.prepare(`
  INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, has_zemin, toplam_bagımsız_bolum, ada_parsel, updated_at)
  SELECT ?, 1, ?, 1, ?, '', datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM bina_bilgi WHERE bina_id = ?)
`);

const candidates = db
  .prepare(
    `SELECT id, meter_number, meter_key, bina_id, lat, lng, meter_type,
            installation_number, agreement_number, sayac_id_matched
     FROM sayac_konum
     WHERE bina_id IS NOT NULL`
  )
  .all();

for (const row of candidates) {
  if (String(row.sayac_id_matched ?? "").trim()) {
    stats.skipped_existing++;
    continue;
  }

  const key = row.meter_key || normMeter(row.meter_number);
  if (!key) {
    stats.skipped_no_bina++;
    continue;
  }
  if (existingKeys.has(key)) {
    stats.skipped_existing++;
    continue;
  }

  const binaId = row.bina_id;
  const nextBirim = (maxBirim.get(binaId) || 0) + 1;
  maxBirim.set(binaId, nextBirim);

  const marka =
    row.meter_type === "BAYLAN_LORA_W"
      ? "Baylan"
      : row.meter_type === "POLIMETER_LORA_W"
        ? "Polimeter"
        : row.meter_type === "BRT METER LORA"
          ? "BRT"
          : "";

  // Polimeter: abone_no = sözleşme (agreement_number)
  const aboneNo =
    row.meter_type === "POLIMETER_LORA_W"
      ? String(row.agreement_number ?? "").trim()
      : String(row.installation_number ?? "").trim();

  insertSayac.run(
    binaId,
    nextBirim,
    "",
    marka,
    String(row.meter_number),
    aboneNo,
    row.lat,
    row.lng
  );

  updateKonumMatched.run(String(row.meter_number), row.id);
  existingKeys.add(key);
  stats.inserted++;
  stats.binalar_touched.add(binaId);
}

// 3) Yeşil / modal için bina_bilgi yoksa minimal oluştur
for (const binaId of stats.binalar_touched) {
  const cnt = maxBirim.get(binaId) || 1;
  const info = db.prepare(`SELECT bina_id FROM bina_bilgi WHERE bina_id = ?`).get(binaId);
  if (!info) {
    ensureBinaBilgi.run(binaId, cnt, cnt, binaId);
    stats.bina_bilgi_created++;
  } else {
    const cur = db
      .prepare(`SELECT toplam_bagımsız_bolum, daire_sayisi FROM bina_bilgi WHERE bina_id = ?`)
      .get(binaId);
    const toplam = Math.max(Number(cur?.toplam_bagımsız_bolum) || 0, cnt);
    const daire = Math.max(Number(cur?.daire_sayisi) || 0, cnt);
    db.prepare(
      `UPDATE bina_bilgi
       SET toplam_bagımsız_bolum = ?, daire_sayisi = ?, updated_at = datetime('now')
       WHERE bina_id = ?`
    ).run(toplam, daire, binaId);
  }
}

db.exec("COMMIT");

const report = {
  spatial_updated: stats.spatial_updated,
  abone_matched: stats.abone_matched,
  inserted: stats.inserted,
  skipped_existing: stats.skipped_existing,
  binalar_touched: stats.binalar_touched.size,
  bina_bilgi_created: stats.bina_bilgi_created,
  by_match: stats.by_match,
  finished_at: new Date().toISOString(),
};

const reportPath = join(DATA_DIR, `sayac-konum-place-report-${stamp}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, ...report, report: reportPath }, null, 2));
