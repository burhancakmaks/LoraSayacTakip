import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

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
    
    // aktif_abone_sayisi: sayaç kaydı varsa gerçek sayaç sayısı, yoksa KML'deki statik değer
    const query = db.prepare(`
      SELECT
        b.*,
        EXISTS(SELECT 1 FROM bina_bilgi WHERE bina_id = b.id) AS is_configured,
        (
          SELECT COUNT(*)
          FROM sayac s
          WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id, '')) != ''
        ) AS sayac_count,
        ${tarifeCols}
      FROM binalar b
      ${tarifeJoin}
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
      aktif_abone_sayisi:
        row.sayac_count > 0 ? row.sayac_count : row.aktif_abone_sayisi,
      building_type_id: row.building_type_id,
      coordinates: JSON.parse(row.coordinates),
      is_configured: row.is_configured === 1,
      tarife_sinif: row.tarife_sinif || null,
      tarife_etiket: row.tarife_etiket || null,
      tarife_turu: row.tarife_turu || null,
      tarife_karma: row.tarife_karma === 1,
      rezerv_abone_sayisi: row.rezerv_abone_sayisi || 0,
      has_tarife: !!row.tarife_sinif,
    }));

    return NextResponse.json(binalar);
  } catch (error: any) {
    console.error("Error fetching binalar from SQLite:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
