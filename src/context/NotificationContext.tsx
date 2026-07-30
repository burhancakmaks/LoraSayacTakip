"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { SAYAC_DURUM, type SayacDurum } from "@/lib/sayac-durum";

export interface BildirimItem {
  id: number;
  tip: string;
  baslik: string;
  mesaj: string;
  bina_id: number | null;
  birim_no: number | null;
  okundu: number;
  created_at: string;
}

export interface ToastItem {
  key: string;
  baslik: string;
  mesaj: string;
  tip: string;
}

interface NotificationContextValue {
  items: BildirimItem[];
  unread: number;
  toasts: ToastItem[];
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  markAllRead: () => Promise<void>;
  markRead: (ids: number[]) => Promise<void>;
  dismissToast: (key: string) => void;
  refresh: () => Promise<void>;
  pushLocal: (item: Omit<ToastItem, "key">) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const POLL_MS = 20_000;
const TOAST_TTL_MS = 12_000;
const MAX_TOAST_SHOWS = 3;

function tipColor(tip: string) {
  if (tip === "duzeltildi") return "#10b981";
  if (tip in SAYAC_DURUM) return SAYAC_DURUM[tip as SayacDurum].color;
  return "#465fff";
}

/** SQLite datetime('now') ile uyumlu: "YYYY-MM-DD HH:MM:SS" */
function sqliteNow() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BildirimItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const sinceRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const toastShowCountRef = useRef<Map<number, number>>(new Map());
  const pendingToastRef = useRef<Map<number, BildirimItem>>(new Map());

  const addToast = useCallback((toast: Omit<ToastItem, "key">) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev.slice(-4), { ...toast, key }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.key !== key));
    }, TOAST_TTL_MS);
  }, []);

  const showPendingRepeats = useCallback(() => {
    for (const [id, item] of Array.from(pendingToastRef.current.entries())) {
      const count = toastShowCountRef.current.get(id) ?? 0;
      if (count >= MAX_TOAST_SHOWS) {
        pendingToastRef.current.delete(id);
        continue;
      }
      addToast({ baslik: item.baslik, mesaj: item.mesaj, tip: item.tip });
      const next = count + 1;
      toastShowCountRef.current.set(id, next);
      if (next >= MAX_TOAST_SHOWS) pendingToastRef.current.delete(id);
    }
  }, [addToast]);

  const fetchList = useCallback(async () => {
    const res = await fetch("/api/bildirimler?limit=40");
    if (!res.ok) return;
    const data = (await res.json()) as { items: BildirimItem[]; unread: number };
    setItems(data.items);
    setUnread(data.unread);

    if (!initializedRef.current) {
      data.items.forEach((i) => toastShowCountRef.current.set(i.id, MAX_TOAST_SHOWS));
      initializedRef.current = true;
      sinceRef.current = sqliteNow();
    }
  }, []);

  const fetchNewToasts = useCallback(async () => {
    if (!sinceRef.current) return;
    const params = new URLSearchParams({ limit: "20", since: sinceRef.current });
    const res = await fetch(`/api/bildirimler?${params}`);
    if (!res.ok) return;
    const data = (await res.json()) as { items: BildirimItem[]; unread: number };

    for (const i of data.items) {
      if (toastShowCountRef.current.has(i.id)) continue;
      addToast({ baslik: i.baslik, mesaj: i.mesaj, tip: i.tip });
      toastShowCountRef.current.set(i.id, 1);
      pendingToastRef.current.set(i.id, i);
    }
    sinceRef.current = sqliteNow();
    setUnread(data.unread);
  }, [addToast]);

  const refresh = useCallback(async () => {
    await fetchList();
    await fetchNewToasts();
  }, [fetchList, fetchNewToasts]);

  useEffect(() => {
    fetchList();
    const id = setInterval(() => {
      showPendingRepeats();
      fetchList();
      fetchNewToasts();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchList, fetchNewToasts, showPendingRepeats]);

  const markAllRead = useCallback(async () => {
    await fetch("/api/bildirimler", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, okundu: 1 })));
  }, []);

  const markRead = useCallback(async (ids: number[]) => {
    if (!ids.length) return;
    const res = await fetch("/api/bildirimler", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { unread: number };
    setUnread(data.unread);
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, okundu: 1 } : i)));
  }, []);

  const dismissToast = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  const pushLocal = useCallback(
    (toast: Omit<ToastItem, "key">) => {
      addToast(toast);
      refresh();
    },
    [addToast, refresh]
  );

  return (
    <NotificationContext.Provider
      value={{
        items,
        unread,
        toasts,
        panelOpen,
        setPanelOpen,
        markAllRead,
        markRead,
        dismissToast,
        refresh,
        pushLocal,
      }}
    >
      {children}
      <NotificationToasts toasts={toasts} onDismiss={dismissToast} tipColor={tipColor} />
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

function NotificationToasts({
  toasts,
  onDismiss,
  tipColor,
}: {
  toasts: ToastItem[];
  onDismiss: (key: string) => void;
  tipColor: (tip: string) => string;
}) {
  if (!toasts.length) return null;

  return (
    <div className="fixed top-20 right-4 z-10000 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className="pointer-events-auto flex gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/98 dark:bg-gray-900/98 shadow-xl backdrop-blur-md p-3 animate-[slideIn_0.25s_ease-out]"
          style={{ borderLeftWidth: 4, borderLeftColor: tipColor(toast.tip) }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-gray-900 dark:text-white">{toast.baslik}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{toast.mesaj}</div>
          </div>
          <button
            onClick={() => onDismiss(toast.key)}
            className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
          >
            ✕
          </button>
        </div>
      ))}
      <style jsx>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(16px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
