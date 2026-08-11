import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureLoraSchema } from "@/lib/lora-cihaz-db";
import { ensureSayacKonumSchema } from "@/lib/sayac-konum-db";

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "binalar.db");
  const db = new DatabaseSync(dbPath);
  ensureLoraSchema(db);
  ensureSayacKonumSchema(db);
  return db;
}

function normDigits(v: string) {
  return String(v ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

function looksLikeDevEui(q: string) {
  const s = q.trim().toLowerCase().replace(/[:-]/g, "");
  return /^[0-9a-f]{8,16}$/i.test(s);
}

// GET /api/sayac/search?q=02995735  (MASKİ no veya LoRa DevEUI)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (!q || q.length < 3) {
      return NextResponse.json([]);
    }

    const digits = normDigits(q);
    const textQ = q.toLocaleLowerCase("tr-TR");
    const deveuiQ = q.toLowerCase().replace(/[:-]/g, "");

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
        s.lat AS sayac_lat,
        s.lng AS sayac_lng,
        (
          SELECT k.lat FROM sayac_konum k
          WHERE k.sayac_id_matched = s.sayac_id
             OR k.meter_number = s.sayac_id
          LIMIT 1
        ) AS konum_lat,
        (
          SELECT k.lng FROM sayac_konum k
          WHERE k.sayac_id_matched = s.sayac_id
             OR k.meter_number = s.sayac_id
          LIMIT 1
        ) AS konum_lng,
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
        sayac_lat: number | null;
        sayac_lng: number | null;
        konum_lat: number | null;
        konum_lng: number | null;
        value: string | null;
        layer: string | null;
        oda_id: number | null;
        coordinates: string;
        is_configured: number;
      }>;

    type SearchHit = {
      match_type: "sayac" | "lora";
      bina_id: number;
      birim_no: number;
      blok_no: string;
      kat: string;
      kapi_no: string;
      sayac_id: string;
      abone_no: string;
      building_name: string;
      layer: string | null;
      oda_id: number | null;
      is_configured: boolean;
      coordinates: [number, number][][];
      lat?: number | null;
      lng?: number | null;
      deveui?: string;
      lora_durum?: string;
    };

    const results: SearchHit[] = rows.map((row) => {
      const lat = row.sayac_lat ?? row.konum_lat ?? null;
      const lng = row.sayac_lng ?? row.konum_lng ?? null;
      return {
        match_type: "sayac" as const,
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
        lat,
        lng,
      };
    });

    // LoRa DevEUI araması (hex kimlik veya normal sonuç azsa)
    if (looksLikeDevEui(q) || results.length < 5) {
      try {
        const loraRows = db
          .prepare(
            `
          SELECT
            l.bina_id, l.blok, l.kapi_no, l.kat, l.deveui, l.durum, l.daire,
            b.value, b.layer, b.oda_id, b.coordinates,
            EXISTS(SELECT 1 FROM bina_bilgi bb WHERE bb.bina_id = b.id) AS is_configured,
            (
              SELECT s.birim_no FROM sayac s
              WHERE s.bina_id = l.bina_id
                AND TRIM(COALESCE(s.kapi_no,'')) = TRIM(COALESCE(l.kapi_no,''))
              ORDER BY s.birim_no LIMIT 1
            ) AS birim_no,
            (
              SELECT s.sayac_id FROM sayac s
              WHERE s.bina_id = l.bina_id
                AND TRIM(COALESCE(s.kapi_no,'')) = TRIM(COALESCE(l.kapi_no,''))
                AND TRIM(COALESCE(s.sayac_id,'')) != ''
              ORDER BY s.birim_no LIMIT 1
            ) AS related_sayac_id
          FROM lora_cihaz l
          LEFT JOIN binalar b ON b.id = l.bina_id
          WHERE LOWER(REPLACE(REPLACE(l.deveui, ':', ''), '-', '')) LIKE '%' || ? || '%'
          ORDER BY
            CASE WHEN LOWER(REPLACE(REPLACE(l.deveui, ':', ''), '-', '')) = ? THEN 0 ELSE 1 END,
            l.deveui
          LIMIT 15
        `
          )
          .all(deveuiQ, deveuiQ) as Array<{
          bina_id: number | null;
          blok: string;
          kapi_no: string;
          kat: string;
          deveui: string;
          durum: string;
          daire: string;
          value: string | null;
          layer: string | null;
          oda_id: number | null;
          coordinates: string | null;
          is_configured: number | null;
          birim_no: number | null;
          related_sayac_id: string | null;
        }>;

        const seen = new Set(results.map((r) => `${r.bina_id}|${r.sayac_id}`));
        for (const row of loraRows) {
          if (!row.bina_id || !row.coordinates) continue;
          const key = `${row.bina_id}|${row.related_sayac_id || row.deveui}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            match_type: "lora",
            bina_id: row.bina_id,
            birim_no: row.birim_no || 0,
            blok_no: row.blok || "",
            kat: row.kat || "",
            kapi_no: row.kapi_no || "",
            sayac_id: row.related_sayac_id || row.deveui,
            abone_no: "",
            building_name: row.value || `LoRa ${row.blok}`,
            layer: row.layer,
            oda_id: row.oda_id,
            is_configured: !!row.is_configured,
            coordinates: JSON.parse(row.coordinates) as [number, number][][],
            deveui: row.deveui,
            lora_durum: row.durum,
          });
        }
      } catch {
        // lora_cihaz yoksa sayaç sonuçlarıyla devam
      }
    }

    return NextResponse.json(results.slice(0, 25));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Arama hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
