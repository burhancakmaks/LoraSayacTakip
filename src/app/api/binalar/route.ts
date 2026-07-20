import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export async function GET() {
  try {
    const dbPath = path.join(process.cwd(), "data", "binalar.db");
    const db = new DatabaseSync(dbPath);
    
    // Check if building has config in bina_bilgi
    const query = db.prepare(`
      SELECT *, EXISTS(SELECT 1 FROM bina_bilgi WHERE bina_id = binalar.id) as is_configured 
      FROM binalar
    `);
    const rows = query.all() as any[];
    
    const binalar = rows.map((row) => ({
      id: row.id,
      oda_id: row.oda_id,
      kml_id: row.kml_id,
      id_2: row.id_2,
      value: row.value,
      layer: row.layer,
      abone_sayisi: row.abone_sayisi,
      aktif_abone_sayisi: row.aktif_abone_sayisi,
      building_type_id: row.building_type_id,
      coordinates: JSON.parse(row.coordinates),
      is_configured: row.is_configured === 1,
    }));

    return NextResponse.json(binalar);
  } catch (error: any) {
    console.error("Error fetching binalar from SQLite:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
