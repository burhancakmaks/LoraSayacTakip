import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { loadUzaktanSozlesmeIndex } from "@/lib/uzaktan-sozlesme-index";
import { getUzaktanTypeLabel } from "@/lib/uzaktan-sozlesme";

type RegionRow = {
  bolge: string | null;
  bina_sayisi: number;
  sayac_sayisi: number;
  abone_sayisi: number;
};

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
}

function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function loadSozlesmeOzet() {
  try {
    const index = loadUzaktanSozlesmeIndex();
    const matchedAgreementNumbers = new Set<string>();

    Object.values(index.binalar).forEach((entry) => {
      entry.sayaclar.forEach((sayac) => {
        const detay = sayac as typeof sayac & { agreement_number?: string };
        const agreement = String(detay.agreement_number ?? "").trim();
        if (agreement) matchedAgreementNumbers.add(agreement);
      });
    });

    const uzaktanTipler = Object.entries(index.stats.matched_by_type ?? {})
      .map(([type, count]) => ({
        type,
        label: getUzaktanTypeLabel(type),
        count: count ?? 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      toplam_sozlesme: index.stats.excel_rows ?? 0,
      eslesen_sozlesme: matchedAgreementNumbers.size,
      uzaktan_eslesen_sayac: index.stats.matched_sayac ?? 0,
      uzaktan_eslesen_bina: index.stats.matched_bina ?? 0,
      uzaktan_excel_sayac: index.stats.excel_unique_meters ?? 0,
      uzaktan_tipler: uzaktanTipler,
      built_at: index.built_at || null,
    };
  } catch {
    return {
      toplam_sozlesme: 0,
      eslesen_sozlesme: 0,
      uzaktan_eslesen_sayac: 0,
      uzaktan_eslesen_bina: 0,
      uzaktan_excel_sayac: 0,
      uzaktan_tipler: [] as Array<{ type: string; label: string; count: number }>,
      built_at: null as string | null,
    };
  }
}

export async function GET() {
  try {
    const db = getDb();
    const sozlesmeOzet = loadSozlesmeOzet();

    const summary = db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM binalar) AS toplam_bina,
          (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id, '')) != '') AS toplam_sayac,
          (SELECT COUNT(DISTINCT TRIM(abone_no)) FROM sayac WHERE TRIM(COALESCE(abone_no, '')) != '') AS toplam_abone,
          (SELECT COUNT(*) FROM sayac) AS toplam_birim_kaydi,
          (SELECT COUNT(*) FROM bina_bilgi) AS yapilandirilmis_bina,
          (SELECT COUNT(DISTINCT bina_id) FROM sayac WHERE TRIM(COALESCE(sayac_id, '')) != '') AS sayacli_bina,
          (SELECT COALESCE(SUM(toplam_bagımsız_bolum), 0) FROM bina_bilgi) AS beklenen_birim
      `
      )
      .get() as {
      toplam_bina: number;
      toplam_sayac: number;
      toplam_abone: number;
      toplam_birim_kaydi: number;
      yapilandirilmis_bina: number;
      sayacli_bina: number;
      beklenen_birim: number;
    };

    const sayacDurum = db
      .prepare(
        `
        SELECT
          SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'gecerli' AND TRIM(COALESCE(sayac_id, '')) != '' THEN 1 ELSE 0 END) AS gecerli,
          SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'eksik' THEN 1 ELSE 0 END) AS eksik,
          SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'okunmadi' THEN 1 ELSE 0 END) AS okunmadi,
          SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'hatali' THEN 1 ELSE 0 END) AS hatali
        FROM sayac
      `
      )
      .get() as { gecerli: number; eksik: number; okunmadi: number; hatali: number };

    const sorunOzet = db
      .prepare(
        `
        SELECT
          COUNT(*) AS sorunlu_bina,
          SUM(CASE WHEN okunmadi > 0 OR hatali > 0 THEN 1 ELSE 0 END) AS kritik_bina,
          SUM(CASE WHEN eksik > 0 AND okunmadi = 0 AND hatali = 0 THEN 1 ELSE 0 END) AS eksik_bina,
          SUM(okunmadi + eksik + hatali) AS toplam_sorun
        FROM (
          SELECT
            bina_id,
            SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'okunmadi' THEN 1 ELSE 0 END) AS okunmadi,
            SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'eksik' THEN 1 ELSE 0 END) AS eksik,
            SUM(CASE WHEN COALESCE(sayac_durum, 'gecerli') = 'hatali' THEN 1 ELSE 0 END) AS hatali
          FROM sayac
          GROUP BY bina_id
          HAVING okunmadi > 0 OR eksik > 0 OR hatali > 0
        )
      `
      )
      .get() as { sorunlu_bina: number; kritik_bina: number; eksik_bina: number; toplam_sorun: number };

    const aktivite = db
      .prepare(
        `
        SELECT
          COUNT(*) AS bugun_guncellenen_sayac,
          COUNT(DISTINCT bina_id) AS bugun_guncellenen_bina
        FROM sayac
        WHERE date(updated_at) = date('now', 'localtime')
          AND TRIM(COALESCE(sayac_id, '')) != ''
      `
      )
      .get() as { bugun_guncellenen_sayac: number; bugun_guncellenen_bina: number };

    const regions = db
      .prepare(
        `
        SELECT
          COALESCE(NULLIF(TRIM(b.layer), ''), 'Tanımsız Bölge') AS bolge,
          COUNT(DISTINCT b.id) AS bina_sayisi,
          SUM(CASE WHEN TRIM(COALESCE(s.sayac_id, '')) != '' THEN 1 ELSE 0 END) AS sayac_sayisi,
          COUNT(DISTINCT CASE WHEN TRIM(COALESCE(s.abone_no, '')) != '' THEN TRIM(s.abone_no) END) AS abone_sayisi
        FROM binalar b
        LEFT JOIN sayac s ON s.bina_id = b.id
        GROUP BY COALESCE(NULLIF(TRIM(b.layer), ''), 'Tanımsız Bölge')
        ORDER BY sayac_sayisi DESC, abone_sayisi DESC, bolge COLLATE NOCASE ASC
      `
      )
      .all() as RegionRow[];

    const topRegion = regions[0] ?? null;
    const aboneKapsamaOrani = pct(summary.toplam_abone, summary.toplam_sayac);
    const binaYapilandirmaOrani = pct(summary.yapilandirilmis_bina, summary.toplam_bina);
    const sayacSaglikOrani = pct(sayacDurum.gecerli ?? 0, summary.toplam_sayac);
    const sozlesmeEslesmeOrani = pct(sozlesmeOzet.uzaktan_eslesen_sayac, sozlesmeOzet.uzaktan_excel_sayac);
    const birimDolulukOrani = pct(summary.toplam_sayac, summary.beklenen_birim || summary.toplam_birim_kaydi);

    const regionItems = regions.map((region) => ({
      bolge: region.bolge || "Tanımsız Bölge",
      bina_sayisi: region.bina_sayisi || 0,
      sayac_sayisi: region.sayac_sayisi || 0,
      abone_sayisi: region.abone_sayisi || 0,
      abone_orani: pct(region.abone_sayisi, region.sayac_sayisi),
      sayac_payi: pct(region.sayac_sayisi, summary.toplam_sayac),
    }));

    const insights: string[] = [];

    if (topRegion) {
      insights.push(
        `${topRegion.bolge} bölgesi toplam sayaç hacminin %${pct(topRegion.sayac_sayisi || 0, summary.toplam_sayac).toLocaleString("tr-TR")}'ini taşıyor.`
      );
    }

    if (aboneKapsamaOrani < 80) {
      insights.push(`Abone eşleşme oranı %${aboneKapsamaOrani.toLocaleString("tr-TR")} seviyesinde; saha doğrulama önceliklendirilebilir.`);
    } else {
      insights.push(`Abone görünürlüğü %${aboneKapsamaOrani.toLocaleString("tr-TR")} ile güçlü bir operasyonel taban sunuyor.`);
    }

    if ((sorunOzet.toplam_sorun ?? 0) > 0) {
      insights.push(
        `${sorunOzet.sorunlu_bina} binada toplam ${sorunOzet.toplam_sorun} kayıt sorunlu; ${sorunOzet.kritik_bina} bina kritik öncelikte.`
      );
    } else {
      insights.push("Saha veri kalitesi açısından kritik sayaç sorunu görünmüyor.");
    }

    if (sozlesmeOzet.uzaktan_excel_sayac > 0) {
      insights.push(
        `Uzaktan okuma envanterinin %${sozlesmeEslesmeOrani.toLocaleString("tr-TR")}'i harita üzerinde eşleşmiş durumda.`
      );
    }

    if ((aktivite.bugun_guncellenen_sayac ?? 0) > 0) {
      insights.push(
        `Bugün ${aktivite.bugun_guncellenen_sayac} sayaç kaydı güncellendi (${aktivite.bugun_guncellenen_bina} bina).`
      );
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      summary: {
        toplam_bina: summary.toplam_bina,
        toplam_sayac: summary.toplam_sayac,
        toplam_abone: summary.toplam_abone,
        toplam_birim_kaydi: summary.toplam_birim_kaydi,
        yapilandirilmis_bina: summary.yapilandirilmis_bina,
        sayacli_bina: summary.sayacli_bina,
        beklenen_birim: summary.beklenen_birim,
        toplam_sozlesme: sozlesmeOzet.toplam_sozlesme,
        eslesen_sozlesme: sozlesmeOzet.eslesen_sozlesme,
        uzaktan_eslesen_sayac: sozlesmeOzet.uzaktan_eslesen_sayac,
        uzaktan_eslesen_bina: sozlesmeOzet.uzaktan_eslesen_bina,
        uzaktan_excel_sayac: sozlesmeOzet.uzaktan_excel_sayac,
        abone_kapsama_orani: aboneKapsamaOrani,
        bina_yapilandirma_orani: binaYapilandirmaOrani,
        sayac_saglik_orani: sayacSaglikOrani,
        sozlesme_eslesme_orani: sozlesmeEslesmeOrani,
        birim_doluluk_orani: birimDolulukOrani,
      },
      sayac_durum: {
        gecerli: sayacDurum.gecerli ?? 0,
        eksik: sayacDurum.eksik ?? 0,
        okunmadi: sayacDurum.okunmadi ?? 0,
        hatali: sayacDurum.hatali ?? 0,
      },
      sorunlar: {
        sorunlu_bina: sorunOzet.sorunlu_bina ?? 0,
        kritik_bina: sorunOzet.kritik_bina ?? 0,
        eksik_bina: sorunOzet.eksik_bina ?? 0,
        toplam_sorun: sorunOzet.toplam_sorun ?? 0,
      },
      aktivite: {
        bugun_guncellenen_sayac: aktivite.bugun_guncellenen_sayac ?? 0,
        bugun_guncellenen_bina: aktivite.bugun_guncellenen_bina ?? 0,
      },
      uzaktan: {
        built_at: sozlesmeOzet.built_at,
        tipler: sozlesmeOzet.uzaktan_tipler,
      },
      highlights: {
        lider_bolge: topRegion
          ? {
              bolge: topRegion.bolge || "Tanımsız Bölge",
              sayac_sayisi: topRegion.sayac_sayisi || 0,
              abone_sayisi: topRegion.abone_sayisi || 0,
              sayac_payi: pct(topRegion.sayac_sayisi || 0, summary.toplam_sayac),
            }
          : null,
      },
      insights,
      regions: regionItems,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Yönetici raporu yüklenemedi";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
