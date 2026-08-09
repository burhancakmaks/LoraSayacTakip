import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { searchDiskapiDoors } from "@/lib/diskapi-lookup";

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
}

// GET /api/diskapi/search?q=70/1
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q || q.length < 2) return NextResponse.json([]);

    const hits = searchDiskapiDoors(q, 25);
    if (!hits.length) return NextResponse.json([]);

    const db = getDb();
    const binaStmt = db.prepare(`SELECT id, value, layer, oda_id FROM binalar WHERE id = ?`);

    const results = hits.map((hit) => {
      const bina = binaStmt.get(hit.bina_id) as {
        id: number;
        value: string;
        layer: string | null;
        oda_id: number | null;
      } | undefined;

      return {
        bina_id: hit.bina_id,
        kapi_no: hit.kapi_no,
        building_name: bina?.value || "Bilinmeyen Bina",
        layer: bina?.layer ?? null,
        oda_id: bina?.oda_id ?? null,
        lat: hit.lat,
        lng: hit.lng,
        alignment: hit.door.alignment,
        edge_distance_m: hit.door.edge_distance_m,
      };
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kapı arama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
