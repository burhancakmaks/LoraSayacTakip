import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureSayacKonumSchema } from "@/lib/sayac-konum-db";

function getDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  ensureSayacKonumSchema(db);
  return db;
}

function centroid(coords: [number, number][][]) {
  let la = 0;
  let ln = 0;
  let n = 0;
  for (const ring of coords) {
    for (const [lat, lng] of ring) {
      la += lat;
      ln += lng;
      n++;
    }
  }
  return n ? { lat: la / n, lng: ln / n } : null;
}

/** Polimeter sözleşme sayıları — bina bazlı */
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare(
        `
        SELECT
          sk.bina_id,
          b.value,
          b.coordinates,
          COUNT(DISTINCT TRIM(sk.agreement_number)) AS sozlesme_sayisi,
          COUNT(*) AS sayac_sayisi
        FROM sayac_konum sk
        JOIN binalar b ON b.id = sk.bina_id
        WHERE sk.meter_type = 'POLIMETER_LORA_W'
          AND sk.bina_id IS NOT NULL
          AND TRIM(COALESCE(sk.agreement_number, '')) != ''
        GROUP BY sk.bina_id
        ORDER BY sozlesme_sayisi DESC
      `
      )
      .all() as Array<{
      bina_id: number;
      value: string;
      coordinates: string;
      sozlesme_sayisi: number;
      sayac_sayisi: number;
    }>;

    const binalar = rows.map((row) => {
      let center: { lat: number; lng: number } | null = null;
      try {
        const coords = JSON.parse(row.coordinates) as [number, number][][];
        center = centroid(coords);
      } catch {
        center = null;
      }
      return {
        bina_id: row.bina_id,
        value: row.value,
        count: row.sozlesme_sayisi,
        sayac_sayisi: row.sayac_sayisi,
        center,
      };
    });

    const toplamSozlesme = binalar.reduce((s, b) => s + b.count, 0);

    return NextResponse.json({
      ozet: {
        sozlesme_sayisi: toplamSozlesme,
        bina_sayisi: binalar.length,
        sayac_sayisi: rows.reduce((s, r) => s + r.sayac_sayisi, 0),
      },
      binalar,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Polimeter özet alınamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
