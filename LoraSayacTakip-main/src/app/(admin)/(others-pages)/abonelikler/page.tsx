"use client";

import { useEffect, useState } from "react";

type RecordRow = {
  kayit_id: string;
  excel_satir_no: number;
  ada: string;
  blok: string;
  kat: string;
  daire: string;
  ad_soyad: string;
  abone_no: string;
  sayac_no: string;
  adres: string;
  mahalle: string;
  durum: string;
};

type ResponseData = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  rows: RecordRow[];
};

export default function SubscriptionRecordsPage() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: "50" });
    if (search) params.set("search", search);
    fetch(`/api/abonelikler?${params}`)
      .then((response) => {
        if (!response.ok) throw new Error("Abonelik kayıtları yüklenemedi.");
        return response.json();
      })
      .then((result: ResponseData) => {
        if (!cancelled) setData(result);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Bilinmeyen hata");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [page, search]);

  const submitSearch = () => {
    setLoading(true);
    setError("");
    setPage(1);
    setSearch(searchInput.trim());
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-500">Master Veri</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Abonelik Kayıtları</h1>
          <p className="text-sm text-gray-500">Excel satır numarası ve kaynak değerleri korunmuş kayıt listesi</p>
        </div>
        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={(event) => { event.preventDefault(); submitSearch(); }}
        >
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Abone, sayaç, ad, adres veya mahalle ara..."
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
          <button className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">Ara</button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 text-sm dark:border-gray-800">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{data ? `${data.total.toLocaleString("tr-TR")} kayıt` : "Kayıtlar"}</span>
          {search && <button onClick={() => { setLoading(true); setSearchInput(""); setSearch(""); setPage(1); }} className="text-xs font-semibold text-brand-600">Filtreyi temizle</button>}
        </div>

        {error ? <div className="p-8 text-center text-sm text-red-600">{error}</div> : loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Kayıtlar yükleniyor...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] w-full text-left text-xs">
              <thead className="bg-gray-50 uppercase text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
                <tr>
                  {['Satır','Ada','Blok','Kat','Daire','Ad Soyad','Abone No','Sayaç No','Mahalle','Adres','Durum'].map((label) => <th key={label} className="px-3 py-2.5">{label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data?.rows.map((row) => (
                  <tr key={row.kayit_id} className="hover:bg-brand-50/40 dark:hover:bg-brand-950/20">
                    <td className="px-3 py-2 text-gray-400">{row.excel_satir_no}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800 dark:text-white">{row.ada || "—"}</td>
                    <td className="px-3 py-2">{row.blok || "—"}</td>
                    <td className="px-3 py-2">{row.kat || "—"}</td>
                    <td className="px-3 py-2">{row.daire || "—"}</td>
                    <td className="px-3 py-2">{row.ad_soyad || "—"}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-emerald-700">{row.abone_no || "—"}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-sky-700">{row.sayac_no || "—"}</td>
                    <td className="px-3 py-2">{row.mahalle || "—"}</td>
                    <td className="max-w-72 truncate px-3 py-2" title={row.adres}>{row.adres || "—"}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-gray-800">{row.durum || "Belirtilmemiş"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-800">
            <span className="text-gray-500">Sayfa {data.page} / {data.totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => { setLoading(true); setPage((value) => value - 1); }} className="rounded-md border px-3 py-1.5 disabled:opacity-40 dark:border-gray-700">Önceki</button>
              <button disabled={page >= data.totalPages} onClick={() => { setLoading(true); setPage((value) => value + 1); }} className="rounded-md border px-3 py-1.5 disabled:opacity-40 dark:border-gray-700">Sonraki</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
