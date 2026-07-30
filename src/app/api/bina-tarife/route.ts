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
    const bina_id = searchParams.get("bina_id");
    const db = getDb();

    const tableExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bina_tarife_ozet'`)
      .get();
    if (!tableExists) {
      return NextResponse.json(bina_id ? null : []);
    }

    if (bina_id) {
      const row = db
        .prepare(
          `SELECT t.*, b.value AS building_name
           FROM bina_tarife_ozet t
           JOIN binalar b ON b.id = t.bina_id
           WHERE t.bina_id = ?`
        )
        .get(parseInt(bina_id)) as any;

      if (!row) return NextResponse.json(null);

      const detay = db
        .prepare(
          `SELECT tarife_turu, tarife_sinif, COUNT(*) AS adet
           FROM rezerv_abonelik
           WHERE bina_id = ? AND TRIM(COALESCE(tarife_turu,'')) != ''
           GROUP BY tarife_turu, tarife_sinif
           ORDER BY adet DESC`
        )
        .all(parseInt(bina_id));

      return NextResponse.json({ ...row, detay });
    }

    const rows = db
      .prepare(
        `SELECT bina_id, tarife_sinif, tarife_etiket, tarife_turu, karma,
                abone_sayisi, match_kaynak, match_guven
         FROM bina_tarife_ozet`
      )
      .all();

    const ozet = db
      .prepare(
        `SELECT tarife_sinif, tarife_etiket, COUNT(*) AS bina_sayisi, SUM(abone_sayisi) AS abone_sayisi
         FROM bina_tarife_ozet
         GROUP BY tarife_sinif, tarife_etiket
         ORDER BY bina_sayisi DESC`
      )
      .all();

    return NextResponse.json({ binalar: rows, ozet });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
