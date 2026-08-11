import { NextRequest, NextResponse } from "next/server";
import {
  findKonumBySayacId,
  getSayacKonumDb,
  listKonumByBina,
} from "@/lib/sayac-konum-db";
import { getMeterTypeColor, getMeterTypeLabel } from "@/lib/sayac-konum";

// GET /api/sayac/konum?bina_id=1788
// GET /api/sayac/konum?sayac_id=1430533
// GET /api/sayac/konum  → özet
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const binaIdParam = searchParams.get("bina_id");
    const sayacId = (searchParams.get("sayac_id") || "").trim();
    const db = getSayacKonumDb();

    if (binaIdParam) {
      const binaId = parseInt(binaIdParam, 10);
      if (!Number.isFinite(binaId)) {
        return NextResponse.json({ error: "Geçersiz bina_id" }, { status: 400 });
      }
      const konumlar = listKonumByBina(db, binaId);
      const by_type: Record<string, number> = {};
      for (const k of konumlar) {
        by_type[k.meter_type || "?"] = (by_type[k.meter_type || "?"] || 0) + 1;
      }
      return NextResponse.json({
        bina_id: binaId,
        total: konumlar.length,
        by_type,
        konumlar,
        type_colors: Object.fromEntries(
          Object.keys(by_type).map((t) => [t, getMeterTypeColor(t)])
        ),
        type_labels: Object.fromEntries(
          Object.keys(by_type).map((t) => [t, getMeterTypeLabel(t)])
        ),
      });
    }

    if (sayacId) {
      // Prefer exact coords on sayac row
      const row = db
        .prepare(
          `SELECT sayac_id, bina_id, lat, lng FROM sayac
           WHERE TRIM(sayac_id) = ? OR REPLACE(REPLACE(REPLACE(UPPER(sayac_id),'2025-',''),' ',''),'-','') = ?
           LIMIT 1`
        )
        .get(
          sayacId,
          sayacId.replace(/^2025-/i, "").replace(/\D/g, "").replace(/^0+/, "")
        ) as { sayac_id: string; bina_id: number; lat: number | null; lng: number | null } | undefined;

      if (row?.lat != null && row?.lng != null) {
        return NextResponse.json({
          sayac_id: row.sayac_id,
          bina_id: row.bina_id,
          lat: row.lat,
          lng: row.lng,
          source: "sayac",
        });
      }

      const konum = findKonumBySayacId(db, sayacId);
      if (!konum) {
        return NextResponse.json({ found: false, sayac_id: sayacId });
      }
      return NextResponse.json({
        found: true,
        sayac_id: sayacId,
        ...konum,
        source: "sayac_konum",
        type_label: getMeterTypeLabel(konum.meter_type),
        type_color: getMeterTypeColor(konum.meter_type),
      });
    }

    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN bina_id IS NOT NULL THEN 1 ELSE 0 END) AS with_bina,
           SUM(CASE WHEN TRIM(COALESCE(sayac_id_matched,'')) != '' THEN 1 ELSE 0 END) AS with_sayac,
           COUNT(DISTINCT bina_id) AS bina_count
         FROM sayac_konum`
      )
      .get() as {
      total: number;
      with_bina: number;
      with_sayac: number;
      bina_count: number;
    };

    const byType = db
      .prepare(`SELECT meter_type, COUNT(*) AS c FROM sayac_konum GROUP BY meter_type ORDER BY c DESC`)
      .all() as Array<{ meter_type: string; c: number }>;

    return NextResponse.json({
      stats,
      by_type: byType.map((r) => ({
        id: r.meter_type,
        label: getMeterTypeLabel(r.meter_type),
        color: getMeterTypeColor(r.meter_type),
        count: r.c,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Konum verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
