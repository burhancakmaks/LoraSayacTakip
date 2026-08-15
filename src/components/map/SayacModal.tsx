"use client";

import React, { useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { Modal } from "@/components/ui/modal";
import { classifySayacDurum, SAYAC_DURUM, type SayacDurum } from "@/lib/sayac-durum";
import { useNotifications } from "@/context/NotificationContext";
import { notifySayacGuncellendi } from "@/lib/sayac-events";
import { useAuthUser } from "@/hooks/useAuthUser";
import { buildSayacMapUrl, copyTextToClipboard } from "@/lib/sayac-link";
import {
  type UzaktanListFilter,
  type UzaktanSayacMatch,
  buildUzaktanLookup,
  getUzaktanTypeColor,
  getUzaktanTypeLabel,
  lookupUzaktanMatch,
} from "@/lib/uzaktan-sozlesme";
import SahaKartiExportButtons from "@/components/map/SahaKartiExportButtons";
import { applyInferredKatToRows } from "@/lib/sayac-kat-infer";

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
  highlightSayacId?: string | null;
  onClose: () => void;
  onSaved?: (stats: { sayac_count: number; sayac_kayit: number; polimeter_count?: number }) => void;
  onOpenDoorLocation?: () => void;
  onOpenBuildingInfo?: () => void;
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
  "Klepsan",
  "Günal",
  "Cem",
  "Paksay",
  "Paksan",
  "Türkoğlu",
  "Teksan",
  "BRT Meter",
];

function markaSelectOptions(current: string) {
  const cur = String(current || "").trim();
  if (cur && !SAYAC_MARKALARI.includes(cur)) return [...SAYAC_MARKALARI, cur];
  return SAYAC_MARKALARI;
}

const NUM_INPUT_CLASS =
  "w-full min-w-[5.5rem] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 rounded-md px-2 py-1 text-xs font-mono tabular-nums text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 transition outline-none";

function UzaktanBadge({
  match,
  hasSayac,
}: {
  match: UzaktanSayacMatch | null;
  hasSayac: boolean;
}) {
  if (!hasSayac) return null;

  if (!match) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50/90 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/50">
        <p className="text-[7px] font-medium text-gray-500 dark:text-gray-400">Uzaktan Okuma</p>
        <p className="text-[9px] font-semibold text-gray-400 dark:text-gray-500">Sözleşmede yok</p>
      </div>
    );
  }

  const color = getUzaktanTypeColor(match.type);
  const label = getUzaktanTypeLabel(match.type);

  return (
    <div
      className="rounded-md border px-2 py-1"
      style={{
        borderColor: `${color}55`,
        backgroundColor: `${color}12`,
      }}
    >
      <p className="text-[7px] font-medium text-gray-500 dark:text-gray-400">Uzaktan Okuma</p>
      <p className="truncate text-[9px] font-bold" style={{ color }} title={label}>
        {label}
      </p>
      {match.agreement_number ? (
        <p className="truncate font-mono text-[8px] font-semibold text-gray-700 dark:text-gray-300" title={match.agreement_number}>
          Sözleşme: {match.agreement_number}
        </p>
      ) : null}
      {match.installation_number ? (
        <p className="truncate font-mono text-[8px] text-gray-500 dark:text-gray-400" title={match.installation_number}>
          Tesisat: {match.installation_number}
        </p>
      ) : null}
      {match.excel_meter !== match.sayac_id && (
        <p className="truncate font-mono text-[8px] text-gray-500 dark:text-gray-400" title={match.excel_meter}>
          Excel: {match.excel_meter}
        </p>
      )}
    </div>
  );
}

