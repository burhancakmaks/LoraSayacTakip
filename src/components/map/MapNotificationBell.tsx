"use client";

import React from "react";
import { useNotifications, type BildirimItem } from "@/context/NotificationContext";
import { SAYAC_DURUM, type SayacDurum } from "@/lib/sayac-durum";

function tipStyle(tip: string) {
  if (tip === "duzeltildi") return { bg: "bg-emerald-500", label: "Düzeltildi" };
  if (tip in SAYAC_DURUM) return { bg: "", label: SAYAC_DURUM[tip as SayacDurum].etiket, color: SAYAC_DURUM[tip as SayacDurum].color };
  return { bg: "bg-blue-light-500", label: tip };
}

function timeAgo(iso: string) {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  return new Date(iso).toLocaleDateString("tr-TR");
}

interface MapNotificationBellProps {
  onBinaClick?: (binaId: number) => void;
  onToggle?: (open: boolean) => void;
}

export default function MapNotificationBell({ onBinaClick, onToggle }: MapNotificationBellProps) {
  const { items, unread, panelOpen, setPanelOpen, markAllRead, markRead } = useNotifications();

  const handleItemClick = (item: BildirimItem) => {
    if (!item.okundu) markRead([item.id]);
    if (item.bina_id && onBinaClick) {
      onBinaClick(item.bina_id);
      setPanelOpen(false);
    }
  };

  return (
    <div className="relative shrink-0 overflow-visible">
      {panelOpen && (
        <div className="absolute right-0 top-full z-[1001] mt-1.5 flex max-h-80 w-80 flex-col overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white/98 shadow-2xl backdrop-blur-md dark:border-blue-light-900/40 dark:bg-gray-900/98 sm:w-96">
          <div className="flex shrink-0 items-center justify-between border-b border-blue-light-100 px-4 py-3 dark:border-blue-light-900/30">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Bildirimler</h3>
              <p className="text-[10px] text-gray-500 dark:text-gray-400">Anlık sayaç uyarıları</p>
            </div>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="shrink-0 text-[10px] font-semibold text-blue-light-700 hover:underline dark:text-blue-light-400"
              >
                Tümünü oku
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500">Henüz bildirim yok.</div>
            ) : (
              items.map((item) => {
                const style = tipStyle(item.tip);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    className={`flex w-full gap-3 border-b border-blue-light-50 px-4 py-3 text-left transition last:border-0 hover:bg-blue-light-50/60 dark:border-blue-light-900/20 dark:hover:bg-blue-light-950/30 ${
                      !item.okundu ? "bg-blue-light-50/40 dark:bg-blue-light-950/20" : ""
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.bg || ""}`}
                      style={style.color ? { backgroundColor: style.color } : undefined}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">{item.baslik}</span>
                        {!item.okundu && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-light-500" />}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">{item.mesaj}</span>
                      <span className="mt-1 block text-[10px] text-gray-400">{timeAgo(item.created_at)}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          const next = !panelOpen;
          onToggle?.(next);
          setPanelOpen(next);
        }}
        className={`relative flex h-[34px] w-[34px] items-center justify-center rounded-xl border transition ${
          panelOpen
            ? "border-blue-light-600 bg-blue-light-600 text-white shadow-sm"
            : "border-blue-light-100 bg-blue-light-50/60 text-blue-light-800 hover:border-blue-light-300 hover:bg-blue-light-50 dark:border-blue-light-900/40 dark:bg-blue-light-950/25 dark:text-blue-light-300 dark:hover:border-blue-light-700"
        }`}
        title="Bildirimler"
      >
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-error-500 px-1 text-[9px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H4.37504H15.625H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
          />
        </svg>
      </button>
    </div>
  );
}
