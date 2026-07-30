import { NextRequest, NextResponse } from "next/server";
import { listMaskiKaynaklar, loadMaskiAramaIndex, searchMaskiRecords } from "@/lib/maski-arama";

// GET /api/maski-arama?q=02995735&kaynak=49%20ADA
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const kaynak = (searchParams.get("kaynak") || "").trim();
    const metaOnly = searchParams.get("meta") === "1";

    const index = loadMaskiAramaIndex();

    if (metaOnly) {
      return NextResponse.json({
        built_at: index.built_at,
        total: index.total,
        stats: index.stats,
        kaynaklar: listMaskiKaynaklar(),
        files: Object.fromEntries(
          Object.entries(index.files).map(([key, f]) => [key, f ? { name: f.name, path: f.path } : null])
        ),
      });
    }

    if (!q) {
      return NextResponse.json({
        built_at: index.built_at,
        total: index.total,
        kaynaklar: listMaskiKaynaklar(),
        results: [],
      });
    }

    const results = searchMaskiRecords(q, { kaynak: kaynak || undefined, limit: 100 });

    return NextResponse.json({
      built_at: index.built_at,
      total: index.total,
      query: q,
      count: results.length,
      results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Arama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
