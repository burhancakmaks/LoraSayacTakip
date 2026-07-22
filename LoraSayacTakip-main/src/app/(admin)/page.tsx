import type { Metadata } from "next";
import Link from "next/link";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const metadata: Metadata = {
  title: "MASKİ Abonelik Yönetim Sistemi",
  description: "MASKİ bina, abonelik ve sayaç yönetim paneli",
};

type Totals = {
  toplam_kayit: number;
  benzersiz_abone: number;
  benzersiz_sayac: number;
  eksik_abone: number;
  eksik_sayac: number;
  bolge_sayisi: number;
};

type Region = { ada: string; kayit: number; abone: number; sayac: number };

function getDashboardData() {
  const db = new DatabaseSync(path.join(process.cwd(), "data", "binalar.db"), { readOnly: true });
  try {
    const totals = db.prepare(`
      SELECT COUNT(*) AS toplam_kayit,
        COUNT(DISTINCT NULLIF(abone_no, '')) AS benzersiz_abone,
        COUNT(DISTINCT NULLIF(sayac_no, '')) AS benzersiz_sayac,
        SUM(CASE WHEN abone_no = '' THEN 1 ELSE 0 END) AS eksik_abone,
        SUM(CASE WHEN sayac_no = '' THEN 1 ELSE 0 END) AS eksik_sayac,
        COUNT(DISTINCT NULLIF(ada, '')) AS bolge_sayisi
      FROM excel_abonelikler
    `).get() as unknown as Totals;
    const regions = db.prepare(`
      SELECT ada, COUNT(*) AS kayit,
        COUNT(DISTINCT NULLIF(abone_no, '')) AS abone,
        COUNT(DISTINCT NULLIF(sayac_no, '')) AS sayac
      FROM excel_abonelikler GROUP BY ada ORDER BY kayit DESC
    `).all() as unknown as Region[];
    return { totals, regions };
  } finally {
    db.close();
  }
}

const number = (value: number) => Number(value || 0).toLocaleString("tr-TR");

export default function Dashboard() {
  const { totals, regions } = getDashboardData();
  const cards = [
    { label: "Toplam Excel Kaydı", value: totals.toplam_kayit, color: "text-brand-600", bg: "bg-brand-50 dark:bg-brand-950/40" },
    { label: "Benzersiz Abone", value: totals.benzersiz_abone, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { label: "Benzersiz Sayaç", value: totals.benzersiz_sayac, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/30" },
    { label: "Eksik Abone No", value: totals.eksik_abone, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30" },
    { label: "Eksik Sayaç No", value: totals.eksik_sayac, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30" },
    { label: "Ada / Bölge", value: totals.bolge_sayisi, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-950/30" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-500">MASKİ Genel Müdürlüğü</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Abonelik Yönetim Sistemi</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Master Veri sayfasındaki gerçek kayıtların güncel özeti</p>
        </div>
        <Link href="/map" className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
          Haritayı Aç
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card) => (
          <div key={card.label} className={`rounded-xl border border-gray-200 p-3.5 dark:border-gray-800 ${card.bg}`}>
            <div className={`text-2xl font-bold ${card.color}`}>{number(card.value)}</div>
            <div className="mt-1 text-xs font-medium text-gray-600 dark:text-gray-300">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Ada ve Bölge Dağılımı</h2>
            <p className="text-xs text-gray-500">Excel kayıtlarıyla birebir hesaplanmıştır</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">JSON + SQLite senkron</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">
              <tr><th className="px-4 py-2.5">Ada/Bölge</th><th className="px-4 py-2.5 text-right">Kayıt</th><th className="px-4 py-2.5 text-right">Abone</th><th className="px-4 py-2.5 text-right">Sayaç</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {regions.map((region) => (
                <tr key={region.ada} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-semibold text-gray-800 dark:text-white">{region.ada || "Belirtilmemiş"}</td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{number(region.kayit)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{number(region.abone)}</td>
                  <td className="px-4 py-3 text-right text-sky-600">{number(region.sayac)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
