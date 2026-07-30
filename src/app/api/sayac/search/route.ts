import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  return new DatabaseSync(dbPath);
}

function normDigits(v: string) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

// GET /api/sayac/search?q=02995735
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q || q.length < 3) {
      return NextResponse.json([]);
    }

    const digits = normDigits(q);
    const textQ = q.toLocaleLowerCase("tr-TR");

    const db = getDb();
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sayac_sayac_id ON sayac(sayac_id)`);

    const rows = db
      .prepare(
        `
      SELECT
        s.bina_id,
        s.birim_no,
        s.blok_no,
        s.kat,
        s.kapi_no,
        s.sayac_id,
        s.abone_no,
        b.value,
        b.layer,
        b.oda_id,
        b.coordinates,
        EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured
      FROM sayac s
      JOIN binalar b ON b.id = s.bina_id
      WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
        AND (
          (? != '' AND REPLACE(REPLACE(REPLACE(UPPER(s.sayac_id), '2025-', ''), ' ', ''), '-', '') LIKE '%' || ? || '%')
          OR TRIM(COALESCE(s.abone_no, '')) LIKE '%' || ? || '%'
          OR LOWER(COALESCE(s.blok_no, '')) LIKE '%' || ? || '%'
        )
      ORDER BY
        CASE
          WHEN ? != '' AND REPLACE(REPLACE(REPLACE(UPPER(s.sayac_id), '2025-', ''), ' ', ''), '-', '') = ? THEN 0
          WHEN TRIM(COALESCE(s.abone_no, '')) = ? THEN 1
          ELSE 2
        END,
        s.sayac_id
      LIMIT 25
    `
      )
      .all(
        digits,
        digits,
        q,
        textQ,
        digits,
        digits,
        q
      ) as Array<{
        bina_id: number;
        birim_no: number;
        blok_no: string;
        kat: string;
        kapi_no: string;
        sayac_id: string;
        abone_no: string;
        value: string | null;
        layer: string | null;
        oda_id: number | null;
        coordinates: string;
        is_configured: number;
      }>;

    const results = rows.map((row) => ({
      bina_id: row.bina_id,
      birim_no: row.birim_no,
      blok_no: row.blok_no || "",
      kat: row.kat || "",
      kapi_no: row.kapi_no || "",
      sayac_id: row.sayac_id,
      abone_no: row.abone_no || "",
      building_name: row.value || "Bilinmeyen Bina",
      layer: row.layer,
      oda_id: row.oda_id,
      is_configured: !!row.is_configured,
      coordinates: JSON.parse(row.coordinates) as [number, number][][],
    }));

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Arama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
