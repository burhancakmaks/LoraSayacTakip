"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { classifySayacDurum, SAYAC_DURUM } from "@/lib/sayac-durum";
import { useNotifications } from "@/context/NotificationContext";

interface SelectedBuilding {
  id: number;
  value: string | null;
  oda_id: number | null;
}

interface SayacRow {
  birim_no: number;
  blok_no: string;
  kat: string;
  kapi_no: string;
  oda_sayisi: string;
  kullanilis_sekli: string;
  sayac_markasi: string;
  sayac_id: string;
  sicil_no: string;
  abone_no: string;
  sayac_durum?: string;
}

interface SayacModalProps {
  building: SelectedBuilding | null;
  onClose: () => void;
}

const KULLANILIS_SEKILLERI = [
  "DAİRE",
  "OFİS",
  "DÜKKAN",
  "ORTAK ALAN",
  "MESCİD",
  "WC",
  "KAZAN DAİRESİ",
  "YÖNETİM",
];

const ODA_SAYILARI = [
  "YOK",
  "1+0",
  "1+1",
  "2+1",
  "3+1",
  "4+1",
  "5+1",
];

const SAYAC_MARKALARI = [
  "Baylan",
  "Polimeter",
  "Manas",
];

// Helper to determine floor sorting order
const getFloorWeight = (floor: string) => {
  const fUpper = floor.toUpperCase();
  if (fUpper.includes("BODRUM")) return -1;
  if (fUpper.includes("ZEMİN") || fUpper.includes("ZEMIN")) return 0;
  const match = fUpper.match(/(\d+)\./);
  if (match) return parseInt(match[1]);
  if (fUpper.includes("ORTAK")) return 998;
  return 999; // other / unspecified
};