function SayacUnitCard({
  row,
  highlighted,
  binaId,
  uzaktanMatch,
  onQr,
}: {
  row: SayacRow;
  highlighted?: boolean;
  binaId: number;
  uzaktanMatch?: UzaktanSayacMatch | null;
  onQr: (row: SayacRow) => void;
}) {
  const durum: SayacDurum =
    row.sayac_durum && row.sayac_durum in SAYAC_DURUM
      ? (row.sayac_durum as SayacDurum)
      : classifySayacDurum(row.sayac_id);
  const meta = SAYAC_DURUM[durum];
  const hasSayac = row.sayac_id.trim() !== "";
  const hasAbone = row.abone_no.trim() !== "";
  const hasMarka = row.sayac_markasi.trim() !== "";
  const doorLabel = row.kapi_no || String(row.birim_no);
  const subLabel = [row.kat, row.blok_no].filter(Boolean).join(" · ");

  const showAlarm = highlighted;
  const uzaktanColor = uzaktanMatch ? getUzaktanTypeColor(uzaktanMatch.type) : null;

  return (
    <article
      className="sayac-tag group relative overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-all duration-300 hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900"
      data-highlight-birim={highlighted ? row.birim_no : undefined}
      data-sayac-row={row.sayac_id.trim() || undefined}
    >
      {showAlarm && <div className="sayac-highlight-bg pointer-events-none absolute inset-0 z-0" />}
      {uzaktanColor && (
        <div className="absolute inset-y-0 left-0 z-[1] w-1" style={{ backgroundColor: uzaktanColor }} />
      )}
      <div
        className="absolute inset-x-0 top-0 z-[1] h-1"
        style={{ backgroundColor: meta.color }}
      />

      {/* İçerik */}
      <div className="relative z-10 flex min-w-0 flex-col gap-1.5 p-2 pt-2.5">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold text-gray-900 dark:text-white">No {doorLabel} · {row.kullanilis_sekli}</p>
            {subLabel ? (
              <p className="truncate text-[9px] text-gray-500 dark:text-gray-400">{subLabel}</p>
            ) : null}
          </div>
          <span
            className="shrink-0 rounded-full border px-1 py-px text-[7px] font-bold uppercase tracking-wide"
            style={{
              color: meta.color,
              borderColor: `${meta.color}44`,
              backgroundColor: `${meta.color}12`,
            }}
          >
            {meta.etiket}
          </span>
        </div>

        <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
          <p className="text-[7px] font-medium text-gray-500 dark:text-gray-400">Sayaç</p>
          <p
            className="truncate font-mono text-[10px] font-semibold leading-tight tabular-nums text-gray-900 dark:text-white"
            title={hasSayac ? row.sayac_id : undefined}
          >
            {hasSayac ? row.sayac_id : "— — —"}
          </p>
        </div>

        <div
          className={`flex items-center justify-between gap-1 rounded-md border px-2 py-1 ${
            hasMarka
              ? "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/70"
              : "border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-800/50"
          }`}
        >
          <span className="text-[7px] font-medium text-gray-500 dark:text-gray-400">Marka</span>
          <span
            className={`truncate text-[9px] font-semibold ${
              hasMarka ? "text-gray-800 dark:text-gray-200" : "text-gray-400"
            }`}
            title={hasMarka ? row.sayac_markasi : undefined}
          >
            {hasMarka ? row.sayac_markasi : "—"}
          </span>
        </div>

        <div
          className={`flex items-center justify-between gap-1 rounded-md border px-2 py-1 ${
            hasAbone
              ? "border-blue-light-300/70 bg-blue-light-50/90 dark:border-blue-light-700/50 dark:bg-blue-light-950/35"
              : "border-gray-200 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-800/50"
          }`}
        >
          <span className="text-[7px] font-medium text-gray-500 dark:text-gray-400">
            Abone
          </span>
          <span
            className={`truncate font-mono text-[9px] font-semibold tabular-nums ${
              hasAbone ? "text-blue-light-800 dark:text-blue-light-300" : "text-gray-400"
            }`}
            title={hasAbone ? row.abone_no : undefined}
          >
            {hasAbone ? row.abone_no : "—"}
          </span>
        </div>

        <UzaktanBadge match={uzaktanMatch ?? null} hasSayac={hasSayac} />

        {hasSayac && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => onQr(row)}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-blue-light-300 bg-blue-light-50 px-1.5 py-1 text-[9px] font-bold text-blue-light-800 transition hover:bg-blue-light-100 dark:border-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300 dark:hover:bg-blue-light-950/60"
              title="Sayaç QR kodunu göster"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6z" />
                <path d="M14 14h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2z" />
              </svg>
              QR
            </button>
            <SahaKartiExportButtons
              binaId={binaId}
              sayacId={row.sayac_id}
              aboneNo={row.abone_no || undefined}
              compact
              className="w-full"
            />
          </div>
        )}
      </div>

    </article>
  );
}

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

