"use client";

import React, { useCallback, useEffect, useState } from "react";
import Badge from "../ui/badge/Badge";
import { ArrowDownIcon, ArrowUpIcon, BoxIconLine, GroupIcon } from "@/icons";
import { SAYAC_GUNCELLENDI } from "@/lib/sayac-events";

interface DashboardOzet {
  toplam_bina: number;
  toplam_sayac: number;
  birim_kaydi: number;
  abone_nolu: number;
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

  const aboneOran =
    ozet && ozet.toplam_sayac > 0
      ? Math.round((ozet.abone_nolu / ozet.toplam_sayac) * 1000) / 10
      : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 md:gap-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
          <GroupIcon className="text-gray-800 size-6 dark:text-white/90" />
        </div>

        <div className="flex items-end justify-between mt-5">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Customers</span>
            <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">3,782</h4>
          </div>
          <Badge color="success">
            <ArrowUpIcon />
            11.01%
          </Badge>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
        <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl dark:bg-gray-800">
          <BoxIconLine className="text-gray-800 dark:text-white/90" />
        </div>
        <div className="flex items-end justify-between mt-5">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Orders</span>
            <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">5,359</h4>
          </div>

          <Badge color="error">
            <ArrowDownIcon className="text-error-500" />
            9.05%
          </Badge>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6 sm:col-span-2 xl:col-span-1">
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
                {formatNum(ozet.abone_nolu)} abone · {formatNum(ozet.birim_kaydi)} birim kaydı
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
    </div>
  );
};
