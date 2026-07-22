import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  return new DatabaseSync(dbPath);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    const db = getDb();

    // If "name" parameter is provided, return full details with coordinates
    if (name) {
      const row = db.prepare("SELECT name, center_lat, center_lng, coordinates FROM mahalleler WHERE name = ?").get(name) as any;
      if (!row) {
        return NextResponse.json({ error: "Mahalle bulunamadı" }, { status: 404 });
      }
      return NextResponse.json({
        name: row.name,
        center: [row.center_lat, row.center_lng],
        coordinates: JSON.parse(row.coordinates)
      });
    }

    // Otherwise, return only name list and centers for the dropdown selection
    const rows = db.prepare("SELECT name, center_lat, center_lng FROM mahalleler ORDER BY name ASC").all() as any[];
    const list = rows.map((r) => ({
      name: r.name,
      center: [r.center_lat, r.center_lng]
    }));

    return NextResponse.json(list);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
