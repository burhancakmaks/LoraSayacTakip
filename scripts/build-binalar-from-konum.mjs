/**
 * Koordinatlardan deneme amaçlı sanal bina poligonları üretir.
 *
 * Varsayılan: İkizce mahalle bbox (geri alınabilir yedek + metadata).
 *
 *   node scripts/build-binalar-from-konum.mjs --dry-run
 *   node scripts/build-binalar-from-konum.mjs --apply
 *   node scripts/build-binalar-from-konum.mjs --apply --all   # şehir geneli binsiz
 *
 * Geri alma:
 *   node scripts/rollback-binalar-from-konum.mjs
 *   node scripts/rollback-binalar-from-konum.mjs data/konum-sentetik-run-....json
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "data/binalar.db");
const DATA_DIR = join(ROOT, "data");

const LAYER = "KOORDINAT_SENTETIK";
const HALF_M = 5;
const CLUSTER_PREC = 5;
const WRONG_LINK_DEG = 0.012;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || !args.has("--apply");
const allCity = args.has("--all");

const IKIZCE_BBOX = { minLat: 38.27, maxLat: 38.34, minLng: 38.14, maxLng: 38.24 };

function normMeter(v) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "")
    .replace(/^0+/, "");
}

function clusterKey(lat, lng) {
  return `${Number(lat).toFixed(CLUSTER_PREC)}_${Number(lng).toFixed(CLUSTER_PREC)}`;
}

function polygonFromPoints(points, padM = 6, minHalfM = 10) {
  if (!points.length) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const cos = Math.cos((cLat * Math.PI) / 180);
  let halfLat = (maxLat - minLat) / 2 + padM / 111320;
  let halfLng = (maxLng - minLng) / 2 + padM / (111320 * cos);
  halfLat = Math.max(halfLat, minHalfM / 111320);
  halfLng = Math.max(halfLng, minHalfM / (111320 * cos));
  const ring = [
    [cLat - halfLat, cLng - halfLng],
    [cLat - halfLat, cLng + halfLng],
    [cLat + halfLat, cLng + halfLng],
    [cLat + halfLat, cLng - halfLng],
    [cLat - halfLat, cLng - halfLng],
  ];
  return [ring];
}

function squarePolygon(lat, lng, halfM = HALF_M) {
  const dLat = halfM / 111320;
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring = [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
    [lat - dLat, lng - dLng],
  ];
  return [ring];
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

function loadBuildings(db) {
  return db
    .prepare(`SELECT id, value, layer, coordinates FROM binalar`)
    .all()
    .map((b) => {
      let rings = [];
      try {
        const coords = JSON.parse(b.coordinates);
        rings = Array.isArray(coords?.[0]?.[0]) ? coords : [coords];
      } catch {
        rings = [];
      }
      let cLat = 0,
        cLng = 0,
        n = 0;
      for (const ring of rings) {
        for (const p of ring) {
          cLat += p[0];
          cLng += p[1];
          n++;
        }
      }
      return {
        id: b.id,
        value: b.value,
        layer: b.layer || "",
        rings,
        centerLat: n ? cLat / n : null,
        centerLng: n ? cLng / n : null,
        synthetic: String(b.layer || "").includes(LAYER),
      };
    })
    .filter((b) => b.rings.length && b.centerLat != null);
}

function binaAtPoint(lat, lng, buildings) {
  for (const b of buildings) {
    for (const ring of b.rings) {
      if (ring.length >= 3 && pointInRing(lat, lng, ring)) return b;
    }
  }
  return null;
}

function distDeg(lat1, lng1, lat2, lng2) {
  return Math.hypot(lat1 - lat2, lng1 - lng2);
}

function inBbox(lat, lng, box) {
  return lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;
}

const db = new DatabaseSync(DB_PATH);
const buildings = loadBuildings(db);

let rows = db
  .prepare(
    `SELECT id, meter_number, meter_key, installation_number, agreement_number,
            lat, lng, bina_id, sayac_id_matched, meter_type
     FROM sayac_konum
     WHERE lat IS NOT NULL AND lng IS NOT NULL`
  )
  .all();

if (!allCity) {
  rows = rows.filter((r) => inBbox(r.lat, r.lng, IKIZCE_BBOX));
}

const clusters = new Map();
for (const row of rows) {
  const key = clusterKey(row.lat, row.lng);
  if (!clusters.has(key)) {
    clusters.set(key, {
      key,
      lat: row.lat,
      lng: row.lng,
      rows: [],
    });
  }
  clusters.get(key).rows.push(row);
}

const plan = [];
for (const cluster of clusters.values()) {
  const insideReal = binaAtPoint(
    cluster.lat,
    cluster.lng,
    buildings.filter((b) => !b.synthetic)
  );

  const wrongLinkRows = cluster.rows.filter((r) => {
    if (!r.bina_id) return true;
    const b = buildings.find((x) => x.id === r.bina_id);
    if (!b?.centerLat) return true;
    return distDeg(cluster.lat, cluster.lng, b.centerLat, b.centerLng) > WRONG_LINK_DEG;
  });

  if (wrongLinkRows.length === 0 && insideReal) continue;

  const existingSynthetic = buildings.find(
    (b) => b.synthetic && b.value === `KONUM-${cluster.key}`
  );

  plan.push({
    key: cluster.key,
    lat: cluster.lat,
    lng: cluster.lng,
    points: cluster.rows.map((r) => ({ lat: r.lat, lng: r.lng })),
    meter_count: cluster.rows.length,
    relink_count: wrongLinkRows.length,
    skip: wrongLinkRows.length === 0 && !!insideReal,
    existing_bina_id: existingSynthetic?.id ?? null,
    inside_real_id: insideReal?.id ?? null,
    konum_ids: cluster.rows.map((r) => r.id),
    relink_konum_ids: wrongLinkRows.map((r) => r.id),
  });
}

const toCreate = plan.filter((p) => !p.skip && !p.existing_bina_id);
const toReuse = plan.filter((p) => !p.skip && p.existing_bina_id);

console.log(
  JSON.stringify(
    {
      mode: dryRun ? "dry-run" : "apply",
      scope: allCity ? "all-city-filtered" : "ikizce-bbox",
      konum_rows: rows.length,
      clusters: clusters.size,
      plan_clusters: plan.filter((p) => !p.skip).length,
      new_binalar: toCreate.length,
      reuse_binalar: toReuse.length,
      sample: plan.filter((p) => !p.skip).slice(0, 5),
    },
    null,
    2
  )
);

if (dryRun) {
  console.log("\nUygulamak için: node scripts/build-binalar-from-konum.mjs --apply");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = join(DATA_DIR, `binalar.before-konum-sentetik-${stamp}.db`);
copyFileSync(DB_PATH, backupPath);

const meta = {
  stamp,
  backup: backupPath,
  layer: LAYER,
  scope: allCity ? "all" : "ikizce",
  created_bina_ids: [],
  konum_updates: [],
  sayac_updates: [],
  sayac_birim_updates: [],
};

const insertBina = db.prepare(`
  INSERT INTO binalar (oda_id, kml_id, id_2, value, layer, abone_sayisi, aktif_abone_sayisi, building_type_id, coordinates)
  VALUES (NULL, NULL, NULL, ?, ?, ?, ?, NULL, ?)
`);

const updateKonum = db.prepare(`
  UPDATE sayac_konum
  SET bina_id = ?, match_kaynak = 'konum_sentetik', updated_at = datetime('now')
  WHERE id = ?
`);

const updateSayacBina = db.prepare(`
  UPDATE sayac SET bina_id = ?, birim_no = ?, updated_at = datetime('now') WHERE id = ?
`);

const ensureBinaBilgi = db.prepare(`
  INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, has_zemin, toplam_bagımsız_bolum, ada_parsel, updated_at)
  SELECT ?, 1, ?, 1, ?, 'İkizce (koordinat)', datetime('now')
  WHERE NOT EXISTS (SELECT 1 FROM bina_bilgi WHERE bina_id = ?)
`);

const updateBinaBilgi = db.prepare(`
  UPDATE bina_bilgi
  SET toplam_bagımsız_bolum = ?,
      daire_sayisi = ?,
      updated_at = datetime('now')
  WHERE bina_id = ?
`);

const sayacByKey = new Map();
for (const s of db
  .prepare(`SELECT id, bina_id, sayac_id FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != ''`)
  .all()) {
  const k = normMeter(s.sayac_id);
  if (!k) continue;
  if (!sayacByKey.has(k)) sayacByKey.set(k, []);
  sayacByKey.get(k).push(s);
}

const maxBirimByBina = new Map();
for (const r of db.prepare(`SELECT bina_id, MAX(birim_no) m FROM sayac GROUP BY bina_id`).all()) {
  maxBirimByBina.set(r.bina_id, r.m || 0);
}

function nextBirim(binaId) {
  const n = (maxBirimByBina.get(binaId) || 0) + 1;
  maxBirimByBina.set(binaId, n);
  return n;
}

function applyCluster(item) {
  let binaId = item.existing_bina_id;
  const polyCoords =
    polygonFromPoints(item.points) ?? squarePolygon(item.lat, item.lng);

  if (!binaId) {
    const label = `KONUM-${item.key}`;
    const res = insertBina.run(
      label,
      `${LAYER} [İkizce deneme]`,
      item.meter_count,
      item.meter_count,
      JSON.stringify(polyCoords)
    );
    binaId = Number(res.lastInsertRowid);
    meta.created_bina_ids.push(binaId);
    buildings.push({
      id: binaId,
      value: label,
      layer: LAYER,
      rings: polyCoords,
      centerLat: item.lat,
      centerLng: item.lng,
      synthetic: true,
    });
  } else {
    db.prepare(`UPDATE binalar SET coordinates = ? WHERE id = ?`).run(
      JSON.stringify(polyCoords),
      binaId
    );
  }

  const touchedSayac = new Set();
  for (const konumId of item.konum_ids) {
    const row = db.prepare(`SELECT id, bina_id, meter_key, meter_number FROM sayac_konum WHERE id = ?`).get(konumId);
    if (!row) continue;
    if (row.bina_id !== binaId) {
      meta.konum_updates.push({ id: row.id, old_bina_id: row.bina_id });
      updateKonum.run(binaId, row.id);
    }

    const key = row.meter_key || normMeter(row.meter_number);
    const hits = sayacByKey.get(key) || [];
    for (const s of hits) {
      if (s.bina_id === binaId) continue;
      if (touchedSayac.has(s.id)) continue;
      const oldBirim = db.prepare(`SELECT birim_no FROM sayac WHERE id = ?`).get(s.id)?.birim_no;
      const birim = nextBirim(binaId);
      meta.sayac_updates.push({ id: s.id, old_bina_id: s.bina_id, old_birim_no: oldBirim });
      updateSayacBina.run(binaId, birim, s.id);
      touchedSayac.add(s.id);
    }
  }

  ensureBinaBilgi.run(binaId, item.meter_count, item.meter_count, binaId);
  const cur = db
    .prepare(`SELECT toplam_bagımsız_bolum, daire_sayisi FROM bina_bilgi WHERE bina_id = ?`)
    .get(binaId);
  const toplam = Math.max(Number(cur?.toplam_bagımsız_bolum) || 0, item.meter_count);
  const daire = Math.max(Number(cur?.daire_sayisi) || 0, item.meter_count);
  updateBinaBilgi.run(toplam, daire, binaId);

  return binaId;
}

db.exec("BEGIN IMMEDIATE");
try {
  let applied = 0;
  for (const item of plan.filter((p) => !p.skip)) {
    applyCluster(item);
    applied++;
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

let applied = plan.filter((p) => !p.skip).length;

const metaPath = join(DATA_DIR, `konum-sentetik-run-${stamp}.json`);
writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

const after = {
  ikizce_binalar: db
    .prepare(`SELECT COUNT(*) c FROM binalar WHERE layer LIKE '%${LAYER}%'`)
    .get().c,
  ikizce_yesil: db
    .prepare(
      `SELECT COUNT(DISTINCT b.id) c
       FROM binalar b
       JOIN sayac s ON s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id,'')) != ''
       WHERE b.layer LIKE '%${LAYER}%'`
    )
    .get().c,
};

console.log(
  JSON.stringify(
    {
      applied_clusters: applied,
      created_binalar: meta.created_bina_ids.length,
      konum_relinked: meta.konum_updates.length,
      sayac_relinked: meta.sayac_updates.length,
      backup: backupPath,
      meta: metaPath,
      after,
    },
    null,
    2
  )
);

console.log(`\nGeri almak için: node scripts/rollback-binalar-from-konum.mjs "${metaPath}"`);