function normSayacDigits(value: string) {
  return value.trim().replace(/^2025-/i, "").replace(/\D/g, "");
}

function matchesHighlightSayac(row: SayacRow, highlightSayacId?: string | null) {
  if (!highlightSayacId?.trim() || !row.sayac_id.trim()) return false;
  return normSayacDigits(row.sayac_id) === normSayacDigits(highlightSayacId);
}

export default function SayacModal({
  building,
  highlightSayacId,
  onClose,
  onSaved,
  onOpenDoorLocation,
  onOpenBuildingInfo,
}: SayacModalProps) {
  const { refresh } = useNotifications();
  const { canEdit } = useAuthUser();
  const [rows, setRows] = useState<SayacRow[]>([]);
  const [floorOptions, setFloorOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBinaInfo, setNoBinaInfo] = useState(false);
  const [viewMode, setViewMode] = useState<"edit" | "grid">("grid");
  const [selectedFloorFilter, setSelectedFloorFilter] = useState<string>("HEPSİ");
  const [qrPreview, setQrPreview] = useState<{
    sayacId: string;
    url: string;
    dataUrl: string | null;
  } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [uzaktanLookup, setUzaktanLookup] = useState<Map<string, UzaktanSayacMatch>>(new Map());
  const [uzaktanBinaMatched, setUzaktanBinaMatched] = useState(false);
  const [uzaktanListFilter, setUzaktanListFilter] = useState<UzaktanListFilter>("all");

  const handleShowQr = useCallback(
    async (row: SayacRow) => {
      if (!building || !row.sayac_id.trim()) return;
      const sayacId = row.sayac_id.trim();
      const url = buildSayacMapUrl(building.id, sayacId);
      setQrError(null);
      setQrPreview({ sayacId, url, dataUrl: null });
      try {
        const dataUrl = await QRCode.toDataURL(url, {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#101828", light: "#ffffff" },
        });
        setQrPreview((current) =>
          current?.sayacId === sayacId ? { ...current, dataUrl } : current
        );
      } catch {
        setQrError("QR kod oluşturulamadı.");
      }
    },
    [building]
  );

  const handleCopyQrLink = useCallback(async () => {
    if (!qrPreview) return;
    const copied = await copyTextToClipboard(qrPreview.url);
    if (!copied) setQrError("Link kopyalanamadı.");
  }, [qrPreview]);

  useEffect(() => {
    if (!building) return;
    setLoading(true);
    setSaved(false);
    setError(null);
    setNoBinaInfo(false);
    setSelectedFloorFilter("HEPSİ");
    setQrPreview(null);
    setQrError(null);
    setUzaktanLookup(new Map());
    setUzaktanBinaMatched(false);
    setUzaktanListFilter("all");

    fetch(`/api/uzaktan-sozlesme?bina_id=${building.id}`)
      .then((r) => r.json())
      .then((data: { matched?: boolean; sayaclar?: UzaktanSayacMatch[] }) => {
        if (!data.matched || !data.sayaclar?.length) {
          setUzaktanLookup(new Map());
          setUzaktanBinaMatched(false);
          return;
        }
        setUzaktanBinaMatched(true);
        setUzaktanLookup(buildUzaktanLookup(data.sayaclar));
      })
      .catch(() => {
        setUzaktanLookup(new Map());
        setUzaktanBinaMatched(false);
      });

    // Fetch bina_bilgi
    fetch(`/api/bina-bilgi?bina_id=${building.id}`)
      .then((r) => r.json())
      .then(async (bilgi) => {
        const toplamBilgi: number = bilgi?.["toplam_bagımsız_bolum"] ?? bilgi?.toplam_bagımsız_bolum ?? 0;

        const opts: string[] = [];
        if (bilgi?.has_zemin === 1 || (!bilgi?.kat_sayisi && toplamBilgi > 0)) {
          opts.push("ZEMİN KAT");
        }
        const katSayisi = bilgi?.kat_sayisi || 0;
        for (let k = 1; k <= katSayisi; k++) {
          opts.push(`${k}. KAT`);
        }
        opts.push("BODRUM KAT");
        opts.push("ORTAK ALAN");
        const sortedOpts = [...opts].sort((a, b) => getFloorWeight(a) - getFloorWeight(b));
        setFloorOptions(sortedOpts);

        const sayacRes = await fetch(`/api/sayac?bina_id=${building.id}`);
        const sayacPayload = await sayacRes.json();
        const existing: SayacRow[] = Array.isArray(sayacPayload) ? sayacPayload : [];
        const highestUnitNumber = existing.reduce(
          (highest, row) => Math.max(highest, Number(row.birim_no) || 0),
          0
        );
        const rowCount = Math.max(toplamBilgi, existing.length, highestUnitNumber);
        if (rowCount === 0) {
          setNoBinaInfo(true);
          setRows([]);
          setLoading(false);
          return;
        }
        setNoBinaInfo(false);

        const hasData = existing.some((r) => r.sayac_id || r.kapi_no);
        setViewMode(hasData ? "grid" : "edit");

        const defaultBlok = building.value || "";
        const existingMap = new Map(existing.map((r) => [Number(r.birim_no), r]));
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
            sayac_durum: found?.sayac_durum,
          };
        });

        setRows(applyInferredKatToRows(fullRows, bilgi || {}));
        setLoading(false);
      })
      .catch(() => {
        setError("Veriler yüklenirken hata oluştu.");
        setLoading(false);
      });
  }, [building]);

  useEffect(() => {
    if (!highlightSayacId?.trim() || loading || rows.length === 0) return;
    const matchRow = rows.find((r) => matchesHighlightSayac(r, highlightSayacId));
    if (!matchRow) return;
    if (matchRow.kat) setSelectedFloorFilter(matchRow.kat);
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[data-highlight-birim="${matchRow.birim_no}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [highlightSayacId, loading, rows, viewMode]);

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
      onSaved?.({
        sayac_count: data.sayac_count ?? 0,
        sayac_kayit: data.sayac_kayit ?? 0,
        polimeter_count: data.polimeter_count ?? 0,
      });
      notifySayacGuncellendi();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Kayıt sırasında hata oluştu.");
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

  const girilenSayac = rows.filter((r) => r.sayac_id.trim() !== "").length;
  const dolulukYuzde = rows.length > 0 ? Math.round((girilenSayac / rows.length) * 100) : 0;
  const uzaktanEslesenSayac = rows.filter(
    (r) => r.sayac_id.trim() && lookupUzaktanMatch(uzaktanLookup, r.sayac_id)
  ).length;

  const matchesUzaktanListFilter = (row: SayacRow) => {
    if (uzaktanListFilter === "all") return true;
    const hasSayac = row.sayac_id.trim() !== "";
    const matched = hasSayac && lookupUzaktanMatch(uzaktanLookup, row.sayac_id);
    if (uzaktanListFilter === "matched") return Boolean(matched);
    if (uzaktanListFilter === "missing") return hasSayac && !matched;
    return true;
  };

  const uzaktanFilteredRows = sortedRows.filter(matchesUzaktanListFilter);

  // Filter rows based on floor filter dropdown selection
  const filteredRows =
    selectedFloorFilter === "HEPSİ"
      ? uzaktanFilteredRows
      : uzaktanFilteredRows.filter((r) => r.kat === selectedFloorFilter);

  // Group sorted units by floor for rendering card sections
  const groupedByFloor: { [key: string]: SayacRow[] } = {};
  filteredRows.forEach((row) => {
    const floorName = row.kat.trim() || "1. KAT";
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
      {onOpenBuildingInfo && (
        <div className="border-b border-blue-light-200/80 bg-gradient-to-r from-blue-light-50 to-white px-5 py-3 dark:border-blue-light-900/50 dark:from-blue-light-950/50 dark:to-gray-900">
          <button
            type="button"
            onClick={onOpenBuildingInfo}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-blue-light-500 bg-white px-4 py-2.5 text-sm font-bold text-blue-light-800 shadow-md shadow-blue-light-500/15 transition hover:bg-blue-light-50 hover:shadow-lg dark:border-blue-light-600 dark:bg-gray-900 dark:text-blue-light-300 dark:hover:bg-blue-light-950/40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M3 21h18" />
              <path d="M5 21V7l8-4v18" />
              <path d="M19 21V11l-6-4" />
            </svg>
            Bina Bilgileri
          </button>
        </div>
      )}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-light-50 text-sm font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300">
            {building?.oda_id ?? "—"}
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Sayaç Listesi</h2>
              <p className="mt-0.5 truncate text-[10px] font-medium text-gray-600 dark:text-gray-300">
                {building?.value || "Bilinmeyen Bina"}
              </p>
              {onOpenDoorLocation && (
                <button
                  type="button"
                  onClick={onOpenDoorLocation}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                  title="Dış kapı konumunu Google Maps'te aç"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  Kapı Konumu
                </button>
              )}
            </div>
            {!loading && !noBinaInfo && rows.length > 0 && (
              <div className="flex min-w-[120px] items-center gap-2 rounded-xl border border-dashed border-violet-300/60 bg-violet-50/80 px-2.5 py-1.5 dark:border-violet-700/40 dark:bg-violet-950/30">
                <div className="flex-1">
                  <div className="mb-0.5 flex justify-between text-[8px] font-bold uppercase tracking-wide text-gray-500">
                    <span>Sözleşme</span>
                    <span className="tabular-nums text-violet-700 dark:text-violet-300">
                      {uzaktanEslesenSayac}/{girilenSayac || rows.length}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-950">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400"
                      style={{
                        width: `${girilenSayac > 0 ? Math.round((uzaktanEslesenSayac / girilenSayac) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
            {!loading && !noBinaInfo && rows.length > 0 && (
              <div className="flex min-w-[120px] items-center gap-2 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/80 px-2.5 py-1.5 dark:border-blue-light-700/40 dark:bg-blue-light-950/30">
                <div className="flex-1">
                  <div className="mb-0.5 flex justify-between text-[8px] font-bold uppercase tracking-wide text-gray-500">
                    <span>Doluluk</span>
                    <span className="tabular-nums text-blue-light-700 dark:text-blue-light-300">{dolulukYuzde}%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-blue-light-100 dark:bg-blue-light-950">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-light-500 to-blue-light-400"
                      style={{ width: `${dolulukYuzde}%` }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-[9px] font-bold tabular-nums text-gray-500">
                  {girilenSayac}/{rows.length}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar: View Tabs & Floor Filter Select */}
      {!loading && !noBinaInfo && rows.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-2 gap-2">
          <div className="inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-800">
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                viewMode === "grid"
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Kart
            </button>
            {canEdit && (
              <button
                onClick={() => setViewMode("edit")}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  viewMode === "edit"
                    ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Tablo
              </button>
            )}
          </div>

          {uzaktanBinaMatched && (
            <div className="flex items-center gap-1.5 sm:ml-2">
              <label className="text-[10px] font-medium text-gray-500">Sözleşme</label>
              <select
                value={uzaktanListFilter}
                onChange={(e) => setUzaktanListFilter(e.target.value as UzaktanListFilter)}
                className="rounded-md border border-violet-200 dark:border-violet-800 bg-white dark:bg-gray-800 px-2 py-1 text-[11px] font-medium text-violet-800 dark:text-violet-300 focus:outline-none focus:ring-1 focus:ring-violet-500/30 cursor-pointer"
              >
                <option value="all">Tümü</option>
                <option value="matched">Sözleşmede var</option>
                <option value="missing">Sözleşmede yok</option>
              </select>
            </div>
          )}

          {viewMode === "grid" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] font-medium text-gray-500">Kat</label>
                <select
                  value={selectedFloorFilter}
                  onChange={(e) => setSelectedFloorFilter(e.target.value)}
                  className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-[11px] font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 cursor-pointer"
                >
                  <option value="HEPSİ">Tüm katlar</option>
                  {floorOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div className="hidden sm:flex flex-wrap items-center gap-1.5">
                {(Object.values(SAYAC_DURUM) as (typeof SAYAC_DURUM)[SayacDurum][]).map((d) => (
                  <span
                    key={d.durum}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold text-white"
                    style={{ backgroundColor: d.color }}
                  >
                    <span>{d.icon}</span>
                    {d.etiket}
                  </span>
                ))}
              </div>
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
              Sayaç ekleyebilmek için önce <strong>&quot;Bina Bilgileri Düzenle&quot;</strong> butonuna tıklayarak kat ve toplam daire sayısını girin.
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
                    <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
                    Girilen sayaç: <strong className="text-emerald-600 dark:text-emerald-400">{girilenSayac}</strong>
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
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-32">Sayaç No</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-28">Sicil No</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide w-28">Abone No</th>
                        <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide w-32">Uzaktan Okuma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uzaktanFilteredRows.map((row, idx) => {
                        const highlighted = matchesHighlightSayac(row, highlightSayacId);
                        const showAlarm = highlighted;
                        const uzaktanMatch = lookupUzaktanMatch(uzaktanLookup, row.sayac_id);
                        return (
                        <tr
                          key={row.birim_no}
                          data-highlight-birim={highlighted ? row.birim_no : undefined}
                          className={`border-b border-gray-50 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40 ${
                            idx % 2 === 0 ? "" : "bg-gray-50/30 dark:bg-gray-900"
                          } ${showAlarm ? "sayac-highlight-row" : highlighted ? "bg-blue-light-50/70 dark:bg-blue-light-950/25" : ""}`}
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
                              {markaSelectOptions(row.sayac_markasi).map((marka) => (
                                <option key={marka} value={marka} className="dark:bg-gray-900">
                                  {marka}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Sayaç No */}
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.sayac_id}
                              placeholder="02995735"
                              onChange={(e) => updateRow(row.birim_no, "sayac_id", e.target.value)}
                              className={NUM_INPUT_CLASS}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.sicil_no}
                              placeholder="641286"
                              onChange={(e) => updateRow(row.birim_no, "sicil_no", e.target.value)}
                              className={NUM_INPUT_CLASS}
                            />
                          </td>

                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.abone_no}
                              placeholder="462052"
                              onChange={(e) => updateRow(row.birim_no, "abone_no", e.target.value)}
                              className={NUM_INPUT_CLASS}
                            />
                          </td>

                          <td className="px-3 py-2">
                            {row.sayac_id.trim() ? (
                              uzaktanMatch ? (
                                <div className="flex flex-col gap-0.5">
                                  <span
                                    className="inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold"
                                    style={{
                                      color: getUzaktanTypeColor(uzaktanMatch.type),
                                      borderColor: `${getUzaktanTypeColor(uzaktanMatch.type)}44`,
                                      backgroundColor: `${getUzaktanTypeColor(uzaktanMatch.type)}12`,
                                    }}
                                  >
                                    {getUzaktanTypeLabel(uzaktanMatch.type)}
                                  </span>
                                  {uzaktanMatch.agreement_number ? (
                                    <span className="font-mono text-[10px] font-semibold text-gray-700 dark:text-gray-200">
                                      {uzaktanMatch.agreement_number}
                                    </span>
                                  ) : null}
                                  {uzaktanMatch.installation_number ? (
                                    <span className="font-mono text-[9px] text-gray-500 dark:text-gray-400">
                                      Tesisat {uzaktanMatch.installation_number}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-[10px] font-medium text-gray-400">Sözleşmede yok</span>
                              )
                            ) : (
                              <span className="text-[10px] text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              /* Daireler Grid View grouped by floor */
              <div className="flex flex-col gap-2 p-2 sm:p-3">
                {sortedFloorKeys.map((floorKey) => {
                  const floorRows = groupedByFloor[floorKey];
                  const floorDolu = floorRows.filter((r) => r.sayac_id.trim()).length;

                  return (
                    <section
                      key={floorKey}
                      className="overflow-hidden rounded-lg border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900"
                    >
                      <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1 dark:border-gray-800">
                        <h3 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-gray-800 dark:text-gray-100">
                          {floorKey}
                        </h3>
                        <span className="shrink-0 text-[9px] font-medium tabular-nums text-gray-600 dark:text-gray-400">
                          {floorDolu}/{floorRows.length}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1 p-1 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
                        {floorRows.map((row) => (
                          <SayacUnitCard
                            key={row.birim_no}
                            row={row}
                            binaId={building?.id ?? 0}
                            uzaktanMatch={lookupUzaktanMatch(uzaktanLookup, row.sayac_id)}
                            highlighted={matchesHighlightSayac(row, highlightSayacId)}
                            onQr={handleShowQr}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {!loading && !noBinaInfo && rows.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 shrink-0 bg-white dark:bg-gray-900">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-gray-400">
              {canEdit ? "Kaydetmek için Kaydet'e basın." : "Salt görüntüleme yetkisi"}
            </span>
            {building && (
              <SahaKartiExportButtons binaId={building.id} />
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            >
              Kapat
            </button>
            {canEdit && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-light-600 hover:bg-blue-light-700 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-1.5"
              >
                {saving && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent inline-block" />
                )}
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            )}
          </div>
        </div>
      )}

      {qrPreview && (
        <div
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm"
          onClick={() => setQrPreview(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Sayaç ${qrPreview.sayacId} QR kodu`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Sayaç QR Kodu</h3>
                <p className="mt-1 font-mono text-xs font-semibold text-blue-light-700 dark:text-blue-light-400">
                  {qrPreview.sayacId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrPreview(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                aria-label="QR penceresini kapat"
              >
                ×
              </button>
            </div>

            <div className="mt-4 flex min-h-72 items-center justify-center rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700">
              {qrPreview.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrPreview.dataUrl}
                  alt={`Sayaç ${qrPreview.sayacId} QR kodu`}
                  width={280}
                  height={280}
                  className="h-auto w-full max-w-[280px]"
                />
              ) : qrError ? (
                <p className="text-sm font-medium text-error-500">{qrError}</p>
              ) : (
                <div className="h-8 w-8 animate-spin rounded-full border-3 border-blue-light-500 border-t-transparent" />
              )}
            </div>

            <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {qrPreview.url}
            </p>
            {qrPreview.url.startsWith("http://localhost") && (
              <p className="mt-2 text-[10px] font-medium text-warning-600 dark:text-warning-400">
                Bu QR yalnızca yerel bilgisayarda çalışır. Saha kullanımı için uygulamayı erişilebilir bir adreste yayınlayın.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={handleCopyQrLink}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Linki Kopyala
              </button>
              {qrPreview.dataUrl && (
                <a
                  href={qrPreview.dataUrl}
                  download={`sayac-${qrPreview.sayacId.replace(/[^a-zA-Z0-9_-]/g, "-")}-qr.png`}
                  className="flex-1 rounded-lg bg-blue-light-600 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-blue-light-700"
                >
                  QR İndir
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
