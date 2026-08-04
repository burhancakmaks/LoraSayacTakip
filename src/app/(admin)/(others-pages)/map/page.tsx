"use client";

import dynamic from "next/dynamic";
import React, { Suspense } from "react";
import { NotificationProvider } from "@/context/NotificationContext";

// Dynamic import with ssr: false is required since Leaflet relies on browser window global objects.
const MapComponent = dynamic(
  () => import("@/components/map/MapComponent"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
        <p className="mt-4 font-semibold text-gray-700 dark:text-gray-200">
          Harita modülü yükleniyor...
        </p>
      </div>
    ),
  }
);

export default function MapPage() {
  return (
    <div className="w-full h-full relative overflow-hidden">
      <title>Malatya Bina Haritası | Lora Sayaç Takip</title>
      <meta 
        name="description" 
        content="SQLite veritabanından alınan Malatya ili binaları ve sayaç aboneliklerinin interaktif harita gösterimi." 
      />
      <NotificationProvider>
        <Suspense
          fallback={
            <div className="flex h-full w-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
              <p className="mt-4 font-semibold text-gray-700 dark:text-gray-200">
                Harita hazırlanıyor...
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
