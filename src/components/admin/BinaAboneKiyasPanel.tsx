"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

type FilterKey = "all" | "uyumsuz" | "eksik_sayac" | "fazla_sayac" | "eksik_abone" | "uyumlu";

interface KiyasItem {
  bina_id: number;
  building_name: string;
  ada_parsel: string;
  beklenen: number;
  sayac_sayisi: number;
  sayac_dolu: number;
  abone_sayisi: number;
  fark_sayac: number;
  fark_abone: number;
  durum: string;
}

interface KiyasOzet {
  toplam_bina: number;
  yapilandirilmis_bina: number;
  toplam_sayac: number;
  sayacli_bina: number;
  sayac_nolu: number;
  abone_nolu: number;
  beklenen_birim: number;
  kiyas_bina: number;
  uyumlu: number;
  uyumsuz: number;
  eksik_sayac: number;
  fazla_sayac: number;
  eksik_abone: number;
  gosterilen: number;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "uyumsuz", label: "Uyumsuz" },
  { key: "eksik_sayac", label: "Eksik Sayaç" },
  { key: "fazla_sayac", label: "Fazla Sayaç" },
  { key: "eksik_abone", label: "Eksik Abone" },
  { key: "uyumlu", label: "Uyumlu" },
];

function farkLabel(n: number) {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

function farkClass(n: number, invert = false) {
  if (n === 0) return "text-gray-500";
  const bad = invert ? n > 0 : n < 0;
  return bad ? "text-red-600 dark:text-red-400 font-semibold" : "text-emerald-600 dark:text-emerald-400";
}

export default function BinaAboneKiyasPanel() {
  const [filter, setFilter] = useState<FilterKey>("uyumsuz");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<KiyasItem[]>([]);
  const [ozet, setOzet] = useState<KiyasOzet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("filter", filter);
    if (search.trim()) params.set("q", search.trim());

    fetch(`/api/bina-abone/kiyas?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { items?: KiyasItem[]; ozet?: KiyasOzet; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setItems(data.items ?? []);
        if (data.ozet) setOzet(data.ozet);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message || "Yüklenemedi");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [filter, search]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Genel Özet</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Yapılandırılmış binalarda beklenen bağımsız bölüm sayısı ile kayıtlı sayaç/abone sayısı kıyaslanır.
        </p>
        {ozet && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              ["Toplam Bina", ozet.toplam_bina],
              ["Yapılandırılmış", ozet.yapilandirilmis_bina],
              ["Beklenen Birim", ozet.beklenen_birim],
              ["Kayıtlı Sayaç", ozet.toplam_sayac],
              ["Abone Nolu", ozet.abone_nolu],
              ["Uyumsuz Bina", ozet.uyumsuz],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-center">
                <div className="text-lg font-bold text-gray-800 dark:text-white">{Number(val).toLocaleString("tr-TR")}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden flex flex-col max-h-[calc(100dvh-22rem)]">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 space-y-3 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                  filter === f.key
                    ? "bg-brand-500 text-white border-brand-500"
                    : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Bina, ada, sokak ara..."
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {loading && <div className="p-8 text-center text-sm text-gray-500">Yükleniyor...</div>}
          {error && <div className="p-8 text-center text-sm text-red-500">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/95 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2 font-semibold">Bina</th>
                  <th className="px-3 py-2 font-semibold text-center">Beklenen</th>
                  <th className="px-3 py-2 font-semibold text-center">Sayaç</th>
                  <th className="px-3 py-2 font-semibold text-center">Abone</th>
                  <th className="px-3 py-2 font-semibold text-center">Fark (S)</th>
                  <th className="px-3 py-2 font-semibold text-center">Fark (A)</th>
                  <th className="px-3 py-2 font-semibold">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item) => (
                  <tr key={item.bina_id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{item.building_name}</div>
                      <div className="text-[10px] text-gray-500">{item.ada_parsel || "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-center font-mono">{item.beklenen}</td>
                    <td className="px-3 py-2 text-center font-mono">{item.sayac_sayisi}</td>
                    <td className="px-3 py-2 text-center font-mono">{item.abone_sayisi}</td>
                    <td className={`px-3 py-2 text-center font-mono ${farkClass(item.fark_sayac)}`}>
                      {farkLabel(item.fark_sayac)}
                    </td>
                    <td className={`px-3 py-2 text-center font-mono ${farkClass(item.fark_abone)}`}>
                      {farkLabel(item.fark_abone)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          item.durum === "uyumlu"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
                        }`}
                      >
                        {item.durum === "uyumlu"
                          ? "Uyumlu"
                          : item.durum === "eksik_sayac"
                            ? "Eksik sayaç"
                            : item.durum === "fazla_sayac"
                              ? "Fazla sayaç"
                              : item.durum === "eksik_abone"
                                ? "Eksik abone"
                                : "Çoklu sorun"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {ozet && !loading && !error && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 shrink-0">
            Gösterilen: <strong>{ozet.gosterilen}</strong> / {ozet.kiyas_bina} yapılandırılmış bina
            {" · "}
            <Link href="/map" className="text-brand-600 dark:text-brand-400 hover:underline">
              Haritada gör
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
