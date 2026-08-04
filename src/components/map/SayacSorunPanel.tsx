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

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-center dark:border-gray-700 dark:bg-gray-800/60">
      <p className="text-[9px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
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
    if (!isOpen) return;
    const controller = new AbortController();

    const loadReport = async () => {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filter !== "all") params.set("durum", filter);
      if (search.trim()) params.set("q", search.trim());

      try {
        const response = await fetch(`/api/sayac/sorunlar/liste?${params}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          items?: SayacSorunListeItem[];
          ozet?: typeof ozet;
          error?: string;
        };
        if (!response.ok || data.error) throw new Error(data.error || "Rapor yüklenemedi");
        setItems(data.items ?? []);
        if (data.ozet) setOzet(data.ozet);
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") {
          setError(error.message || "Yüklenemedi");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadReport();

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
    <div className="pointer-events-auto flex h-full max-h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-blue-light-200/80 bg-white shadow-[0_20px_60px_rgba(2,32,54,0.3)] dark:border-blue-light-900/50 dark:bg-gray-900">
      <div className="shrink-0 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error-50 text-error-600 dark:bg-error-500/10 dark:text-error-400">
              <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L21 19H3L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M12 9V13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="currentColor" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold text-gray-900 dark:text-white">{panelTitle}</h2>
              <p className="mt-0.5 truncate text-[10px] text-gray-500 dark:text-gray-400">
                Okunmayan, hatalı veya eksik sayaç kayıtları
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white/80 text-gray-500 transition hover:border-blue-light-300 hover:bg-blue-light-50 hover:text-blue-light-800 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:border-blue-light-700 dark:hover:bg-blue-light-950/40 dark:hover:text-white"
            title="Kapat (Esc)"
          >
            <span aria-hidden="true" className="text-lg leading-none">×</span>
            <span className="sr-only">Kapat</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-3">
        <div className="flex shrink-0 gap-1.5">
          <StatCard label="Hatalı" value={ozet.okunmadi + ozet.hatali} tone="text-error-600 dark:text-error-400" />
          <StatCard label="Eksik" value={ozet.eksik} tone="text-warning-600 dark:text-warning-400" />
          <StatCard label="Toplam" value={ozet.toplam} tone="text-gray-900 dark:text-white" />
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`min-w-0 rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
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

        <div className="relative shrink-0">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Bina, blok, daire veya sayaç ara..."
            className="w-full rounded-xl border border-blue-light-200 bg-blue-light-50/50 py-2.5 pl-9 pr-9 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/20 dark:border-blue-light-900/50 dark:bg-blue-light-950/25 dark:text-white"
          />
          {search && (
            <button
              type="button"
              aria-label="Aramayı temizle"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:bg-white hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              ×
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-blue-light-100 bg-gray-50/60 p-2 dark:border-blue-light-900/40 dark:bg-gray-950/20">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-gray-500">
              <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
              Yükleniyor...
            </div>
          )}
          {error && <div className="p-4 text-center text-sm text-error-500">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="flex h-full min-h-40 flex-col items-center justify-center p-8 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-blue-light-50 text-xl text-blue-light-500 dark:bg-blue-light-950/40">✓</div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Kayıt bulunamadı</p>
              <p className="mt-1 text-xs text-gray-500">Filtreyi veya arama ifadesini değiştirebilirsiniz.</p>
            </div>
          )}
          {!loading && !error && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => {
                const meta = SAYAC_DURUM[item.sayac_durum];
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onSelect(item)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-gray-200/80 bg-white p-3 text-left shadow-sm transition hover:-translate-y-px hover:border-blue-light-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-light-500/30 dark:border-gray-700/80 dark:bg-gray-800/80 dark:hover:border-blue-light-700"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-black text-white shadow-sm"
                      style={{ backgroundColor: meta.color }}
                    >
                      !
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-bold text-gray-800 dark:text-gray-100">
                          {item.building_name}
                        </span>
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white"
                          style={{ backgroundColor: meta.color }}
                        >
                          {meta.etiket}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-gray-500 dark:text-gray-400">
                        {[item.blok_no, item.kapi_no && `Daire ${item.kapi_no}`, item.kat, item.kullanilis_sekli]
                          .filter(Boolean)
                          .join(" · ") || "Konum bilgisi yok"}
                      </span>
                    </span>
                    <span className="max-w-[7rem] shrink-0 text-right">
                      <span
                        className={`block truncate font-mono text-[11px] font-bold ${
                          item.sayac_durum === "eksik"
                            ? "italic text-warning-600 dark:text-warning-400"
                            : "text-error-600 dark:text-error-400"
                        }`}
                        title={displayValue(item)}
                      >
                        {displayValue(item)}
                      </span>
                      <span className="mt-1 block text-[9px] font-medium text-blue-light-600 opacity-0 transition group-hover:opacity-100 dark:text-blue-light-400">
                        Haritada göster →
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
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
