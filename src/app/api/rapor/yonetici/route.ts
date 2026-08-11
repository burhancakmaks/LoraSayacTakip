import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { ensureSayacKonumSchema } from "@/lib/sayac-konum-db";
import { ensureLoraSchema } from "@/lib/lora-cihaz-db";

function getDb() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
  ensureSayacKonumSchema(db);
  ensureLoraSchema(db);
  return db;
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function cleanBolge(raw: string | null | undefined) {
  const v = String(raw ?? "").trim();
  if (!v) return "Ada atanmamış";
  return (
    v
      .replace(/\s+/g, " ")
      .replace(/MULTIPOLYGON.*/i, "")
      .replace(/\[\d+\s*adet\]/gi, "")
      .trim() || "Ada atanmamış"
  );
}

function loadUzaktanStats() {
  const filePath = path.join(process.cwd(), "data", "uzaktan-sozlesme-index.json");
  if (!existsSync(filePath)) return null;
  try {
    const index = JSON.parse(readFileSync(filePath, "utf8")) as {
      stats?: {
        matched_sayac?: number;
        matched_bina?: number;
        excel_unique_meters?: number;
        unmatched_excel_meters?: number;
      };
    };
    return index.stats ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const db = getDb();
    const uzaktan = loadUzaktanStats();

    const ozet = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM binalar) AS toplam_bina,
          (SELECT COUNT(DISTINCT bina_id) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS sayacli_bina,
          (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS toplam_sayac,
          (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS abone_nolu,
          (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '' AND TRIM(COALESCE(abone_no,'')) = '') AS abonesiz,
          (SELECT COUNT(DISTINCT TRIM(abone_no)) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS benzersiz_abone,
          (SELECT COUNT(*) FROM sayac WHERE lat IS NOT NULL AND lng IS NOT NULL) AS koordinatli,
          (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '' AND (lat IS NULL OR lng IS NULL)) AS koordinatsiz,
          (SELECT COUNT(*) FROM sayac_konum) AS excel_konum,
          (SELECT COUNT(DISTINCT TRIM(agreement_number)) FROM sayac_konum WHERE TRIM(COALESCE(agreement_number,'')) != '') AS sozlesme,
          (SELECT COUNT(*) FROM sayac_konum WHERE TRIM(COALESCE(sayac_id_matched,'')) != '') AS konum_eslesen,
          (SELECT COUNT(*) FROM sayac_konum WHERE TRIM(COALESCE(sayac_id_matched,'')) = '') AS konum_yeni,
          (SELECT COUNT(*) FROM lora_cihaz) AS lora_toplam,
          (SELECT COUNT(*) FROM lora_cihaz WHERE bina_id IS NOT NULL) AS lora_eslesen,
          (SELECT COUNT(*) FROM lora_cihaz WHERE LOWER(durum)='active') AS lora_aktif,
          (SELECT COUNT(*) FROM sayac WHERE date(updated_at)=date('now','localtime') AND TRIM(COALESCE(sayac_id,'')) != '') AS bugun_guncellenen,
          (SELECT COUNT(*) FROM sayac_konum WHERE meter_type='BAYLAN_LORA_W') AS baylan,
          (SELECT COUNT(*) FROM sayac_konum WHERE meter_type='POLIMETER_LORA_W') AS polimeter
      `
      )
      .get() as {
      toplam_bina: number;
      sayacli_bina: number;
      toplam_sayac: number;
      abone_nolu: number;
      abonesiz: number;
      benzersiz_abone: number;
      koordinatli: number;
      koordinatsiz: number;
      excel_konum: number;
      sozlesme: number;
      konum_eslesen: number;
      konum_yeni: number;
      lora_toplam: number;
      lora_eslesen: number;
      lora_aktif: number;
      bugun_guncellenen: number;
      baylan: number;
      polimeter: number;
    };

    const tipRows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN meter_type = 'BAYLAN_LORA_W' THEN 'Baylan'
            WHEN meter_type = 'POLIMETER_LORA_W' THEN 'Polimeter'
            WHEN meter_type = 'BRT METER LORA' THEN 'BRT'
            ELSE COALESCE(NULLIF(TRIM(meter_type), ''), 'Diğer')
          END AS tip,
          COUNT(*) AS adet
        FROM sayac_konum
        GROUP BY tip
        ORDER BY adet DESC
      `
      )
      .all() as Array<{ tip: string; adet: number }>;

    const bolgeRows = db
      .prepare(
        `
        SELECT
          COALESCE(NULLIF(TRIM(bb.ada_parsel), ''), 'Ada atanmamış') AS bolge,
          COUNT(*) AS sayac,
          COUNT(DISTINCT s.bina_id) AS bina,
          SUM(CASE WHEN TRIM(COALESCE(s.abone_no,'')) != '' THEN 1 ELSE 0 END) AS abone,
          SUM(CASE WHEN s.lat IS NOT NULL AND s.lng IS NOT NULL THEN 1 ELSE 0 END) AS koordinatli
        FROM sayac s
        LEFT JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
        WHERE TRIM(COALESCE(s.sayac_id, '')) != ''
        GROUP BY bolge
        ORDER BY sayac DESC
      `
      )
      .all() as Array<{
      bolge: string;
      sayac: number;
      bina: number;
      abone: number;
      koordinatli: number;
    }>;

    const merged = new Map<
      string,
      { bolge: string; sayac: number; bina: number; abone: number; koordinatli: number }
    >();
    for (const r of bolgeRows) {
      const bolge = cleanBolge(r.bolge);
      const cur = merged.get(bolge);
      if (!cur) {
        merged.set(bolge, {
          bolge,
          sayac: r.sayac,
          bina: r.bina,
          abone: r.abone,
          koordinatli: r.koordinatli,
        });
        continue;
      }
      cur.sayac += r.sayac;
      cur.bina += r.bina;
      cur.abone += r.abone;
      cur.koordinatli += r.koordinatli;
    }

    const bolgeList = [...merged.values()]
      .map((r) => ({
        ...r,
        oran: pct(r.sayac, ozet.toplam_sayac),
        abone_oran: pct(r.abone, r.sayac),
        koordinat_oran: pct(r.koordinatli, r.sayac),
        sayac_per_bina: r.bina ? Math.round((r.sayac / r.bina) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.sayac - a.sayac);

    const markaRows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN TRIM(COALESCE(sayac_markasi,'')) = '' THEN 'MASKİ / tanımsız'
            ELSE TRIM(sayac_markasi)
          END AS marka,
          COUNT(*) AS adet
        FROM sayac
        WHERE TRIM(COALESCE(sayac_id,'')) != ''
        GROUP BY marka
        ORDER BY adet DESC
      `
      )
      .all() as Array<{ marka: string; adet: number }>;

    const kapsama_bina = pct(ozet.sayacli_bina, ozet.toplam_bina);
    const kapsama_koordinat = pct(ozet.koordinatli, ozet.toplam_sayac);
    const kapsama_abone = pct(ozet.abone_nolu, ozet.toplam_sayac);
    const kapsama_konum = pct(ozet.konum_eslesen, Math.max(ozet.excel_konum, 1));

    // 0–100 operasyon olgunluk skoru
    const hazirlik = Math.round(
      kapsama_bina * 0.25 +
        kapsama_koordinat * 0.3 +
        kapsama_abone * 0.2 +
        kapsama_konum * 0.25
    );

    const insights: string[] = [];
    if (bolgeList[0]) {
      insights.push(
        `En yoğun bölge: ${bolgeList[0].bolge} (${bolgeList[0].sayac.toLocaleString("tr-TR")} sayaç, %${bolgeList[0].oran}).`
      );
    }
    const atanmamis = bolgeList.find((b) => b.bolge === "Ada atanmamış");
    if (atanmamis && atanmamis.oran >= 10) {
      insights.push(
        `Ada bilgisi eksik: ${atanmamis.sayac.toLocaleString("tr-TR")} sayaç (%${atanmamis.oran}).`
      );
    }
    if (ozet.koordinatsiz > 0) {
      insights.push(
        `Koordinatsız kayıt: ${ozet.koordinatsiz.toLocaleString("tr-TR")} sayaç — saha pini eksik.`
      );
    }
    if (ozet.konum_yeni > 0) {
      insights.push(
        `Excel’de olup henüz binaya işlenmeyen: ${ozet.konum_yeni.toLocaleString("tr-TR")} konum.`
      );
    }
    if (uzaktan?.matched_sayac) {
      insights.push(
        `Uzaktan okuma eşleşmesi: ${uzaktan.matched_sayac.toLocaleString("tr-TR")} sayaç / ${uzaktan.matched_bina?.toLocaleString("tr-TR") ?? "—"} bina.`
      );
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      title: "Lora Sayaç Takip — Yönetici Özeti",
      ozet_cumle: `${ozet.toplam_sayac.toLocaleString("tr-TR")} kayıtlı sayaç · ${ozet.sozlesme.toLocaleString("tr-TR")} sözleşme · ${ozet.sayacli_bina.toLocaleString("tr-TR")} yeşil bina`,
      kpis: {
        toplam_sayac: ozet.toplam_sayac,
        sozlesme: ozet.sozlesme,
        excel_konum: ozet.excel_konum,
        abone_nolu: ozet.abone_nolu,
        abonesiz: ozet.abonesiz,
        benzersiz_abone: ozet.benzersiz_abone,
        koordinatli: ozet.koordinatli,
        koordinatsiz: ozet.koordinatsiz,
        toplam_bina: ozet.toplam_bina,
        sayacli_bina: ozet.sayacli_bina,
        konum_eslesen: ozet.konum_eslesen,
        konum_yeni: ozet.konum_yeni,
        lora_toplam: ozet.lora_toplam,
        lora_eslesen: ozet.lora_eslesen,
        lora_aktif: ozet.lora_aktif,
        bugun_guncellenen: ozet.bugun_guncellenen,
        baylan: ozet.baylan,
        polimeter: ozet.polimeter,
        sayac_per_bina: ozet.sayacli_bina
          ? Math.round((ozet.toplam_sayac / ozet.sayacli_bina) * 10) / 10
          : 0,
        kapsama_sayacli_bina: kapsama_bina,
        kapsama_koordinat: kapsama_koordinat,
        kapsama_abone: kapsama_abone,
        kapsama_konum: kapsama_konum,
        kapsama_sozlesme: pct(ozet.sozlesme, Math.max(ozet.excel_konum, 1)),
        hazirlik_skoru: hazirlik,
      },
      uzaktan: uzaktan
        ? {
            matched_sayac: uzaktan.matched_sayac ?? 0,
            matched_bina: uzaktan.matched_bina ?? 0,
            excel_unique: uzaktan.excel_unique_meters ?? 0,
            unmatched: uzaktan.unmatched_excel_meters ?? 0,
          }
        : null,
      tip_dagilimi: tipRows.map((r) => ({
        tip: r.tip,
        adet: r.adet,
        oran: pct(r.adet, ozet.excel_konum),
      })),
      marka_dagilimi: markaRows.map((r) => ({
        marka: r.marka,
        adet: r.adet,
        oran: pct(r.adet, ozet.toplam_sayac),
      })),
      bolgeler: bolgeList,
      top_bolgeler: bolgeList.slice(0, 5),
      insights,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Rapor oluşturulamadı";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
