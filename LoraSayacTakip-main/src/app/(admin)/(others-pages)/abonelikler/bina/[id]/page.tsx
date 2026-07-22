import Link from "next/link";
import { notFound } from "next/navigation";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

type ExcelRow = {
  kayit_id: string; excel_satir_no: number; ada: string; blok: string; kat: string;
  daire: string; ad_soyad: string; abone_no: string; sayac_no: string; adres: string;
  mahalle: string; kaynak_dosya: string; durum: string;
};

export default async function BuildingExcelRecordsPage({ params }: { params: Promise<{ id: string }> }) {
  const buildingId = Number((await params).id);
  if (!Number.isInteger(buildingId) || buildingId <= 0) notFound();
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT kayit_id, excel_satir_no, ada, blok, kat, daire, ad_soyad, abone_no,
             sayac_no, adres, mahalle, kaynak_dosya, durum
      FROM excel_abonelikler WHERE bina_id = ? ORDER BY excel_satir_no
    `).all(buildingId) as unknown as ExcelRow[];
    const building = db.prepare("SELECT id, value FROM binalar WHERE id = ?").get(buildingId) as { id: number; value: string } | undefined;

    // Excel satırları bina kaydından bağımsız olarak da görüntülenebilsin. İçe
    // aktarılmış bir Excel kaydı eski/silinmiş bir bina kimliğine bağlıysa sayfayı
    // 404'e düşürmek kullanıcının mevcut kaynak kayıtlarına erişimini engelliyordu.
    const buildingTitle = building?.value || rows[0]?.adres || `Bina #${buildingId}`;

    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Excel Kaynak Kayıtları</p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">{buildingTitle}</h1>
            <p className="text-sm text-gray-500">Bu konuma bağlı {rows.length.toLocaleString("tr-TR")} Excel satırının tamamı</p>
          </div>
          <div className="flex gap-2">
            <Link href="/map" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white">Haritaya Dön</Link>
            <Link href="/abonelikler" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-700">Tüm Kayıtlar</Link>
          </div>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="min-w-[1400px] w-full text-left text-xs">
              <thead className="sticky top-0 bg-gray-50 uppercase text-gray-500 dark:bg-gray-800">
                <tr>{["Satır","Ada","Blok","Kat","Daire","Ad Soyad","Abone No","Sayaç No","Mahalle","Adres","Kaynak","Durum"].map((item) => <th key={item} className="px-3 py-2.5">{item}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {rows.map((row) => (
                  <tr key={row.kayit_id} className="hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                    <td className="px-3 py-2 text-gray-400">{row.excel_satir_no}</td><td className="px-3 py-2 font-semibold">{row.ada || "—"}</td>
                    <td className="px-3 py-2">{row.blok || "—"}</td><td className="px-3 py-2">{row.kat || "—"}</td><td className="px-3 py-2">{row.daire || "—"}</td>
                    <td className="px-3 py-2">{row.ad_soyad || "—"}</td><td className="px-3 py-2 font-mono text-emerald-700">{row.abone_no || "—"}</td>
                    <td className="px-3 py-2 font-mono text-sky-700">{row.sayac_no || "—"}</td><td className="px-3 py-2">{row.mahalle || "—"}</td>
                    <td className="max-w-80 truncate px-3 py-2" title={row.adres}>{row.adres || "—"}</td><td className="max-w-64 truncate px-3 py-2" title={row.kaynak_dosya}>{row.kaynak_dosya || "—"}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">{row.durum || "Belirtilmemiş"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  } finally {
    db.close();
  }
}
