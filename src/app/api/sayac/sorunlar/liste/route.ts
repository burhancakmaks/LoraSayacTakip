import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { SayacDurum } from "@/lib/sayac-durum";
import { resolveBinaDisplayName } from "@/lib/bina-display-name";

const VALID_DURUM: SayacDurum[] = ["eksik", "okunmadi", "hatali"];

function getDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  try {
    db.exec(`ALTER TABLE sayac ADD COLUMN sayac_durum TEXT DEFAULT 'gecerli'`);
  } catch {}
  return db;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const durumParam = (searchParams.get("durum") || "all").toLowerCase();
    const q = (searchParams.get("q") || "").trim().toLocaleLowerCase("tr-TR");

    const db = getDb();

    let rows: Array<{
      id: number;
      bina_id: number;
      birim_no: number;
      blok_no: string;
      kat: string;
      kapi_no: string;
      kullanilis_sekli: string;
      sayac_id: string;
      sayac_durum: SayacDurum;
      building_name: string | null;
      layer: string | null;
      oda_id: number | null;
      coordinates: string;
    }>;

    if (durumParam === "okuma") {
      rows = db
        .prepare(
          `
        SELECT
          s.id, s.bina_id, s.birim_no, s.blok_no, s.kat, s.kapi_no, s.kullanilis_sekli, s.sayac_id,
          COALESCE(s.sayac_durum, 'gecerli') AS sayac_durum,
          b.value AS building_name, b.layer, b.oda_id, b.coordinates
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        WHERE COALESCE(s.sayac_durum, 'gecerli') IN ('okunmadi', 'hatali')
        ORDER BY b.value COLLATE NOCASE, s.blok_no, s.kapi_no, s.kullanilis_sekli
      `
        )
        .all() as typeof rows;
    } else if (durumParam !== "all" && VALID_DURUM.includes(durumParam as SayacDurum)) {
      rows = db
        .prepare(
          `
        SELECT
          s.id, s.bina_id, s.birim_no, s.blok_no, s.kat, s.kapi_no, s.kullanilis_sekli, s.sayac_id,
          COALESCE(s.sayac_durum, 'gecerli') AS sayac_durum,
          b.value AS building_name, b.layer, b.oda_id, b.coordinates
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        WHERE COALESCE(s.sayac_durum, 'gecerli') = ?
        ORDER BY b.value COLLATE NOCASE, s.blok_no, s.kapi_no, s.kullanilis_sekli
      `
        )
        .all(durumParam) as typeof rows;
    } else {
      rows = db
        .prepare(
          `
        SELECT
          s.id, s.bina_id, s.birim_no, s.blok_no, s.kat, s.kapi_no, s.kullanilis_sekli, s.sayac_id,
          COALESCE(s.sayac_durum, 'gecerli') AS sayac_durum,
          b.value AS building_name, b.layer, b.oda_id, b.coordinates
        FROM sayac s
        JOIN binalar b ON b.id = s.bina_id
        WHERE COALESCE(s.sayac_durum, 'gecerli') IN ('eksik', 'okunmadi', 'hatali')
        ORDER BY b.value COLLATE NOCASE, s.blok_no, s.kapi_no, s.kullanilis_sekli
      `
        )
        .all() as typeof rows;
    }

    let items = rows.map((row) => ({
      id: row.id,
      bina_id: row.bina_id,
      birim_no: row.birim_no,
      blok_no: row.blok_no || "",
      kat: row.kat || "",
      kapi_no: row.kapi_no || "",
      kullanilis_sekli: row.kullanilis_sekli || "",
      sayac_id: row.sayac_id || "",
      sayac_durum: row.sayac_durum,
      building_name: resolveBinaDisplayName(row.building_name, {
        blokNo: row.blok_no,
        binaId: row.bina_id,
      }),
      layer: row.layer,
      oda_id: row.oda_id,
      coordinates: JSON.parse(row.coordinates) as [number, number][][],
    }));

    if (q) {
      items = items.filter((item) => {
        const haystack = [
          item.building_name,
          item.blok_no,
          item.kapi_no,
          item.kat,
          item.kullanilis_sekli,
          item.sayac_id,
        ]
          .join(" ")
          .toLocaleLowerCase("tr-TR");
        return haystack.includes(q);
      });
    }

    const ozetRows = db
      .prepare(
        `
        SELECT COALESCE(sayac_durum, 'gecerli') AS durum, COUNT(*) AS c
        FROM sayac s
        WHERE COALESCE(s.sayac_durum, 'gecerli') IN ('eksik', 'okunmadi', 'hatali')
        GROUP BY durum
      `
      )
      .all() as { durum: SayacDurum; c: number }[];

    const ozetMap: Record<"eksik" | "okunmadi" | "hatali", number> = { eksik: 0, okunmadi: 0, hatali: 0 };
    for (const row of ozetRows) {
      if (row.durum in ozetMap) ozetMap[row.durum as keyof typeof ozetMap] = row.c;
    }

    const ozet = {
      toplam: ozetMap.eksik + ozetMap.okunmadi + ozetMap.hatali,
      eksik: ozetMap.eksik,
      okunmadi: ozetMap.okunmadi,
      hatali: ozetMap.hatali,
      gosterilen: items.length,
    };

    return NextResponse.json({ ozet, items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Liste hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
