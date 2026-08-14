import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

type BinaRow = {
  id: number;
  value: string | null;
  coordinates: [number, number][][];
  sayac_count: number;
  is_configured: boolean;
  has_overlay_meters: boolean;
};

function foldName(value: string | null) {
  return String(value || "")
    .normalize("NFC")
    .toLocaleUpperCase("tr-TR")
    .trim();
}

function isGeneratedName(value: string | null) {
  return /^\s*Bina\s*#\d+\s*$/i.test(String(value || "").trim());
}

function bboxOf(coords: [number, number][][]) {
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  const rings = Array.isArray(coords?.[0]?.[0]) ? coords : coords ? [coords as unknown as [number, number][]] : [];
  for (const ring of rings) {
    for (const p of ring || []) {
      const lat = Number(p[0]);
      const lng = Number(p[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

function overlaps(
  a: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number }
) {
  return a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng;
}

function similarBbox(
  a: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  b: { minLat: number; maxLat: number; minLng: number; maxLng: number }
) {
  const aLat = a.maxLat - a.minLat;
  const aLng = a.maxLng - a.minLng;
  const bLat = b.maxLat - b.minLat;
  const bLng = b.maxLng - b.minLng;
  const aArea = Math.max(aLat * aLng, 1e-18);
  const bArea = Math.max(bLat * bLng, 1e-18);
  return Math.abs(aArea - bArea) / Math.max(aArea, bArea) <= 0.25;
}

function markOverlayMeterCopies(binalar: BinaRow[]) {
  const withBbox = binalar.map((b) => ({ b, bbox: bboxOf(b.coordinates) }));
  const byName = new Map<string, typeof withBbox>();
  for (const item of withBbox) {
    const key = foldName(item.b.value);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(item);
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const metered = group.filter((x) => x.b.sayac_count > 0);
    if (!metered.length) continue;
    for (const item of group) {
      if (item.b.sayac_count > 0) continue;
      if (metered.some((m) => overlaps(m.bbox, item.bbox))) {
        item.b.has_overlay_meters = true;
        item.b.is_configured = true;
      }
    }
  }

  const meteredAll = withBbox.filter((x) => x.b.sayac_count > 0);
  for (const item of withBbox) {
    if (item.b.sayac_count > 0 || item.b.has_overlay_meters) continue;
    if (!isGeneratedName(item.b.value)) continue;
    if (
      meteredAll.some(
        (m) => overlaps(m.bbox, item.bbox) && similarBbox(m.bbox, item.bbox) && !isGeneratedName(m.b.value)
      )
    ) {
      item.b.has_overlay_meters = true;
      item.b.is_configured = true;
    }
  }
}

export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), "data", "binalar.db");
    const db = new DatabaseSync(dbPath);

    const hasTarifeTable = !!db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bina_tarife_ozet'`)
      .get();

    const tarifeJoin = hasTarifeTable
      ? `LEFT JOIN bina_tarife_ozet t ON t.bina_id = b.id`
      : "";
    const tarifeCols = hasTarifeTable
      ? `t.tarife_sinif, t.tarife_etiket, t.tarife_turu, t.karma AS tarife_karma,
         t.abone_sayisi AS rezerv_abone_sayisi, t.match_guven AS tarife_match_guven`
      : `NULL AS tarife_sinif, NULL AS tarife_etiket, NULL AS tarife_turu,
         0 AS tarife_karma, 0 AS rezerv_abone_sayisi, 0 AS tarife_match_guven`;
    
    // sayac_kayit > 0 ise girilen sayaç sayısı; yoksa KML'deki statik değer
    const query = db.prepare(`
      SELECT
        b.*,
        EXISTS(SELECT 1 FROM bina_bilgi WHERE bina_id = b.id) AS is_configured,
        (
          SELECT COUNT(*)
          FROM sayac s
          WHERE s.bina_id = b.id
        ) AS sayac_kayit,
        (
          SELECT COUNT(*)
          FROM sayac s
          WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id, '')) != ''
        ) AS sayac_count,
        (SELECT bb.dis_kapi_no FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS dis_kapi_no,
        ${tarifeCols}
      FROM binalar b
      ${tarifeJoin}
    `);
    const rows = query.all() as any[];

    const polimeterByBina = new Map<number, number>(
      (
        db
          .prepare(
            `SELECT bina_id, COUNT(*) AS c
             FROM sayac
             WHERE TRIM(COALESCE(sayac_id, '')) != ''
               AND instr(lower(trim(coalesce(sayac_markasi, ''))), 'polimeter') > 0
             GROUP BY bina_id`
          )
          .all() as Array<{ bina_id: number; c: number }>
      ).map((row) => [row.bina_id, row.c])
    );
    
    const binalar = rows.map((row) => ({
      id: row.id,
      oda_id: row.oda_id,
      kml_id: row.kml_id,
      id_2: row.id_2,
      value: row.value,
      layer: row.layer,
      abone_sayisi: row.abone_sayisi,
      aktif_abone_sayisi:
        row.sayac_kayit > 0 ? row.sayac_count : row.aktif_abone_sayisi,
      building_type_id: row.building_type_id,
      coordinates: JSON.parse(row.coordinates),
      is_configured: row.is_configured === 1 || row.sayac_count > 0,
      sayac_count: row.sayac_count || 0,
      sayac_kayit: row.sayac_kayit || 0,
      polimeter_count: polimeterByBina.get(row.id) || 0,
      dis_kapi_no: row.dis_kapi_no ? String(row.dis_kapi_no).trim() : "",
      tarife_sinif: row.tarife_sinif || null,
      tarife_etiket: row.tarife_etiket || null,
      tarife_turu: row.tarife_turu || null,
      tarife_karma: row.tarife_karma === 1,
      rezerv_abone_sayisi: row.rezerv_abone_sayisi || 0,
      has_tarife: !!row.tarife_sinif,
      has_overlay_meters: false,
    }));

    markOverlayMeterCopies(binalar);

    return NextResponse.json(binalar);
  } catch (error: any) {
    console.error("Error fetching binalar from SQLite:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