export default function SayacModal({ building, onClose }: SayacModalProps) {
  const { refresh } = useNotifications();
  const [rows, setRows] = useState<SayacRow[]>([]);
  const [floorOptions, setFloorOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBinaInfo, setNoBinaInfo] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "grid">("grid");
  const [selectedFloorFilter, setSelectedFloorFilter] = useState<string>("HEPSİ");

  useEffect(() => {
    if (!building) return;
    setLoading(true);
    setSaved(false);
    setError(null);
    setNoBinaInfo(false);
    setSelectedFloorFilter("HEPSİ");

    // Fetch bina_bilgi
    fetch(`/api/bina-bilgi?bina_id=${building.id}`)
      .then((r) => r.json())
      .then(async (bilgi) => {
        const toplam: number = bilgi?.["toplam_bagımsız_bolum"] ?? bilgi?.toplam_bagımsız_bolum ?? 0;
        if (!bilgi || toplam === 0) {
          setNoBinaInfo(true);
          setLoading(false);
          return;
        }

        // Dynamically build floor options in sorted order
        const opts: string[] = [];
        if (bilgi.has_zemin === 1) {
          opts.push("ZEMİN KAT");
        }
        const katSayisi = bilgi.kat_sayisi || 0;
        for (let k = 1; k <= katSayisi; k++) {
          opts.push(`${k}. KAT`);
        }
        opts.push("BODRUM KAT");
        opts.push("ORTAK ALAN");
        
        // Sort floor options using getFloorWeight helper
        const sortedOpts = [...opts].sort((a, b) => getFloorWeight(a) - getFloorWeight(b));
        setFloorOptions(sortedOpts);

        // Fetch existing sayac rows
        const sayacRes = await fetch(`/api/sayac?bina_id=${building.id}`);
        const existing: SayacRow[] = await sayacRes.json();

        // Check if there is configured data to choose default view mode
        const hasData = existing.some((r) => r.sayac_id || r.kapi_no);
        setViewMode(hasData ? "grid" : "edit");

        // Build full row array
        const defaultBlok = building.value || "";
        const existingMap = new Map(existing.map((r) => [r.birim_no, r]));
        const fullRows: SayacRow[] = Array.from({ length: toplam }, (_, i) => {
          const birim_no = i + 1;
          const found = existingMap.get(birim_no);
          return {
            birim_no,
            blok_no: found?.blok_no ?? defaultBlok,
            kat: found?.kat ?? "",
            kapi_no: found?.kapi_no ?? "",
            oda_sayisi: found?.oda_sayisi ?? "YOK",
            kullanilis_sekli: found?.kullanilis_sekli ?? "DAİRE",
            sayac_markasi: found?.sayac_markasi ?? "",
            sayac_id: found?.sayac_id ?? "",
            sicil_no: found?.sicil_no ?? "",
            abone_no: found?.abone_no ?? "",
          };
        });

        setRows(fullRows);
        setLoading(false);
      })
      .catch(() => {
        setError("Veriler yüklenirken hata oluştu.");
        setLoading(false);
      });
  }, [building]);

  const updateRow = useCallback((birim_no: number, field: keyof Omit<SayacRow, "birim_no">, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.birim_no === birim_no ? { ...r, [field]: value } : r))
    );
    setSaved(false);
  }, []);

  const handleSave = async () => {
    if (!building) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/sayac", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bina_id: building.id, rows }),
      });
      if (!res.ok) throw new Error("Kayıt sırasında hata oluştu.");
      const data = await res.json();
      setSaved(true);
      if (data.bildirimler?.length) await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Sort rows first by floor weight, then by section/door number
  const sortedRows = [...rows].sort((a, b) => {
    const wA = getFloorWeight(a.kat);
    const wB = getFloorWeight(b.kat);
    if (wA !== wB) return wA - wB;
    
    // Within same floor, sort by kapı/numarataj code numerically if possible
    const numA = parseInt(a.kapi_no) || a.birim_no;
    const numB = parseInt(b.kapi_no) || b.birim_no;
    return numA - numB;
  });

  // Filter rows based on floor filter dropdown selection
  const filteredRows = selectedFloorFilter === "HEPSİ"
    ? sortedRows
    : sortedRows.filter((r) => r.kat === selectedFloorFilter);

  // Group sorted units by floor for rendering card sections
  const groupedByFloor: { [key: string]: SayacRow[] } = {};
  filteredRows.forEach((row) => {
    const floorName = row.kat || "KAT BELİRSİZ";
    if (!groupedByFloor[floorName]) {
      groupedByFloor[floorName] = [];
    }
    groupedByFloor[floorName].push(row);
  });

  const sortedFloorKeys = Object.keys(groupedByFloor).sort((a, b) => getFloorWeight(a) - getFloorWeight(b));

  return (
    <Modal
      isOpen={building !== null}
      onClose={onClose}
      className="max-w-6xl m-4 flex flex-col overflow-hidden bg-white dark:bg-gray-900 rounded-3xl"
    >
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-gray-100 dark:border-gray-800 pr-12">
        <h2 className="text-gray-900 dark:text-white font-bold text-lg leading-tight flex items-center gap-2">
          ⚡ Sayaç Listesi ve Bölüm Planı
        </h2>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1 truncate max-w-md">
          {building?.value || "Bilinmeyen Bina"} — ODA #{building?.oda_id}
        </p>
      </div>

      {/* Toolbar: View Tabs & Floor Filter Select */}
      {!loading && !noBinaInfo && rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/10 px-6 py-1.5 sm:py-0 gap-2">
          {/* Tabs */}
          <div className="flex">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                viewMode === "grid"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              📱 Daireler Görünümü
            </button>
            <button
              onClick={() => setViewMode("edit")}
              className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                viewMode === "edit"
                  ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                  : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              ✏️ Düzenleme Tablosu
            </button>
          </div>

          {/* Floor filter dropdown (Only active when Daireler view is active) */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-2 self-end sm:self-center mb-1.5 sm:mb-0">
              <label className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Kat Filtresi:</label>
              <select
                value={selectedFloorFilter}
                onChange={(e) => setSelectedFloorFilter(e.target.value)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="HEPSİ">Tüm Katlar (Hepsi)</option>
                {floorOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Body Container */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "65vh" }}>
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent"></div>
          </div>
        )}

        {!loading && noBinaInfo && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="text-4xl mb-4">🏢</div>
            <h3 className="font-bold text-gray-700 dark:text-gray-200 text-base mb-2">Bina bilgileri henüz eklenmemiş</h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Sayaç ekleyebilmek için önce <strong>"Bina Bilgileri Düzenle"</strong> butonuna tıklayarak kat ve toplam daire sayısını girin.
            </p>
          </div>
        )}

        {!loading && !noBinaInfo && rows.length > 0 && (
          <>
            {viewMode === "edit" ? (
              <>
                {/* Info bar */}
                <div className="px-6 py-3 bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Toplam <strong className="text-gray-700 dark:text-gray-200">{rows.length}</strong> bağımsız bölüm
                  </span>
                  {saved && (
                    <span className="text-sm text-emerald-600 flex items-center gap-1.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Kaydedildi
                    </span>
                  )}
                  {error && <span className="text-sm text-red-500">{error}</span>}
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider w-16">Bağımsız Bölüm No</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Blok</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Kat</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Numarataj (Kapı No)</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Oda Sayısı</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Niteliği</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider w-36">Sayaç Markası</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sayaç No</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sicil No</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Abone No</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row, idx) => (
                        <tr
                          key={row.birim_no}
                          className={`border-b border-gray-50 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 ${
                            idx % 2 === 0 ? "" : "bg-gray-50/30 dark:bg-gray-900"
                          }`}
                        >
                          {/* Bağımsız Bölüm No */}
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-500 dark:text-gray-400">
                              {row.birim_no}
                            </span>
                          </td>

                          {/* Blok */}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.blok_no}
                              placeholder="A BLOK"
                              onChange={(e) => updateRow(row.birim_no, "blok_no", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition"
                            />
                          </td>

                          {/* Kat */}
                          <td className="px-4 py-2">
                            <select
                              value={row.kat}
                              onChange={(e) => updateRow(row.birim_no, "kat", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition cursor-pointer"
                            >
                              <option value="" className="dark:bg-gray-900">Seçiniz</option>
                              {Array.from(new Set([row.kat, ...floorOptions])).filter(Boolean).map((katOpt) => (
                                <option key={katOpt} value={katOpt} className="dark:bg-gray-900">
                                  {katOpt}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Numarataj (Kapı No) */}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.kapi_no}
                              placeholder={`Örn: ${row.birim_no}`}
                              onChange={(e) => updateRow(row.birim_no, "kapi_no", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition"
                            />
                          </td>

                          {/* Oda Sayısı */}
                          <td className="px-4 py-2">
                            <select
                              value={row.oda_sayisi}
                              onChange={(e) => updateRow(row.birim_no, "oda_sayisi", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition cursor-pointer"
                            >
                              {ODA_SAYILARI.map((oda) => (
                                <option key={oda} value={oda} className="dark:bg-gray-900">
                                  {oda}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Niteliği (Kullanılış Şekli) */}
                          <td className="px-4 py-2">
                            <select
                              value={row.kullanilis_sekli}
                              onChange={(e) => updateRow(row.birim_no, "kullanilis_sekli", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition cursor-pointer"
                            >
                              {KULLANILIS_SEKILLERI.map((sekil) => (
                                <option key={sekil} value={sekil} className="dark:bg-gray-900">
                                  {sekil}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Sayaç Markası */}
                          <td className="px-4 py-2">
                            <select
                              value={row.sayac_markasi}
                              onChange={(e) => updateRow(row.birim_no, "sayac_markasi", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition cursor-pointer"
                            >
                              <option value="" className="dark:bg-gray-900">Seçiniz</option>
                              {SAYAC_MARKALARI.map((marka) => (
                                <option key={marka} value={marka} className="dark:bg-gray-900">
                                  {marka}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Sayaç No */}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.sayac_id}
                              placeholder="Örn: 02995735"
                              onChange={(e) => updateRow(row.birim_no, "sayac_id", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition placeholder-gray-300 dark:placeholder-gray-600"
                            />
                          </td>

                          {/* Sicil No */}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.sicil_no}
                              placeholder="Örn: 641286"
                              onChange={(e) => updateRow(row.birim_no, "sicil_no", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition placeholder-gray-300 dark:placeholder-gray-600"
                            />
                          </td>

                          {/* Abone No */}
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              value={row.abone_no}
                              placeholder="Örn: 462052"
                              onChange={(e) => updateRow(row.birim_no, "abone_no", e.target.value)}
                              className="w-full bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded-md px-2.5 py-1.5 text-gray-800 dark:text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-brand-400 transition placeholder-gray-300 dark:placeholder-gray-600"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              /* Daireler Grid View grouped and colored by floor */
              <div className="flex flex-col gap-6 bg-gray-50/30 dark:bg-gray-950/20">
                {sortedFloorKeys.map((floorKey, floorIdx) => {
                  const floorRows = groupedByFloor[floorKey];
                  const floorWeight = getFloorWeight(floorKey);
                  // Alternating background colors for each floor for readability
                  const isEvenFloor = floorWeight % 2 === 0;
                  const floorBg = isEvenFloor ? "bg-white dark:bg-gray-900" : "bg-gray-50/40 dark:bg-gray-800/10";
                  
                  return (
                    <div 
                      key={floorKey} 
                      className={`p-6 border-b border-gray-100 dark:border-gray-800/50 last:border-b-0 ${floorBg}`}
                    >
                      {/* Floor Title Header */}
                      <div className="flex items-center gap-2 mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                        <span className="text-base">🏢</span>
                        <h3 className="text-sm font-extrabold text-gray-800 dark:text-gray-100 uppercase tracking-wider">
                          {floorKey}
                        </h3>
                        <span className="ml-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400">
                          {floorRows.length} Bağımsız Bölüm
                        </span>
                      </div>

                      {/* Cards Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5">
                        {floorRows.map((row) => {
                          const durum = row.sayac_durum || classifySayacDurum(row.sayac_id);
                          const meta = SAYAC_DURUM[durum];
                          const borderClass =
                            durum === "okunmadi" || durum === "hatali"
                              ? "border-red-400/60 dark:border-red-500/40"
                              : durum === "eksik"
                                ? "border-amber-400/60 dark:border-amber-500/40"
                                : "border-emerald-500/20 dark:border-emerald-500/10";
                          return (
                          <div
                            key={row.birim_no}
                            className={`bg-white dark:bg-gray-900 border ${borderClass} rounded-xl p-4 flex flex-col justify-between shadow-xs hover:shadow-md transition-all hover:-translate-y-0.5`}
                          >
                            {/* Card Top */}
                            <div className="flex items-center justify-between gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-300">
                              <span className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }}></span>
                                {row.kullanilis_sekli} {row.kapi_no || `#${row.birim_no}`}
                              </span>
                              {durum !== "gecerli" && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold text-white" style={{ backgroundColor: meta.color }}>
                                  {meta.etiket}
                                </span>
                              )}
                            </div>

                            {/* Card Middle */}
                            <div className="my-4 text-center">
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold tracking-wider">SAYAÇ NO</div>
                              <div className="text-sm font-bold text-gray-800 dark:text-gray-100 mt-0.5 tracking-wider font-mono">
                                {row.sayac_id || "GİRİLMEMİŞ"}
                              </div>
                              
                              <div className="text-[10px] text-gray-400 dark:text-gray-500 font-semibold tracking-wider mt-2.5">ABONE NO</div>
                              <div className="text-base font-extrabold text-brand-500 dark:text-brand-400 mt-0.5 font-mono">
                                {row.abone_no || "YOK"}
                              </div>
                            </div>

                            {/* Card Bottom */}
                            <div className="mt-1 pt-2.5 border-t border-gray-100 dark:border-gray-800/80 flex items-center justify-between text-[10px] text-gray-400 dark:text-gray-500 font-medium">
                              <span className="font-semibold text-gray-500 dark:text-gray-400">{row.kat || "KAT BELİRSİZ"}</span>
                              <span>{row.sayac_markasi || "Baylan"}</span>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {!loading && !noBinaInfo && rows.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0 bg-white dark:bg-gray-900">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            Değişikliklerin kaydedilmesi için Kaydet butonuna basın.
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition">
              Kapat
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block"></span>}
              💾 Kaydet
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
