"use client";

import React, { useEffect, useState } from "react";
import { SAYAC_DURUM, type SayacDurum } from "@/lib/sayac-durum";

export type SorunListeFilter = "all" | "okuma" | SayacDurum;

export interface SayacSorunListeItem {
  id: number;
  bina_id: number;
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  kullanilis_sekli: string;
  sayac_id: string;
  sayac_durum: SayacDurum;
  building_name: string;
  layer: string | null;
  oda_id: number | null;
  coordinates: [number, number][][];
}

interface SayacSorunPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialFilter?: SorunListeFilter;
  onSelect: (item: SayacSorunListeItem) => void;
}

const FILTERS: { key: SorunListeFilter; label: string }[] = [
  { key: "all", label: "Tümü" },
  { key: "okuma", label: "Hatalı Okuma" },
  { key: "eksik", label: "Eksik" },
];

export default function SayacSorunPanel({
  isOpen,
  onClose,
  initialFilter = "all",
  onSelect,
}: SayacSorunPanelProps) {
  const [filter, setFilter] = useState<SorunListeFilter>(initialFilter);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SayacSorunListeItem[]>([]);
  const [ozet, setOzet] = useState({ toplam: 0, eksik: 0, okunmadi: 0, hatali: 0, gosterilen: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setFilter(initialFilter);
  }, [isOpen, initialFilter]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (filter !== "all") params.set("durum", filter);
    if (search.trim()) params.set("q", search.trim());

    fetch(`/api/sayac/sorunlar/liste?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: { items?: SayacSorunListeItem[]; ozet?: typeof ozet; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setItems(data.items ?? []);
        if (data.ozet) setOzet(data.ozet);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message || "Yüklenemedi");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [isOpen, filter, search]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const tabCount = (key: SorunListeFilter) => {
    if (key === "all") return ozet.toplam;
    if (key === "okuma") return ozet.okunmadi + ozet.hatali;
    return ozet[key] ?? 0;
  };

  const panelTitle =
    filter === "okuma"
      ? "Hatalı Okuma Listesi"
      : filter === "eksik"
        ? "Eksik Sayaç Listesi"
        : "Sayaç Sorun Raporu";

  const displayValue = (item: SayacSorunListeItem) => {
    if (!item.sayac_id) return "Girilmemiş";
    return item.sayac_id;
  };

  if (!isOpen) return null;

  return (
    <div className="pointer-events-auto w-80 sm:w-96 h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] flex flex-col bg-white/98 dark:bg-gray-900/98 shadow-2xl rounded-2xl border border-gray-100 dark:border-gray-800 backdrop-blur-md overflow-hidden shrink-0">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-800/40 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">{panelTitle}</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            Okunmayan, hatalı veya eksik sayaç kayıtları
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-200/70 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white transition"
          title="Kapat (Esc)"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3 flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
        <div className="flex flex-wrap gap-1.5 shrink-0">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition border ${
                filter === f.key
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-brand-300"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-80">({tabCount(f.key)})</span>
            </button>
          ))}
        </div>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Bina, blok, daire ara..."
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 shrink-0"
        />

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-gray-100 dark:border-gray-800">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent mr-2" />
              Yükleniyor...
            </div>
          )}
          {error && <div className="p-4 text-sm text-red-500 text-center">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/95 backdrop-blur-sm z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2.5 py-2 font-semibold">Durum</th>
                  <th className="px-2.5 py-2 font-semibold">Bina / Konum</th>
                  <th className="px-2.5 py-2 font-semibold">Okuma Değeri</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((item) => {
                  const meta = SAYAC_DURUM[item.sayac_durum];
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className="cursor-pointer hover:bg-brand-50/60 dark:hover:bg-brand-500/10 transition-colors"
                    >
                      <td className="px-2.5 py-2">
                        <span
                          className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          {meta.etiket}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[130px]">
                          {item.building_name}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {[item.blok_no, item.kapi_no && `D.${item.kapi_no}`, item.kullanilis_sekli]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="px-2.5 py-2">
                        <span
                          className={`text-[11px] font-mono font-semibold ${
                            item.sayac_durum === "okunmadi"
                              ? "text-red-600 dark:text-red-400"
                              : item.sayac_durum === "hatali"
                                ? "text-red-700 dark:text-red-300"
                                : item.sayac_durum === "eksik"
                                  ? "text-amber-600 dark:text-amber-400 italic"
                                  : "text-gray-600"
                          }`}
                        >
                          {displayValue(item)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && ozet.toplam > 0 && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0 pt-1 border-t border-gray-100 dark:border-gray-800">
            Gösterilen: <strong>{ozet.gosterilen}</strong> / {ozet.toplam}
            {search.trim() ? " (filtreli)" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
