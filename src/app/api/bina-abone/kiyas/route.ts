import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { resolveBinaDisplayName } from "@/lib/bina-display-name";

type KiyasDurum = "uyumlu" | "eksik_sayac" | "fazla_sayac" | "eksik_abone" | "coklu_sorun";

function getDb() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get("filter") || "all").toLowerCase();
    const q = (searchParams.get("q") || "").trim().toLocaleLowerCase("tr-TR");

    const db = getDb();

    const ozet = db
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM binalar) AS toplam_bina,
        (SELECT COUNT(*) FROM bina_bilgi) AS yapilandirilmis_bina,
        (SELECT COUNT(*) FROM sayac) AS toplam_sayac,
        (SELECT COUNT(DISTINCT bina_id) FROM sayac) AS sayacli_bina,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(sayac_id,'')) != '') AS sayac_nolu,
        (SELECT COUNT(*) FROM sayac WHERE TRIM(COALESCE(abone_no,'')) != '') AS abone_nolu,
        (SELECT COALESCE(SUM(toplam_bagımsız_bolum), 0) FROM bina_bilgi) AS beklenen_birim
    `
      )
      .get() as {
      toplam_bina: number;
      yapilandirilmis_bina: number;
      toplam_sayac: number;
      sayacli_bina: number;
      sayac_nolu: number;
      abone_nolu: number;
      beklenen_birim: number;
    };

    const rows = db
      .prepare(
        `
      SELECT
        b.id AS bina_id,
        b.value,
        b.layer,
        bb.ada_parsel,
        bb.sokak,
        bb.toplam_bagımsız_bolum AS beklenen,
        (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id) AS sayac_sayisi,
        (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id AND TRIM(COALESCE(s.sayac_id,'')) != '') AS sayac_dolu,
        (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id AND TRIM(COALESCE(s.abone_no,'')) != '') AS abone_sayisi
      FROM binalar b
      JOIN bina_bilgi bb ON bb.bina_id = b.id
      ORDER BY ABS(
        (SELECT COUNT(*) FROM sayac s WHERE s.bina_id = b.id) - bb.toplam_bagımsız_bolum
      ) DESC, b.value COLLATE NOCASE
    `
      )
      .all() as Array<{
      bina_id: number;
      value: string | null;
      layer: string | null;
      ada_parsel: string | null;
      sokak: string | null;
      beklenen: number;
      sayac_sayisi: number;
      sayac_dolu: number;
      abone_sayisi: number;
    }>;

    let uyumlu = 0;
    let eksikSayac = 0;
    let fazlaSayac = 0;
    let eksikAbone = 0;

    let items = rows.map((row) => {
      const farkSayac = row.sayac_sayisi - row.beklenen;
      const farkAbone = row.abone_sayisi - row.beklenen;
      const sorunlar: string[] = [];
      let durum: KiyasDurum = "uyumlu";

      if (farkSayac < 0) {
        sorunlar.push("eksik_sayac");
        eksikSayac++;
      } else if (farkSayac > 0) {
        sorunlar.push("fazla_sayac");
        fazlaSayac++;
      }

      if (farkAbone < 0) {
        sorunlar.push("eksik_abone");
        eksikAbone++;
      }

      if (sorunlar.length === 0) uyumlu++;
      else if (sorunlar.length > 1) durum = "coklu_sorun";
      else durum = sorunlar[0] as KiyasDurum;

      return {
        bina_id: row.bina_id,
        building_name: resolveBinaDisplayName(row.value, { binaId: row.bina_id }),
        layer: row.layer,
        ada_parsel: row.ada_parsel || "",
        sokak: row.sokak || "",
        beklenen: row.beklenen,
        sayac_sayisi: row.sayac_sayisi,
        sayac_dolu: row.sayac_dolu,
        abone_sayisi: row.abone_sayisi,
        fark_sayac: farkSayac,
        fark_abone: farkAbone,
        durum,
        sorunlar,
      };
    });

    if (filter === "uyumsuz") {
      items = items.filter((i) => i.durum !== "uyumlu");
    } else if (filter === "eksik_sayac") {
      items = items.filter((i) => i.sorunlar.includes("eksik_sayac"));
    } else if (filter === "fazla_sayac") {
      items = items.filter((i) => i.sorunlar.includes("fazla_sayac"));
    } else if (filter === "eksik_abone") {
      items = items.filter((i) => i.sorunlar.includes("eksik_abone"));
    } else if (filter === "uyumlu") {
      items = items.filter((i) => i.durum === "uyumlu");
    }

    if (q) {
      items = items.filter((item) =>
        [item.building_name, item.ada_parsel, item.sokak, item.layer]
          .join(" ")
          .toLocaleLowerCase("tr-TR")
          .includes(q)
      );
    }

    return NextResponse.json({
      ozet: {
        ...ozet,
        kiyas_bina: rows.length,
        uyumlu,
        eksik_sayac: eksikSayac,
        fazla_sayac: fazlaSayac,
        eksik_abone: eksikAbone,
        uyumsuz: rows.length - uyumlu,
        gosterilen: items.length,
      },
      items,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Kıyas hatası";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
