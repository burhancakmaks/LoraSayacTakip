import { NextRequest, NextResponse } from "next/server";
import { getLoraDurumMeta, summarizeLora } from "@/lib/lora-cihaz";
import { getLoraDb, listLoraByBina } from "@/lib/lora-cihaz-db";

// GET /api/lora                     → özet
// GET /api/lora?bina_id=1788        → bina cihazları
// GET /api/lora?q=000019c640010392  → DevEUI / blok arama
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const binaIdParam = searchParams.get("bina_id");
    const q = (searchParams.get("q") || "").trim();

    const db = getLoraDb();

    if (binaIdParam) {
      const binaId = parseInt(binaIdParam, 10);
      if (!Number.isFinite(binaId)) {
        return NextResponse.json({ error: "Geçersiz bina_id" }, { status: 400 });
      }
      const cihazlar = listLoraByBina(db, binaId);
      const summary = summarizeLora(cihazlar);
      return NextResponse.json({
        bina_id: binaId,
        ...summary,
        cihazlar,
        durum_meta: Object.fromEntries(
          Object.keys(summary.by_durum).map((d) => [d, getLoraDurumMeta(d)])
        ),
      });
    }

    if (q) {
      if (q.length < 3) return NextResponse.json([]);

      const needle = q.toLowerCase();
      const rows = db
        .prepare(
          `
        SELECT
          l.id, l.deveui, l.bolge, l.blok, l.blok_canon, l.daire, l.kapi_no, l.kat,
          l.durum, l.son_uplink, l.kaydeden, l.kayit_tarihi, l.notlar, l.bina_id, l.match_kaynak,
          b.value AS building_name, b.coordinates, b.layer, b.oda_id,
          EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured,
          (
            SELECT s.sayac_id FROM sayac s
            WHERE s.bina_id = l.bina_id
              AND TRIM(COALESCE(s.kapi_no,'')) = TRIM(COALESCE(l.kapi_no,''))
              AND TRIM(COALESCE(s.sayac_id,'')) != ''
            ORDER BY s.birim_no LIMIT 1
          ) AS related_sayac_id
        FROM lora_cihaz l
        LEFT JOIN binalar b ON b.id = l.bina_id
        WHERE LOWER(l.deveui) LIKE '%' || ? || '%'
           OR LOWER(l.blok) LIKE '%' || ? || '%'
           OR LOWER(l.blok_canon) LIKE '%' || ? || '%'
           OR LOWER(l.daire) LIKE '%' || ? || '%'
        ORDER BY
          CASE WHEN LOWER(l.deveui) = ? THEN 0
               WHEN LOWER(l.deveui) LIKE ? || '%' THEN 1
               ELSE 2 END,
          l.deveui
        LIMIT 25
      `
        )
        .all(needle, needle, needle, needle, needle, needle) as Array<{
        id: number;
        deveui: string;
        bolge: string;
        blok: string;
        blok_canon: string;
        daire: string;
        kapi_no: string;
        kat: string;
        durum: string;
        son_uplink: string;
        kaydeden: string;
        kayit_tarihi: string;
        notlar: string;
        bina_id: number | null;
        match_kaynak: string;
        building_name: string | null;
        coordinates: string | null;
        layer: string | null;
        oda_id: number | null;
        is_configured: number | null;
        related_sayac_id: string | null;
      }>;

      return NextResponse.json(
        rows.map((row) => ({
          match_type: "lora" as const,
          bina_id: row.bina_id,
          birim_no: 0,
          blok_no: row.blok,
          kat: row.kat || "",
          kapi_no: row.kapi_no || "",
          sayac_id: row.related_sayac_id || "",
          abone_no: "",
          deveui: row.deveui,
          lora_durum: row.durum,
          son_uplink: row.son_uplink,
          building_name: row.building_name || `${row.bolge} ${row.blok}`.trim() || "Eşleşmeyen blok",
          layer: row.layer,
          oda_id: row.oda_id,
          is_configured: !!row.is_configured,
          coordinates: row.coordinates ? (JSON.parse(row.coordinates) as [number, number][][]) : [],
          durum_meta: getLoraDurumMeta(row.durum),
        }))
      );
    }

    const totals = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN bina_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped,
           SUM(CASE WHEN LOWER(durum)='active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN LOWER(durum)='registered' THEN 1 ELSE 0 END) AS registered,
           SUM(CASE WHEN LOWER(durum)='error' THEN 1 ELSE 0 END) AS error,
           COUNT(DISTINCT bina_id) AS bina_count
         FROM lora_cihaz`
      )
      .get() as {
      total: number;
      mapped: number;
      active: number;
      registered: number;
      error: number;
      bina_count: number;
    };

    const byBolge = db
      .prepare(`SELECT bolge, COUNT(*) AS c FROM lora_cihaz GROUP BY bolge ORDER BY c DESC`)
      .all() as Array<{ bolge: string; c: number }>;

    return NextResponse.json({
      stats: totals,
      by_bolge: byBolge,
      durum_meta: {
        active: getLoraDurumMeta("active"),
        registered: getLoraDurumMeta("registered"),
        error: getLoraDurumMeta("error"),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "LoRa verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
