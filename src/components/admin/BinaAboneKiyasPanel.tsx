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

const PANEL_CARD =
  "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900";

function farkLabel(n: number) {
  if (n === 0) return "0";
  return n > 0 ? `+${n}` : String(n);
}

function farkClass(n: number, invert = false) {
  if (n === 0) return "text-gray-500 dark:text-gray-400";
  const bad = invert ? n > 0 : n < 0;
  return bad ? "text-red-600 dark:text-red-400 font-semibold" : "text-blue-light-600 dark:text-blue-light-400 font-semibold";
}

function durumBadge(durum: string) {
  if (durum === "uyumlu") {
    return "bg-blue-light-100 text-blue-light-800 dark:bg-blue-light-500/20 dark:text-blue-light-300";
  }
  if (durum === "eksik_sayac" || durum === "eksik_abone") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
  }
  if (durum === "fazla_sayac") {
    return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  }
  return "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300";
}

function durumLabel(durum: string) {
  if (durum === "uyumlu") return "Uyumlu";
  if (durum === "eksik_sayac") return "Eksik sayaç";
  if (durum === "fazla_sayac") return "Fazla sayaç";
  if (durum === "eksik_abone") return "Eksik abone";
  return "Çoklu sorun";
}

function StatCard({ label, value, tone = "text-gray-900 dark:text-white" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-center dark:border-gray-700 dark:bg-gray-800/60">
      <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 break-words text-sm font-semibold tabular-nums ${tone}`}>
        {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
      </p>
    </div>
  );
}

function filterCount(key: FilterKey, ozet: KiyasOzet | null) {
  if (!ozet) return null;
  switch (key) {
    case "all":
      return ozet.kiyas_bina;
    case "uyumsuz":
      return ozet.uyumsuz;
    case "eksik_sayac":
      return ozet.eksik_sayac;
    case "fazla_sayac":
      return ozet.fazla_sayac;
    case "eksik_abone":
      return ozet.eksik_abone;
    case "uyumlu":
      return ozet.uyumlu;
    default:
      return null;
  }
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
    // Loading state intentionally resets whenever the server-side filter changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="space-y-5">
      {/* Üst başlık */}
      <div className={PANEL_CARD}>
        <div className="border-b border-gray-200 dark:border-gray-800">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3 px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-light-50 text-blue-light-600 dark:bg-blue-light-950/40 dark:text-blue-light-400">
                <svg
                  aria-hidden="true"
                  className="h-6 w-6"
                  viewBox="0 0 40 40"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M5.5 30.5V12.5L14 8L22.5 12.5V30.5" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
                  <path d="M10 16H13M17 16H20M10 21H13M17 21H20M10 26H13M17 26H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="30" cy="15" r="4" stroke="currentColor" strokeWidth="2.2" />
                  <path d="M24.5 30C24.5 26.7 27 24 30 24C33 24 35.5 26.7 35.5 30" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M5 34H35" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Bina-Abone Kıyası</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                  Yapılandırılmış binalarda beklenen bağımsız bölüm sayısı ile kayıtlı sayaç/abone sayısı kıyaslanır.
                </p>
              </div>
            </div>
          </div>
        </div>

        {ozet && (
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Toplam Bina" value={ozet.toplam_bina} />
            <StatCard label="Yapılandırılmış" value={ozet.yapilandirilmis_bina} />
            <StatCard label="Beklenen Birim" value={ozet.beklenen_birim} />
            <StatCard label="Kayıtlı Sayaç" value={ozet.toplam_sayac} />
            <StatCard label="Abone Nolu" value={ozet.abone_nolu} />
            <StatCard label="Uyumsuz Bina" value={ozet.uyumsuz} tone="text-amber-600 dark:text-amber-400" />
          </div>
        )}
      </div>

      {/* Filtre + tablo */}
      <div className={`${PANEL_CARD} flex max-h-[calc(100dvh-22rem)] flex-col`}>
        <div className="shrink-0 space-y-3 border-b border-blue-light-100 p-4 dark:border-blue-light-900/30">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const count = filterCount(f.key, ozet);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    filter === f.key
                      ? "border-blue-light-600 bg-blue-light-600 text-white shadow-sm"
                      : "border-blue-light-200 bg-blue-light-50/60 text-blue-light-800 hover:border-blue-light-400 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300 dark:hover:border-blue-light-600"
                  }`}
                >
                  {f.label}
                  {count !== null && <span className="ml-1 opacity-80">({count.toLocaleString("tr-TR")})</span>}
                </button>
              );
            })}
          </div>

          <div className="relative flex items-center gap-2 overflow-hidden rounded-xl border border-blue-light-200 bg-blue-light-50/50 px-3 py-2 dark:border-blue-light-900/50 dark:bg-blue-light-950/25">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="shrink-0 text-blue-light-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Bina, ada, sokak ara..."
              className="flex-1 bg-transparent text-sm font-medium text-gray-800 placeholder:text-gray-500 focus:outline-none dark:text-white dark:placeholder:text-gray-400"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
              Yükleniyor...
            </div>
          )}
          {error && <div className="p-8 text-center text-sm text-error-600 dark:text-error-400">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-blue-light-50/95 backdrop-blur-sm dark:bg-blue-light-950/80">
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2">Bina</th>
                  <th className="px-3 py-2 text-center">Beklenen</th>
                  <th className="px-3 py-2 text-center">Sayaç</th>
                  <th className="px-3 py-2 text-center">Abone</th>
                  <th className="px-3 py-2 text-center">Fark (S)</th>
                  <th className="px-3 py-2 text-center">Fark (A)</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2 text-right">Harita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-light-100/80 dark:divide-blue-light-900/40">
                {items.map((item) => (
                  <tr key={item.bina_id} className="transition hover:bg-blue-light-50/60 dark:hover:bg-blue-light-950/30">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-gray-800 dark:text-gray-200">{item.building_name}</div>
                      <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">{item.ada_parsel || "—"}</div>
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-gray-700 dark:text-gray-300">
                      {item.beklenen}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-blue-light-700 dark:text-blue-light-300">
                      {item.sayac_sayisi}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-blue-light-700 dark:text-blue-light-300">
                      {item.abone_sayisi}
                    </td>
                    <td className={`px-3 py-2.5 text-center font-mono tabular-nums ${farkClass(item.fark_sayac)}`}>
                      {farkLabel(item.fark_sayac)}
                    </td>
                    <td className={`px-3 py-2.5 text-center font-mono tabular-nums ${farkClass(item.fark_abone)}`}>
                      {farkLabel(item.fark_abone)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold ${durumBadge(item.durum)}`}>
                        {durumLabel(item.durum)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        href={`/map?bina_id=${item.bina_id}`}
                        className="inline-flex rounded-lg border border-blue-light-200 bg-blue-light-50 px-2 py-1 text-[10px] font-semibold text-blue-light-700 transition hover:border-blue-light-400 hover:bg-blue-light-100 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300 dark:hover:border-blue-light-600"
                      >
                        Git
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {ozet && !loading && !error && (
          <div className="shrink-0 border-t border-blue-light-100 px-4 py-2.5 text-[11px] text-gray-500 dark:border-blue-light-900/30 dark:text-gray-400">
            Gösterilen: <strong className="text-blue-light-700 dark:text-blue-light-300">{ozet.gosterilen}</strong> /{" "}
            {ozet.kiyas_bina} yapılandırılmış bina
            {" · "}
            <Link href="/map" className="font-semibold text-blue-light-600 hover:text-blue-light-700 dark:text-blue-light-400 dark:hover:text-blue-light-300">
              Haritada gör
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
