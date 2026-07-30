"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface SyncFileInfo {
  path?: string;
  mtime?: number;
  size?: number;
}

interface SyncState {
  last_sync: string | null;
  files?: Record<string, SyncFileInfo | null>;
  last_stats?: {
    inserted?: number;
    updated?: number;
    unchanged?: number;
    unmapped?: number;
    etap5_okunan?: number;
    etap4_okunan?: number;
    ada49_okunan?: number;
    ada3750ab_okunan?: number;
    ada3750e_okunan?: number;
    ada41134_okunan?: number;
    ada46_okunan?: number;
    ada53_okunan?: number;
    sire_okunan?: number;
    sorun_aktarildi?: number;
    counts?: { gecerli?: number; okunmadi?: number; eksik?: number; hatali?: number };
  } | null;
}

const SOURCE_LABELS: Record<string, string> = {
  etap5: "5. ETAP",
  etap4: "4. ETAP",
  ada49: "49 ADA",
  ada3750ab: "37-50 A-B",
  ada3750e: "37-50 E",
  ada41134: "41-134",
  ada46: "46 ADA",
  ada53: "53 ADA",
  sire: "ŞİRE Pazarı",
};

function fileName(path?: string) {
  if (!path) return "—";
  return path.split(/[/\\]/).pop() ?? path;
}

export default function SayacSyncPanel() {
  const [state, setState] = useState<SyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const runningRef = useRef(false);

  const loadStatus = useCallback(() => {
    fetch("/api/sayac/otomatik-sync")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runSync = async (force = false) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sayac/otomatik-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Senkron başarısız");

      setState({ last_sync: data.last_sync, files: data.files, last_stats: data.stats });

      if (data.skipped) {
        setMessage({ type: "ok", text: "Excel dosyaları değişmedi, veritabanı güncel." });
      } else {
        const ins = data.stats?.inserted ?? 0;
        const upd = data.stats?.updated ?? 0;
        setMessage({
          type: "ok",
          text: `Aktarım tamamlandı: ${ins} yeni, ${upd} güncellendi.`,
        });
      }
    } catch (e: unknown) {
      setMessage({ type: "err", text: e instanceof Error ? e.message : "Beklenmeyen hata" });
    } finally {
      setSyncing(false);
      runningRef.current = false;
    }
  };

  const stats = state?.last_stats;
  const lastLabel = state?.last_sync
    ? new Date(state.last_sync).toLocaleString("tr-TR")
    : "Henüz yapılmadı";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Excel → Veritabanı Aktarımı</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
              Downloads ve data klasörlerindeki MASKİ Excel dosyalarından sayaç verileri{" "}
              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">binalar.db</code>{" "}
              veritabanına aktarılır. Haritadaki sayaç listesi ve sorun raporları bu veriden beslenir.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={() => runSync(false)}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50 transition"
            >
              {syncing ? "Aktarılıyor..." : "Senkronize Et"}
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={() => runSync(true)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition"
              title="Dosya değişmese bile tüm kayıtları yeniden işler"
            >
              Yeniden Aktar
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Son aktarım: </span>
            <span className="font-medium text-gray-800 dark:text-white">{lastLabel}</span>
          </div>
          {stats?.counts && (
            <div className="flex flex-wrap gap-3">
              <span className="text-emerald-600 dark:text-emerald-400">Geçerli: {stats.counts.gecerli}</span>
              <span className="text-red-500">Okunmadı: {stats.counts.okunmadi}</span>
              <span className="text-amber-500">Eksik: {stats.counts.eksik}</span>
            </div>
          )}
        </div>

        {message && (
          <div
            className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${
              message.type === "ok"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-white mb-4">Kaynak Dosyalar</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400">
                <th className="pb-3 pr-4 font-medium">Kaynak</th>
                <th className="pb-3 pr-4 font-medium">Dosya</th>
                <th className="pb-3 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {Object.entries(SOURCE_LABELS).map(([key, label]) => {
                const file = state?.files?.[key];
                return (
                  <tr key={key}>
                    <td className="py-3 pr-4 font-medium text-gray-800 dark:text-white">{label}</td>
                    <td className="py-3 pr-4 text-gray-600 dark:text-gray-400 max-w-xs truncate" title={file?.path}>
                      {fileName(file?.path)}
                    </td>
                    <td className="py-3">
                      {file?.path ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Bulundu
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Bulunamadı</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {stats && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <h4 className="text-sm font-semibold text-gray-800 dark:text-white mb-4">Son Aktarım Özeti</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              ["5. ETAP", stats.etap5_okunan],
              ["4. ETAP", stats.etap4_okunan],
              ["49 ADA", stats.ada49_okunan],
              ["37-50 A-B", stats.ada3750ab_okunan],
              ["37-50 E", stats.ada3750e_okunan],
              ["41-134", stats.ada41134_okunan],
              ["46 ADA", stats.ada46_okunan],
              ["53 ADA", stats.ada53_okunan],
              ["ŞİRE", stats.sire_okunan],
              ["Sorun kaydı", stats.sorun_aktarildi],
              ["Yeni", stats.inserted],
              ["Güncellenen", stats.updated],
            ].map(([label, val]) => (
              <div
                key={String(label)}
                className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-center"
              >
                <div className="text-lg font-bold text-gray-800 dark:text-white">{val ?? 0}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
