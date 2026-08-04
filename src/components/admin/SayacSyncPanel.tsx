"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { notifySayacGuncellendi } from "@/lib/sayac-events";

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

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;
const MASKI_CARD =
  "overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900/95";

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
        notifySayacGuncellendi();
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
    <div className="space-y-5">
      <div className={MASKI_CARD}>
        <div className="relative overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
            style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
          />
          <div className="relative flex flex-col gap-4 overflow-hidden pr-10 sm:flex-row sm:items-start sm:justify-between sm:pr-14">
            <div className="flex items-start gap-3 px-5 py-4">
              <div className="relative flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-blue-light-800 to-blue-light-950 px-1 py-3 text-white shadow-[0_0_14px_rgba(11,165,236,0.3)]">
                <div className="absolute inset-2 rounded-full border border-white/20" style={{ boxShadow: "inset 0 0 0 2px #0ba5ec44" }} />
                <span className="relative text-[7px] font-bold uppercase tracking-[0.15em] text-blue-light-200/70">Oto</span>
                <span className="relative text-xs font-black leading-none">SYNC</span>
                <span className="relative mt-1 rounded bg-blue-light-500 px-1 py-px text-[7px] font-bold text-white">MASKİ</span>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Excel → Veritabanı Aktarımı</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                  Downloads ve data klasörlerindeki MASKİ Excel dosyalarından sayaç verileri{" "}
                  <code className="rounded bg-blue-light-50 px-1 py-0.5 text-xs text-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                    binalar.db
                  </code>{" "}
                  veritabanına aktarılır.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 px-5 pb-4 sm:pb-0 sm:pr-5">
              <button
                type="button"
                disabled={syncing}
                onClick={() => runSync(false)}
                className="rounded-xl bg-blue-light-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-light-700 disabled:opacity-50"
              >
                {syncing ? "Aktarılıyor..." : "Senkronize Et"}
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => runSync(true)}
                className="rounded-xl border border-blue-light-200 bg-blue-light-50/60 px-4 py-2.5 text-sm font-semibold text-blue-light-800 transition hover:bg-blue-light-50 disabled:opacity-50 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300"
                title="Dosya değişmese bile tüm kayıtları yeniden işler"
              >
                Yeniden Aktar
              </button>
            </div>
            <div
              className="pointer-events-none absolute -right-6 top-4 w-20 rotate-45 py-0.5 text-center text-[7px] font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: MASKI_RIBBON }}
            >
              MASKİ
            </div>
          </div>
        </div>

        <div className="mx-5 mt-4 rounded-xl border border-dashed border-blue-light-300/70 bg-blue-light-50/60 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/25">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-light-700 dark:text-blue-light-400">Son aktarım</p>
              <p className="mt-0.5 text-sm font-semibold text-gray-800 dark:text-white">{lastLabel}</p>
            </div>
            {stats?.counts && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="whitespace-nowrap text-blue-light-700 dark:text-blue-light-400">
                  Geçerli: {stats.counts.gecerli}
                </span>
                <span className="whitespace-nowrap text-error-500">Okunmadı: {stats.counts.okunmadi}</span>
                <span className="whitespace-nowrap text-warning-500">Eksik: {stats.counts.eksik}</span>
              </div>
            )}
          </div>
        </div>

        {message && (
          <div
            className={`mx-5 mb-5 mt-4 rounded-xl px-4 py-3 text-sm font-medium ${
              message.type === "ok"
                ? "border border-blue-light-200 bg-blue-light-50 text-blue-light-900 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-200"
                : "border border-error-200 bg-error-50 text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-400"
            }`}
          >
            {message.text}
          </div>
        )}
      </div>

      <div className={`${MASKI_CARD} p-5`}>
        <h4 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">Kaynak Dosyalar</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-blue-light-100 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-blue-light-900/30">
                <th className="pb-3 pr-4">Kaynak</th>
                <th className="pb-3 pr-4">Dosya</th>
                <th className="pb-3">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
              {Object.entries(SOURCE_LABELS).map(([key, label]) => {
                const file = state?.files?.[key];
                return (
                  <tr key={key} className="hover:bg-blue-light-50/40 dark:hover:bg-blue-light-950/20">
                    <td className="py-3 pr-4 font-medium text-gray-800 dark:text-white">{label}</td>
                    <td className="max-w-xs truncate py-3 pr-4 text-gray-600 dark:text-gray-400" title={file?.path}>
                      {fileName(file?.path)}
                    </td>
                    <td className="py-3">
                      {file?.path ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-light-700 dark:text-blue-light-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-light-500" />
                          Bulundu
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Bulunamadı</span>
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
        <div className={`${MASKI_CARD} p-5`}>
          <h4 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">Son Aktarım Özeti</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                className="min-w-0 overflow-hidden rounded-xl border border-blue-light-800/70 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-3 py-2.5 text-center shadow-inner"
              >
                <div className="text-lg font-black tabular-nums text-blue-light-300">{val ?? 0}</div>
                <div className="mt-0.5 text-[10px] font-medium leading-snug text-blue-light-600/80">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
