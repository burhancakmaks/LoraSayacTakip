import { NextRequest, NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function openDatabase() {
  return new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"));
}

export async function GET(request: NextRequest) {
  const db = openDatabase();
  try {
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 50)));
    const search = (params.get("search") || "").trim();
    const ada = (params.get("ada") || "").trim();
    const blok = (params.get("blok") || "").trim();
    const durum = (params.get("durum") || "").trim();

    if (params.get("summary") === "1") {
      const totals = db.prepare(`
        SELECT
          COUNT(*) AS toplam_kayit,
          COUNT(DISTINCT NULLIF(abone_no, '')) AS benzersiz_abone,
          COUNT(DISTINCT NULLIF(sayac_no, '')) AS benzersiz_sayac,
          SUM(CASE WHEN abone_no = '' THEN 1 ELSE 0 END) AS eksik_abone,
          SUM(CASE WHEN sayac_no = '' THEN 1 ELSE 0 END) AS eksik_sayac,
          COUNT(DISTINCT NULLIF(ada, '')) AS bolge_sayisi,
          COUNT(DISTINCT NULLIF(mahalle, '')) AS mahalle_sayisi
        FROM excel_abonelikler
      `).get();
      const byRegion = db.prepare(`
        SELECT ada, COUNT(*) AS kayit, COUNT(DISTINCT NULLIF(abone_no, '')) AS abone,
               COUNT(DISTINCT NULLIF(sayac_no, '')) AS sayac
        FROM excel_abonelikler GROUP BY ada ORDER BY kayit DESC
      `).all();
      const byStatus = db.prepare(`
        SELECT COALESCE(NULLIF(durum, ''), 'Belirtilmemiş') AS durum, COUNT(*) AS adet
        FROM excel_abonelikler GROUP BY durum ORDER BY adet DESC
      `).all();
      return NextResponse.json({ totals, byRegion, byStatus });
    }

    const filters: string[] = [];
    const values: Array<string | number> = [];
    if (search) {
      filters.push(`(abone_no LIKE ? OR sayac_no LIKE ? OR adres LIKE ? OR ad_soyad LIKE ? OR mahalle LIKE ?)`);
      const pattern = `%${search}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
    if (ada) { filters.push("ada = ?"); values.push(ada); }
    if (blok) { filters.push("blok = ?"); values.push(blok); }
    if (durum) { filters.push("durum = ?"); values.push(durum); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM excel_abonelikler ${where}`).get(...values) as { count: number }).count);
    const rows = db.prepare(`
      SELECT kayit_id, excel_satir_no, ada, blok, kat, daire, ad_soyad,
             abone_no, sayac_no, adres, mahalle, kaynak_dosya, durum, bina_id
      FROM excel_abonelikler ${where}
      ORDER BY excel_satir_no
      LIMIT ? OFFSET ?
    `).all(...values, limit, (page - 1) * limit);

    return NextResponse.json({ page, limit, total, totalPages: Math.ceil(total / limit), rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bilinmeyen hata" }, { status: 500 });
  } finally {
    db.close();
  }
}
