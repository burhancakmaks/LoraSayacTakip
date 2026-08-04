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

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;
const MASKI_CARD =
  "overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900/95";

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

function StatLcd({ label, value, tone = "text-blue-light-300" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-blue-light-800/70 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-3 py-2.5 text-center shadow-inner">
      <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-blue-light-600/80">{label}</p>
      <p className={`mt-1 break-words text-sm font-black tabular-nums ${tone}`}>
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
      <div className={MASKI_CARD}>
        <div className="relative overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
            style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
          />
          <div className="relative flex flex-col gap-4 overflow-hidden pr-10 sm:flex-row sm:items-start sm:pr-14">
            <div className="flex items-start gap-3 px-5 py-4">
              <div className="relative flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-blue-light-800 to-blue-light-950 px-1 py-3 text-white shadow-[0_0_14px_rgba(11,165,236,0.3)]">
                <div
                  className="absolute inset-2 rounded-full border border-white/20"
                  style={{ boxShadow: "inset 0 0 0 2px #0ba5ec44" }}
                />
                <span className="relative text-[7px] font-bold uppercase tracking-[0.15em] text-blue-light-200/70">Kıyas</span>
                <span className="relative text-xs font-black leading-none">BIN</span>
                <span className="relative mt-1 rounded bg-blue-light-500 px-1 py-px text-[7px] font-bold text-white">ABN</span>
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Bina-Abone Kıyası</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                  Yapılandırılmış binalarda beklenen bağımsız bölüm sayısı ile kayıtlı sayaç/abone sayısı kıyaslanır.
                </p>
              </div>
            </div>
            <div
              className="pointer-events-none absolute -right-6 top-4 w-20 rotate-45 py-0.5 text-center text-[7px] font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: MASKI_RIBBON }}
            >
              MASKİ
            </div>
          </div>
        </div>

        {ozet && (
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatLcd label="Toplam Bina" value={ozet.toplam_bina} />
            <StatLcd label="Yapılandırılmış" value={ozet.yapilandirilmis_bina} />
            <StatLcd label="Beklenen Birim" value={ozet.beklenen_birim} />
            <StatLcd label="Kayıtlı Sayaç" value={ozet.toplam_sayac} />
            <StatLcd label="Abone Nolu" value={ozet.abone_nolu} />
            <StatLcd label="Uyumsuz Bina" value={ozet.uyumsuz} tone="text-amber-300" />
          </div>
        )}
      </div>

      {/* Filtre + tablo */}
      <div className={`${MASKI_CARD} flex max-h-[calc(100dvh-22rem)] flex-col`}>
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
