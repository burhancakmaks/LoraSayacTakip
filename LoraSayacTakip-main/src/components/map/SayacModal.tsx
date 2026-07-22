"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Modal } from "@/components/ui/modal";

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
  excel_kayit_id: string;
  excel_satir_no: number;
  ad_soyad: string;
  adres: string;
  mahalle: string;
  kaynak_dosya: string;
  excel_durum: string;
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
  const [rows, setRows] = useState<SayacRow[]>([]);
  const [floorOptions, setFloorOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBinaInfo, setNoBinaInfo] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "grid">("grid");
  const [selectedFloorFilter, setSelectedFloorFilter] = useState<string>("HEPSİ");
  const [unitSearch, setUnitSearch] = useState("");

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

        // Dynamically build floor options in sorted order
        const opts: string[] = [];
        if (bilgi?.has_zemin === 1) {
          opts.push("ZEMİN KAT");
        }
        const katSayisi = bilgi?.kat_sayisi || 0;
        for (let k = 1; k <= katSayisi; k++) {
          opts.push(`${k}. KAT`);
        }
        opts.push("BODRUM KAT");
        opts.push("ORTAK ALAN");
        
        // Always fetch meter rows. Imported buildings can have meters even when
        // their independent-unit metadata has not been entered yet.
        const sayacRes = await fetch(`/api/sayac?bina_id=${building.id}`);
        if (!sayacRes.ok) throw new Error("Sayaç verileri yüklenemedi.");
        const sayacPayload = await sayacRes.json();
        const existing: SayacRow[] = Array.isArray(sayacPayload) ? sayacPayload : [];

        const highestUnitNumber = existing.reduce(
          (highest, row) => Math.max(highest, Number(row.birim_no) || 0),
          0
        );
        const rowCount = Math.max(toplam, existing.length, highestUnitNumber);

        if (rowCount === 0) {
          setNoBinaInfo(true);
          setRows([]);
          setLoading(false);
          return;
        }

        setNoBinaInfo(false);

        // Include floors found in imported data as well as building metadata.
        const existingFloors = existing.map((row) => row.kat).filter(Boolean);
        const sortedOpts = Array.from(new Set([...opts, ...existingFloors])).sort(
          (a, b) => getFloorWeight(a) - getFloorWeight(b)
        );
        setFloorOptions(sortedOpts);

        // Check if there is configured data to choose default view mode
        const hasData = existing.some((r) => r.sayac_id || r.kapi_no);
        setViewMode(hasData ? "grid" : "edit");

        // Build full row array
        const defaultBlok = building.value || "";
        const existingMap = new Map(existing.map((r) => [r.birim_no, r]));
        const fullRows: SayacRow[] = Array.from({ length: rowCount }, (_, i) => {
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
            excel_kayit_id: found?.excel_kayit_id ?? "",
            excel_satir_no: found?.excel_satir_no ?? 0,
            ad_soyad: found?.ad_soyad ?? "",
            adres: found?.adres ?? "",
            mahalle: found?.mahalle ?? "",
            kaynak_dosya: found?.kaynak_dosya ?? "",
            excel_durum: found?.excel_durum ?? "",
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
      setSaved(true);
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
  const normalizedUnitSearch = unitSearch.trim().toLocaleLowerCase("tr-TR");
  const filteredRows = sortedRows.filter((row) => {
    const matchesFloor = selectedFloorFilter === "HEPSİ" || row.kat === selectedFloorFilter;
    const matchesSearch = !normalizedUnitSearch || [
      row.kapi_no,
      row.sayac_id,
      row.abone_no,
      row.ad_soyad,
      row.kat,
      row.kullanilis_sekli,
    ].some((value) => value.toLocaleLowerCase("tr-TR").includes(normalizedUnitSearch));
    return matchesFloor && matchesSearch;
  });

  const meterCount = rows.filter((row) => row.sayac_id).length;
  const subscriberCount = rows.filter((row) => row.abone_no).length;
  const completeCount = rows.filter((row) => row.sayac_id && row.abone_no).length;
  const missingCount = rows.length - completeCount;

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
      className="m-4 flex max-w-7xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-gray-900"
    >
      {/* Header */}
      <div className="border-b border-gray-100 bg-gradient-to-r from-slate-50 via-white to-emerald-50/50 px-7 pb-5 pt-6 pr-16 dark:border-gray-800 dark:from-gray-900 dark:via-gray-900 dark:to-emerald-950/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-sm font-black text-white shadow-lg shadow-emerald-500/20">S</span>
              <div>
                <h2 className="text-xl font-extrabold tracking-tight text-gray-900 dark:text-white">Sayaç Listesi ve Bölüm Planı</h2>
                <p className="text-xs font-medium text-gray-400 dark:text-gray-500">Bağımsız bölüm ve abonelik yönetimi</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-slate-900 px-3 py-1 font-bold text-white dark:bg-white dark:text-slate-900">{building?.value || "Bilinmeyen Bina"}</span>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 font-semibold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">ODA #{building?.oda_id || "—"}</span>
            </div>
          </div>

          {!loading && !noBinaInfo && rows.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Bölüm", value: rows.length, color: "text-slate-800 dark:text-white" },
                { label: "Sayaç", value: meterCount, color: "text-emerald-600" },
                { label: "Abone", value: subscriberCount, color: "text-brand-600" },
                { label: "Eksik", value: missingCount, color: missingCount ? "text-amber-600" : "text-emerald-600" },
              ].map((metric) => (
                <div key={metric.label} className="min-w-20 rounded-xl border border-gray-100 bg-white/90 px-3 py-2 text-center shadow-sm dark:border-gray-800 dark:bg-gray-800/80">
                  <div className={`text-lg font-black leading-none ${metric.color}`}>{metric.value}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{metric.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar: View Tabs & Floor Filter Select */}
      {!loading && !noBinaInfo && rows.length > 0 && (
        <div className="flex flex-col gap-3 border-b border-gray-100 bg-white px-6 py-3 dark:border-gray-800 dark:bg-gray-900 lg:flex-row lg:items-center lg:justify-between">
          {/* Tabs */}
          <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
            <button
              onClick={() => setViewMode("grid")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                viewMode === "grid"
                  ? "bg-white text-emerald-600 shadow-sm dark:bg-gray-700 dark:text-emerald-400"
                  : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              Bölüm Planı
            </button>
            <button
              onClick={() => setViewMode("edit")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-all ${
                viewMode === "edit"
                  ? "bg-white text-emerald-600 shadow-sm dark:bg-gray-700 dark:text-emerald-400"
                  : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              Düzenleme Tablosu
            </button>
          </div>

          {/* Floor filter dropdown (Only active when Daireler view is active) */}
          {viewMode === "grid" && (
            <div className="flex flex-1 flex-col gap-2 sm:flex-row lg:max-w-xl lg:justify-end">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
                <input
                  value={unitSearch}
                  onChange={(event) => setUnitSearch(event.target.value)}
                  placeholder="Daire, sayaç, abone veya ad ara..."
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs font-medium text-gray-700 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />
              </div>
              <select
                value={selectedFloorFilter}
                onChange={(e) => setSelectedFloorFilter(e.target.value)}
                aria-label="Kat filtresi"
                className="cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-emerald-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
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
                        <th className="w-28 px-2 py-3 text-left text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Sayaç No</th>
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
                          <td className="w-28 px-2 py-1.5">
                            <input
                              type="text"
                              value={row.sayac_id}
                              placeholder={row.excel_durum.includes("Eksik Sayaç") ? "Excel'de sayaç no yok" : "Örn: 02995735"}
                              onChange={(e) => updateRow(row.birim_no, "sayac_id", e.target.value)}
                              className="w-28 bg-transparent border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-brand-400 focus:bg-white dark:focus:bg-gray-800 rounded px-2 py-1 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-400 transition placeholder-gray-300 dark:placeholder-gray-600"
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
              <div className="flex flex-col bg-slate-50/60 dark:bg-gray-950/20">
                {sortedFloorKeys.length === 0 && (
                  <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-xl text-gray-400 dark:bg-gray-800">⌕</div>
                    <h3 className="font-bold text-gray-700 dark:text-gray-200">Eşleşen bölüm bulunamadı</h3>
                    <p className="mt-1 text-xs text-gray-400">Arama metnini veya kat filtresini değiştirin.</p>
                  </div>
                )}
                {sortedFloorKeys.map((floorKey) => {
                  const floorRows = groupedByFloor[floorKey];
                  const floorWeight = getFloorWeight(floorKey);
                  // Alternating background colors for each floor for readability
                  const isEvenFloor = floorWeight % 2 === 0;
                  const floorBg = isEvenFloor ? "bg-white dark:bg-gray-900" : "bg-gray-50/40 dark:bg-gray-800/10";
                  
                  return (
                    <div 
                      key={floorKey} 
                      className={`border-b border-gray-100 p-6 last:border-b-0 dark:border-gray-800/50 ${floorBg}`}
                    >
                      {/* Floor Title Header */}
                      <div className="mb-4 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-white dark:bg-white dark:text-slate-900">{floorRows.length}</span>
                          <div>
                            <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-800 dark:text-gray-100">
                          {floorKey}
                            </h3>
                            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Bağımsız bölüm planı</p>
                          </div>
                        </div>
                        <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                          {floorRows.filter((row) => row.sayac_id && row.abone_no).length}/{floorRows.length} tamamlandı
                        </span>
                      </div>

                      {/* Cards Grid */}
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3.5">
                        {floorRows.map((row) => {
                          const isComplete = Boolean(row.sayac_id && row.abone_no);
                          return (
                          <div
                            key={row.birim_no}
                            className={`group relative flex min-h-48 flex-col justify-between overflow-hidden rounded-2xl border bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:bg-gray-900 ${isComplete ? "border-emerald-200/80 hover:border-emerald-400 dark:border-emerald-900/50" : "border-amber-200/80 hover:border-amber-400 dark:border-amber-900/50"}`}
                          >
                            <span className={`absolute inset-y-0 left-0 w-1 ${isComplete ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {/* Card Top */}
                            <div className="flex items-start justify-between gap-3 pl-1">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Bağımsız Bölüm</div>
                                <div className="mt-0.5 text-sm font-extrabold text-gray-800 dark:text-gray-100">{row.kullanilis_sekli} {row.kapi_no || `#${row.birim_no}`}</div>
                              </div>
                              <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wide ${isComplete ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                                {isComplete ? "Tam" : "Eksik"}
                              </span>
                            </div>

                            {/* Card Middle */}
                            <div className="my-4 space-y-3 pl-1">
                              {row.ad_soyad && (
                                <div className="truncate text-[11px] font-semibold text-gray-500 dark:text-gray-300" title={row.ad_soyad}>
                                  {row.ad_soyad}
                                </div>
                              )}
                              <div className="rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-800/70">
                                <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400">Sayaç No</div>
                                <div className={`mt-1 font-mono text-sm font-black tracking-wider ${row.sayac_id ? "text-gray-800 dark:text-white" : "text-amber-500"}`}>
                                  {row.sayac_id || "GİRİLMEMİŞ"}
                                </div>
                              </div>
                              <div className="flex items-center justify-between px-1">
                                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-gray-400">Abone No</span>
                                <span className={`font-mono text-sm font-black ${row.abone_no ? "text-brand-600 dark:text-brand-400" : "text-amber-500"}`}>{row.abone_no || "YOK"}</span>
                              </div>
                            </div>

                            {/* Card Bottom */}
                            <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-3 pl-1 text-[10px] font-semibold text-gray-400 dark:border-gray-800/80 dark:text-gray-500">
                              <span>{row.kat || "KAT BELİRSİZ"}</span>
                              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-500 dark:bg-gray-800 dark:text-gray-300">{row.sayac_markasi || "Marka yok"}</span>
                            </div>
                          </div>
                        )})}
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
