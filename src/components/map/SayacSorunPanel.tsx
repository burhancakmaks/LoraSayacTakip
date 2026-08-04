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

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;

function StatLcd({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex-1 overflow-hidden rounded-lg border border-blue-light-800/70 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-2 py-1.5 text-center shadow-inner">
      <p className="text-[7px] font-bold uppercase tracking-[0.15em] text-blue-light-600/80">{label}</p>
      <p className={`mt-0.5 text-sm font-black tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

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
    if (key === "eksik") return ozet.eksik;
    if (key === "okunmadi") return ozet.okunmadi;
    if (key === "hatali") return ozet.hatali;
    return 0;
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
    <div className="pointer-events-auto flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white/98 shadow-2xl backdrop-blur-md dark:border-blue-light-900/40 dark:bg-gray-900/98">
      {/* Üst başlık — MASKİ stili */}
      <div className="relative shrink-0 overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
          style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
        />
        <div className="relative flex items-start justify-between gap-2 px-4 py-3 pr-10">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">{panelTitle}</h2>
            <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
              Okunmayan, hatalı veya eksik sayaç kayıtları
            </p>
          </div>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition hover:border-blue-light-300 hover:bg-blue-light-50 hover:text-gray-700 dark:border-gray-700 dark:hover:border-blue-light-700 dark:hover:bg-blue-light-950/40 dark:hover:text-white"
            title="Kapat (Esc)"
          >
            ✕
          </button>
          <div
            className="pointer-events-none absolute -right-6 top-3 w-16 rotate-45 py-px text-center text-[6px] font-bold uppercase tracking-wider text-white shadow-sm"
            style={{ backgroundColor: MASKI_RIBBON }}
          >
            MASKİ
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3">
        <div className="flex shrink-0 gap-1.5">
          <StatLcd label="Hatalı" value={ozet.okunmadi + ozet.hatali} tone="text-error-300" />
          <StatLcd label="Eksik" value={ozet.eksik} tone="text-warning-300" />
          <StatLcd label="Toplam" value={ozet.toplam} tone="text-blue-light-300" />
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition ${
                filter === f.key
                  ? "border-blue-light-600 bg-blue-light-600 text-white shadow-sm"
                  : "border-blue-light-200 bg-blue-light-50/60 text-blue-light-800 hover:border-blue-light-400 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300 dark:hover:border-blue-light-600"
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
          className="w-full shrink-0 rounded-xl border border-blue-light-200 bg-blue-light-50/50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/20 dark:border-blue-light-900/50 dark:bg-blue-light-950/25 dark:text-white"
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-blue-light-100 dark:border-blue-light-900/40">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
              Yükleniyor...
            </div>
          )}
          {error && <div className="p-4 text-center text-sm text-error-500">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-blue-light-50/95 backdrop-blur-sm dark:bg-blue-light-950/80">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide">Durum</th>
                  <th className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide">Bina / Konum</th>
                  <th className="px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide">Değer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-light-100/80 dark:divide-blue-light-900/30">
                {items.map((item) => {
                  const meta = SAYAC_DURUM[item.sayac_durum];
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelect(item)}
                      className="cursor-pointer transition-colors hover:bg-blue-light-50/80 dark:hover:bg-blue-light-950/30"
                    >
                      <td className="px-2.5 py-2">
                        <span
                          className="inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          {meta.etiket}
                        </span>
                      </td>
                      <td className="px-2.5 py-2">
                        <div className="max-w-[130px] truncate font-medium text-gray-800 dark:text-gray-200">
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
                              ? "text-error-600 dark:text-error-400"
                              : item.sayac_durum === "hatali"
                                ? "text-error-700 dark:text-error-300"
                                : item.sayac_durum === "eksik"
                                  ? "italic text-warning-600 dark:text-warning-400"
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
          <div className="shrink-0 border-t border-blue-light-100 pt-1 text-[10px] text-gray-500 dark:border-blue-light-900/40 dark:text-gray-400">
            Gösterilen: <strong className="text-gray-700 dark:text-gray-300">{ozet.gosterilen}</strong> / {ozet.toplam}
            {search.trim() ? " (filtreli)" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
