import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureLoraSchema } from "@/lib/lora-cihaz-db";
import { ensureSayacKonumSchema } from "@/lib/sayac-konum-db";

function getDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  ensureLoraSchema(db);
  ensureSayacKonumSchema(db);
  return db;
}

export async function GET() {
  try {
    const db = getDb();
    const ozet = db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM binalar) AS toplam_bina,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS maski_sayac,
        (SELECT COUNT(*) FROM sayac) AS birim_kaydi,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS abone_nolu,
        (SELECT COUNT(*) FROM lora_cihaz) AS lora_toplam,
        (SELECT COUNT(*) FROM lora_cihaz WHERE LOWER(durum)='active') AS lora_aktif,
        (SELECT COUNT(*) FROM lora_cihaz WHERE LOWER(durum)='registered') AS lora_kayitli,
        (SELECT COUNT(*) FROM lora_cihaz WHERE LOWER(durum)='error') AS lora_hata,
        (SELECT COUNT(*) FROM lora_cihaz WHERE bina_id IS NOT NULL) AS lora_eslesen,
        (SELECT COUNT(DISTINCT bina_id) FROM lora_cihaz WHERE bina_id IS NOT NULL) AS lora_bina,
        (SELECT COUNT(*) FROM sayac_konum) AS konum_toplam,
        (SELECT COUNT(*) FROM sayac_konum WHERE bina_id IS NOT NULL) AS konum_eslesen,
        (SELECT COUNT(*) FROM sayac_konum WHERE TRIM(COALESCE(sayac_id_matched,'')) = '') AS konum_yeni,
        (SELECT COUNT(*) FROM sayac WHERE lat IS NOT NULL AND lng IS NOT NULL) AS sayac_koordinatli
    `
      )
      .get() as {
      toplam_bina: number;
      maski_sayac: number;
      birim_kaydi: number;
      abone_nolu: number;
      lora_toplam: number;
      lora_aktif: number;
      lora_kayitli: number;
      lora_hata: number;
      lora_eslesen: number;
      lora_bina: number;
      konum_toplam: number;
      konum_eslesen: number;
      konum_yeni: number;
      sayac_koordinatli: number;
    };

    // Toplam = MASKİ kayıtları + konum Excel'inden henüz sayac tablosunda olmayanlar
    const toplam_sayac = (ozet.maski_sayac || 0) + (ozet.konum_yeni || 0);

    return NextResponse.json({
      ...ozet,
      toplam_sayac,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Özet yüklenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
