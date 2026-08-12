import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SayacSyncPanel from "@/components/admin/SayacSyncPanel";
import SayacExcelImportPanel from "@/components/admin/SayacExcelImportPanel";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Sayaç Aktarım | LoraSayacTakip",
  description: "Excel dosyalarından sayaç verilerini veritabanına aktarın",
};

export default function SayacAktarimPage() {
  return (
    <div className="flex h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] flex-col overflow-hidden md:h-[calc(100dvh-6rem)] md:max-h-[calc(100dvh-6rem)]">
      <div className="shrink-0">
        <PageBreadcrumb pageTitle="Sayaç Aktarım" />
        <div className="mb-4 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
          <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Excel şablonu ile hızlı aktarım veya MASKİ kaynak dosyalarından otomatik senkronizasyon.
            Tüm işlemler yedeklenir ve geri alınabilir.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
        <div className="space-y-10 pb-6">
          <section>
            <SayacExcelImportPanel />
          </section>
          <section>
            <div className="mb-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-blue-light-200 dark:bg-blue-light-900/40" />
              <span className="rounded-full border border-blue-light-200 bg-blue-light-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-light-700 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                MASKİ Otomatik Senkron
              </span>
              <div className="h-px flex-1 bg-blue-light-200 dark:bg-blue-light-900/40" />
            </div>
            <SayacSyncPanel />
          </section>
        </div>
      </div>
    </div>
  );
}
