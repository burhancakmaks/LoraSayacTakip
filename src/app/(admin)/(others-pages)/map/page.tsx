"use client";

import dynamic from "next/dynamic";
import React, { Suspense } from "react";
import { NotificationProvider } from "@/context/NotificationContext";

const MapComponent = dynamic(
  () => import("@/components/map/MapComponent"),
  {
    ssr: false,
    loading: () => (
      <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-950">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.12),transparent_40%),radial-gradient(circle_at_80%_10%,rgba(70,95,255,0.12),transparent_35%)]" />
        <div className="relative flex flex-col items-center">
          <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-emerald-500/30 border-t-emerald-500" />
          <p className="mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Harita yükleniyor…
          </p>
        </div>
      </div>
    ),
  }
);

export default function MapPage() {
  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
      <title>Malatya Bina Haritası | Lora Sayaç Takip</title>
      <meta
        name="description"
        content="SQLite veritabanından alınan Malatya ili binaları ve sayaç aboneliklerinin interaktif harita gösterimi."
      />
      <NotificationProvider>
        <Suspense
          fallback={
            <div className="flex h-full w-full flex-col items-center justify-center">
              <div className="h-11 w-11 animate-spin rounded-full border-[3px] border-emerald-500/30 border-t-emerald-500" />
              <p className="mt-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Harita hazırlanıyor…
              </p>
            </div>
          }
        >
          <MapComponent />
        </Suspense>
      </NotificationProvider>
    </div>
  );
}
