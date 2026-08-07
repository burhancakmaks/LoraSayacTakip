import { NextRequest, NextResponse } from "next/server";
import {
  getUzaktanTypeLabel,
  normUzaktanSayacDigits,
  UZAKTAN_TYPE_COLORS,
} from "@/lib/uzaktan-sozlesme";
import { loadUzaktanSozlesmeIndex } from "@/lib/uzaktan-sozlesme-index";

// GET /api/uzaktan-sozlesme
// GET /api/uzaktan-sozlesme?bina_id=123
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const binaIdParam = searchParams.get("bina_id");
    const index = loadUzaktanSozlesmeIndex();

    if (binaIdParam) {
      const binaId = parseInt(binaIdParam, 10);
      const entry = index.binalar[String(binaId)] ?? index.binalar[binaId];

      if (!entry) {
        return NextResponse.json({
          bina_id: binaId,
          matched: false,
          sayac_count: 0,
          by_type: {},
          primary_type: null,
          sayaclar: [],
          lookup: {},
          type_colors: UZAKTAN_TYPE_COLORS,
        });
      }

      const lookup: Record<string, { type: string; excel_meter: string; sayac_id: string }> = {};
      for (const item of entry.sayaclar) {
        const keys = [item.sayac_id.trim(), item.excel_meter.trim(), normUzaktanSayacDigits(item.sayac_id)];
        for (const key of keys) {
          if (key && !lookup[key]) lookup[key] = item;
        }
      }

      return NextResponse.json({
        bina_id: entry.bina_id,
        matched: true,
        sayac_count: entry.sayac_count,
        by_type: entry.by_type,
        primary_type: entry.primary_type,
        types: entry.types,
        sayaclar: entry.sayaclar,
        lookup,
        type_colors: UZAKTAN_TYPE_COLORS,
      });
    }

    const typeOptions = Object.keys(index.stats.matched_by_type)
      .sort((a, b) => (index.stats.matched_by_type[b] ?? 0) - (index.stats.matched_by_type[a] ?? 0))
      .map((key) => ({
        id: key,
        label: getUzaktanTypeLabel(key),
        color: UZAKTAN_TYPE_COLORS[key] ?? "#64748b",
        excel_count: index.stats.excel_by_type[key] ?? 0,
        matched_count: index.stats.matched_by_type[key] ?? 0,
      }));

    return NextResponse.json({
      built_at: index.built_at,
      excel_path: index.excel_path,
      stats: index.stats,
      type_colors: UZAKTAN_TYPE_COLORS,
      type_options: typeOptions,
      binalar: index.binalar,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Uzaktan okuma verisi alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
