"use client";

import React, { useCallback, useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";
import { ArrowUpIcon, GroupIcon } from "@/icons";
import { SAYAC_GUNCELLENDI } from "@/lib/sayac-events";

interface DashboardOzet {
  toplam_bina: number;
  toplam_sayac: number;
  maski_sayac?: number;
  birim_kaydi: number;
  abone_nolu: number;
  lora_toplam: number;
  lora_aktif: number;
  lora_kayitli: number;
  lora_hata: number;
  lora_eslesen: number;
  lora_bina: number;
  konum_toplam?: number;
  konum_yeni?: number;
  konum_eslesen?: number;
  sayac_koordinatli?: number;
}

function SayacIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 4h8M9 20h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LoraIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"
        fill="currentColor"
      />
      <path
        d="M8.5 14.5a5 5 0 017 0M6 11a8.5 8.5 0 0112 0M4 7.5c4.5-4 11.5-4 16 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 21s7-5.2 7-11a7 7 0 10-14 0c0 5.8 7 11 7 11z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function formatNum(n: number) {
  return n.toLocaleString("tr-TR");
}

export const EcommerceMetrics = () => {
  const [ozet, setOzet] = useState<DashboardOzet | null>(null);

  const loadOzet = useCallback(() => {
    fetch("/api/dashboard/ozet")
      .then((r) => r.json())
      .then((data: DashboardOzet) => setOzet(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadOzet();
    window.addEventListener(SAYAC_GUNCELLENDI, loadOzet);
    return () => window.removeEventListener(SAYAC_GUNCELLENDI, loadOzet);
  }, [loadOzet]);

  const maski = ozet?.maski_sayac ?? ozet?.toplam_sayac ?? 0;
  const koordinatli = ozet?.sayac_koordinatli ?? 0;
  const konumExcel = ozet?.konum_toplam ?? 0;

  const aboneOran =
    ozet && maski > 0 ? Math.round((ozet.abone_nolu / maski) * 1000) / 10 : 0;

  const koordinatOran =
    maski > 0 ? Math.round((koordinatli / maski) * 1000) / 10 : 0;

  const loraAktifOran =
    ozet && ozet.lora_toplam > 0
      ? Math.round((ozet.lora_aktif / ozet.lora_toplam) * 1000) / 10
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
          <GroupIcon className="text-gray-800 size-6 dark:text-white/90" />
        </div>
        <div className="flex items-end justify-between mt-5">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Toplam Bina</span>
            <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
              {ozet ? formatNum(ozet.toplam_bina) : "—"}
            </h4>
            {ozet && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Harita poligonları
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-brand-50 rounded-xl dark:bg-brand-500/10">
          <SayacIcon className="text-brand-600 dark:text-brand-400 size-6" />
        </div>
        <div className="flex items-end justify-between mt-5">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Toplam Sayaç</span>
            <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
              {ozet ? formatNum(ozet.toplam_sayac) : "—"}
            </h4>
            {ozet && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {formatNum(maski)} kayıtlı · {formatNum(ozet.abone_nolu)} abone
              </p>
            )}
          </div>
          {ozet && ozet.toplam_sayac > 0 && (
            <Badge color="success">
              <ArrowUpIcon />
              {aboneOran}%
            </Badge>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 dark:bg-sky-500/10">
          <PinIcon className="size-6 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="mt-5 flex items-end justify-between">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Koordinatlı Sayaç</span>
            <h4 className="text-title-sm mt-2 font-bold text-gray-800 dark:text-white/90">
              {ozet ? formatNum(koordinatli) : "—"}
            </h4>
            {ozet && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Haritada gerçek pin · Excel {formatNum(konumExcel)} konum
              </p>
            )}
          </div>
          {ozet && maski > 0 && (
            <Badge color="success">
              <ArrowUpIcon />
              {koordinatOran}%
            </Badge>
          )}
        </div>
        {ozet && (
          <p className="mt-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
            Lat/lng dolu sayaçlar. Arama/pin bina merkezine değil, Excel’deki noktaya gider.
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-emerald-50 rounded-xl dark:bg-emerald-500/10">
          <LoraIcon className="text-emerald-600 dark:text-emerald-400 size-6" />
        </div>
        <div className="flex items-end justify-between mt-5">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">LoRa Cihaz (DevEUI)</span>
            <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
              {ozet ? formatNum(ozet.lora_toplam ?? 0) : "—"}
            </h4>
            {ozet && (
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                {formatNum(ozet.lora_aktif ?? 0)} aktif · {formatNum(ozet.lora_eslesen ?? 0)} eşleşen ·{" "}
                {formatNum(ozet.lora_bina ?? 0)} bina
              </p>
            )}
          </div>
          {ozet && (ozet.lora_toplam ?? 0) > 0 && (
            <Badge color="success">
              <ArrowUpIcon />
              {loraAktifOran}%
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
