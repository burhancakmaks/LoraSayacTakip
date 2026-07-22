import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const CACHE_DURATION_MS = 10 * 1000;
let buildingCache: { expiresAt: number; data: unknown[] } | null = null;

export async function GET() {
  if (buildingCache && buildingCache.expiresAt > Date.now()) {
    return NextResponse.json(buildingCache.data, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  }

  let db: DatabaseSync | null = null;
  try {
    const dbPath = path.join(process.cwd(), "data", "binalar.db");
    db = new DatabaseSync(dbPath, { readOnly: true });
    
    // Check if building has config in bina_bilgi
    const query = db.prepare(`
      SELECT b.*,
        EXISTS(SELECT 1 FROM bina_bilgi WHERE bina_id = b.id) AS is_configured,
        COALESCE(e.excel_kayit_sayisi, 0) AS excel_kayit_sayisi,
        COALESCE(e.excel_abone_sayisi, 0) AS excel_abone_sayisi,
        COALESCE(e.excel_sayac_sayisi, 0) AS excel_sayac_sayisi,
        COALESCE(e.eksik_abone_sayisi, 0) AS eksik_abone_sayisi,
        COALESCE(e.eksik_sayac_sayisi, 0) AS eksik_sayac_sayisi,
        COALESCE(e.excel_ada, '') AS excel_ada,
        COALESCE(e.excel_blok, '') AS excel_blok,
        COALESCE(e.excel_mahalle, '') AS excel_mahalle,
        COALESCE(e.excel_adres, '') AS excel_adres,
        CASE
          WHEN COALESCE(e.excel_sayac_sayisi, 0) > 0
            OR EXISTS (
              SELECT 1
              FROM sayac s
              WHERE s.bina_id = b.id
                AND TRIM(COALESCE(s.sayac_id, '')) <> ''
            )
          THEN 1
          ELSE 0
        END AS has_meter_number
      FROM binalar b
      LEFT JOIN (
        SELECT bina_id,
          COUNT(*) AS excel_kayit_sayisi,
          COUNT(DISTINCT NULLIF(abone_no, '')) AS excel_abone_sayisi,
          COUNT(DISTINCT NULLIF(sayac_no, '')) AS excel_sayac_sayisi,
          SUM(CASE WHEN abone_no = '' THEN 1 ELSE 0 END) AS eksik_abone_sayisi,
          SUM(CASE WHEN sayac_no = '' THEN 1 ELSE 0 END) AS eksik_sayac_sayisi,
          MIN(NULLIF(TRIM(ada), '')) AS excel_ada,
          MIN(NULLIF(TRIM(blok), '')) AS excel_blok,
          MIN(NULLIF(TRIM(mahalle), '')) AS excel_mahalle,
          MIN(NULLIF(TRIM(adres), '')) AS excel_adres
        FROM excel_abonelikler
        WHERE bina_id IS NOT NULL
        GROUP BY bina_id
      ) e ON e.bina_id = b.id
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
      excel_kayit_sayisi: row.excel_kayit_sayisi,
      excel_abone_sayisi: row.excel_abone_sayisi,
      excel_sayac_sayisi: row.excel_sayac_sayisi,
      eksik_abone_sayisi: row.eksik_abone_sayisi,
      eksik_sayac_sayisi: row.eksik_sayac_sayisi,
      excel_ada: row.excel_ada,
      excel_blok: row.excel_blok,
      excel_mahalle: row.excel_mahalle,
      excel_adres: row.excel_adres,
      has_meter_number: row.has_meter_number === 1,
    }));

    buildingCache = { expiresAt: Date.now() + CACHE_DURATION_MS, data: binalar };
    return NextResponse.json(binalar, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error: any) {
    console.error("Error fetching binalar from SQLite:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db?.close();
  }
}
