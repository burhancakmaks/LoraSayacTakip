"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { copySayacMapLink } from "@/lib/sayac-link";

interface MaskiRecord {
  kaynak: string;
  dosya: string;
  ada: string;
  parsel: string;
  blok: string;
  kapi_no: string;
  kat: string;
  nitelik: string;
  sayac_tipi: string;
  sayac_no: string;
  abone_no: string;
  sicil_no: string;
  adres: string;
}

interface SayacHaritaMatch {
  bina_id: number;
  sayac_id: string;
  building_name: string;
}

interface MetaResponse {
  built_at?: string;
  total?: number;
  stats?: Record<string, number>;
  kaynaklar?: string[];
  count?: number;
  results?: MaskiRecord[];
  error?: string;
}

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;
const MASKI_CARD =
  "overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900/95";

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

function StatLcd({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-blue-light-800/70 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-3 py-2.5 text-center shadow-inner">
      <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-blue-light-600/80">{label}</p>
      <p className="mt-1 break-words text-sm font-black tabular-nums text-blue-light-300">{value}</p>
    </div>
  );
}

function Detail({ label, value, mono, className = "" }: { label: string; value: string; mono?: boolean; className?: string }) {
  return (
    <div className={`rounded-lg border border-dashed border-blue-light-300/70 bg-blue-light-50/80 px-2.5 py-2 dark:border-blue-light-800/50 dark:bg-blue-light-950/25 ${className}`}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-blue-light-700/80 dark:text-blue-light-400/80">{label}</div>
      <div className={`mt-0.5 break-words text-xs text-gray-800 dark:text-gray-200 ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}

export default function MaskiAramaPanel() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kaynak, setKaynak] = useState("");
  const [results, setResults] = useState<MaskiRecord[]>([]);
  const [kaynaklar, setKaynaklar] = useState<string[]>([]);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [mapNavLoading, setMapNavLoading] = useState<number | null>(null);
  const [mapNavError, setMapNavError] = useState<string | null>(null);
  const [linkCopyLoading, setLinkCopyLoading] = useState<number | null>(null);
  const [linkCopyFeedback, setLinkCopyFeedback] = useState<string | null>(null);

  const resolveHaritaMatch = useCallback(async (item: MaskiRecord): Promise<SayacHaritaMatch | null> => {
    const q = (item.sayac_no || item.abone_no || "").trim();
    if (!q) return null;

    const res = await fetch(`/api/sayac/search?q=${encodeURIComponent(q)}`);
    const data: SayacHaritaMatch[] = await res.json();
    if (!res.ok) throw new Error("Harita araması başarısız");
    if (!Array.isArray(data) || data.length === 0) return null;

    const sayacDigits = q.replace(/^2025-/i, "").replace(/\D/g, "");
    return (
      data.find((r) => r.sayac_id && r.sayac_id.replace(/\D/g, "") === sayacDigits) ||
      data.find((r) => r.sayac_id === item.sayac_no) ||
      data[0]
    );
  }, []);

  const goToMap = useCallback(
    async (item: MaskiRecord, idx: number) => {
      const q = (item.sayac_no || item.abone_no || "").trim();
      if (!q) {
        setMapNavError("Sayaç veya abone numarası olmadan haritada aranamaz.");
        return;
      }

      setMapNavLoading(idx);
      setMapNavError(null);

      try {
        const match = await resolveHaritaMatch(item);
        if (!match) {
          setMapNavError("Bu kayıt veritabanında / haritada eşleşmedi.");
          return;
        }

        const params = new URLSearchParams({ bina_id: String(match.bina_id) });
        if (match.sayac_id) params.set("sayac", match.sayac_id);
        router.push(`/map?${params.toString()}`);
      } catch (e: unknown) {
        setMapNavError(e instanceof Error ? e.message : "Haritaya yönlendirme başarısız");
      } finally {
        setMapNavLoading(null);
      }
    },
    [resolveHaritaMatch, router]
  );

  const copyMapLink = useCallback(
    async (item: MaskiRecord, idx: number) => {
      const q = (item.sayac_no || item.abone_no || "").trim();
      if (!q) {
        setMapNavError("Sayaç veya abone numarası olmadan link oluşturulamaz.");
        return;
      }

      setLinkCopyLoading(idx);
      setMapNavError(null);
      setLinkCopyFeedback(null);

      try {
        const match = await resolveHaritaMatch(item);
        if (!match) {
          setMapNavError("Bu kayıt veritabanında / haritada eşleşmedi.");
          return;
        }

        const ok = await copySayacMapLink(match.bina_id, match.sayac_id);
        setLinkCopyFeedback(ok ? "Link kopyalandı" : "Kopyalanamadı");
        window.setTimeout(() => setLinkCopyFeedback(null), 2500);
      } catch (e: unknown) {
        setMapNavError(e instanceof Error ? e.message : "Link kopyalanamadı");
      } finally {
        setLinkCopyLoading(null);
      }
    },
    [resolveHaritaMatch]
  );

  useEffect(() => {
    fetch("/api/maski-arama?meta=1")
      .then(async (r) => {
        const data: MetaResponse = await r.json();
        if (!r.ok) throw new Error(data.error || `Sunucu hatası (${r.status})`);
        if (data.error) throw new Error(data.error);
        setMeta(data);
        setKaynaklar(data.kaynaklar ?? []);
        setMetaError(null);
      })
      .catch((e) => setMetaError(e.message || "İndeks yüklenemedi"));
  }, []);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchError("En az 2 karakter girin");
      return;
    }

    setLoading(true);
    setSearchError(null);
    setSearched(true);
    setExpandedIdx(null);

    const params = new URLSearchParams({ q });
    if (kaynak) params.set("kaynak", kaynak);

    try {
      const res = await fetch(`/api/maski-arama?${params}`);
      const data: MetaResponse = await res.json();
      if (!res.ok) throw new Error(data.error || `Sunucu hatası (${r.status})`);
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
      setMeta((prev) => ({ ...prev, total: data.total, built_at: data.built_at }));
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : "Arama başarısız");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, kaynak]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch();
  };

  return (
    <div className="space-y-5">
      {/* Üst başlık */}
      <div className={MASKI_CARD}>
        <div className="relative overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
            style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
          />
          <div className="relative flex flex-col gap-4 overflow-hidden pr-10 sm:flex-row sm:items-start sm:pr-14">
            <div className="flex items-start gap-3 px-5 py-4">
              <div className="relative flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-blue-light-800 to-blue-light-950 px-1 py-3 text-white shadow-[0_0_14px_rgba(11,165,236,0.3)]">
                <div className="absolute inset-2 rounded-full border border-white/20" style={{ boxShadow: "inset 0 0 0 2px #0ba5ec44" }} />
                <span className="relative text-[7px] font-bold uppercase tracking-[0.15em] text-blue-light-200/70">Arama</span>
                <span className="relative text-xs font-black leading-none">ARA</span>
                <span className="relative mt-1 rounded bg-blue-light-500 px-1 py-px text-[7px] font-bold text-white">XLS</span>
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">MASKİ Excel Arama</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
                  Tüm Excel dosyalarındaki sayaç numarası, abone numarası ve adres bilgilerinde arama yapın.
                </p>
              </div>
            </div>
            <div
              className="pointer-events-none absolute -right-6 top-4 w-20 rotate-45 py-0.5 text-center text-[7px] font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: MASKI_RIBBON }}
            >
              MASKİ
            </div>
          </div>
        </div>

        {metaError && (
          <div className="mx-5 mt-4 rounded-xl border border-warning-200 bg-warning-50/80 px-3 py-2 text-sm text-warning-800 dark:border-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
            İndeks uyarısı: {metaError}
          </div>
        )}

        {meta && (
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
            <StatLcd label="Toplam Kayıt" value={(meta.total ?? 0).toLocaleString("tr-TR")} />
            <StatLcd label="Kaynak Dosya" value={Object.keys(meta.stats ?? {}).length} />
            <StatLcd label="Son Güncelleme" value={formatDate(meta.built_at).split(" ")[0]} />
            <StatLcd label="Kaynaklar" value={kaynaklar.length} />
          </div>
        )}
      </div>

      {/* Arama formu + sonuçlar */}
      <div className={MASKI_CARD}>
        <form onSubmit={handleSubmit} className="space-y-3 border-b border-blue-light-100 p-4 dark:border-blue-light-900/30">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex flex-1 items-center gap-2 overflow-hidden rounded-xl border border-blue-light-200 bg-blue-light-50/50 px-3 py-2 dark:border-blue-light-900/50 dark:bg-blue-light-950/25">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-blue-light-500">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Sayaç no, abone no, adres, blok, kapı no..."
                className="flex-1 bg-transparent text-sm font-medium text-gray-800 placeholder:text-gray-500 focus:outline-none dark:text-white dark:placeholder:text-gray-400"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 rounded-xl bg-blue-light-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-light-700 disabled:opacity-60"
            >
              {loading ? "Aranıyor..." : "Ara"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Kaynak filtre</label>
            <select
              value={kaynak}
              onChange={(e) => setKaynak(e.target.value)}
              className="rounded-lg border border-blue-light-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/20 dark:border-blue-light-900 dark:bg-blue-light-950/30 dark:text-white"
            >
              <option value="">Tüm dosyalar</option>
              {kaynaklar.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {meta?.stats && (
              <div className="ml-auto flex flex-wrap gap-1.5">
                {Object.entries(meta.stats).map(([key, count]) => (
                  <span
                    key={key}
                    className="rounded-full border border-blue-light-200 bg-blue-light-50 px-2 py-0.5 text-[10px] font-semibold text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300"
                  >
                    {key}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </form>

        {linkCopyFeedback && (
          <div className="mx-4 mt-3 rounded-xl border border-blue-light-200 bg-blue-light-50 px-3 py-2 text-sm text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
            {linkCopyFeedback}
          </div>
        )}

        {mapNavError && (
          <div className="mx-4 mt-3 flex items-start justify-between gap-2 rounded-xl border border-warning-200 bg-warning-50/80 px-3 py-2 text-sm text-warning-800 dark:border-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
            <span>{mapNavError}</span>
            <button
              type="button"
              onClick={() => setMapNavError(null)}
              className="shrink-0 text-warning-600 hover:text-warning-800 dark:text-warning-300"
              aria-label="Kapat"
            >
              ✕
            </button>
          </div>
        )}

        <div className="min-h-[360px] max-h-[65vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
              Sonuçlar yükleniyor...
            </div>
          )}
          {!loading && searchError && (
            <div className="p-8 text-center text-sm text-error-600 dark:text-error-400">{searchError}</div>
          )}
          {!loading && !searchError && searched && results.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">Sonuç bulunamadı.</div>
          )}
          {!loading && !searched && (
            <div className="p-8 text-center text-sm text-gray-500">
              Aramak için sayaç numarası, abone numarası veya adres girin ve <strong>Ara</strong> butonuna tıklayın.
            </div>
          )}
          {!loading && !searchError && results.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-blue-light-50/95 backdrop-blur-sm dark:bg-blue-light-950/80">
                <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Kaynak</th>
                  <th className="px-3 py-2">Blok / Kapı</th>
                  <th className="px-3 py-2">Sayaç No</th>
                  <th className="px-3 py-2">Abone No</th>
                  <th className="px-3 py-2">Adres</th>
                  <th className="w-24 px-3 py-2 text-center">Harita</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
                {results.map((item, idx) => {
                  const open = expandedIdx === idx;
                  return (
                    <React.Fragment key={`${item.kaynak}-${item.sayac_no}-${item.abone_no}-${idx}`}>
                      <tr
                        onClick={() => setExpandedIdx(open ? null : idx)}
                        className="cursor-pointer align-top transition hover:bg-blue-light-50/60 dark:hover:bg-blue-light-950/25"
                      >
                        <td className="px-3 py-2 text-blue-light-400">{open ? "▼" : "▶"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800 dark:text-gray-200">{item.kaynak}</div>
                          <div className="mt-0.5 text-[10px] text-gray-500">{item.sayac_tipi || item.nitelik || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.blok || "—"}</div>
                          <div className="text-[10px] text-gray-500">
                            Kapı: {item.kapi_no || "—"}
                            {item.kat ? ` · ${item.kat}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono font-semibold text-blue-light-700 dark:text-blue-light-400">{item.sayac_no || "—"}</td>
                        <td className="px-3 py-2 font-mono">{item.abone_no || "—"}</td>
                        <td className="max-w-xs px-3 py-2 text-gray-600 dark:text-gray-300">
                          <div className="line-clamp-2">{item.adres || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyMapLink(item, idx);
                              }}
                              disabled={linkCopyLoading === idx || mapNavLoading === idx}
                              className="inline-flex items-center justify-center rounded-lg border border-blue-light-200 bg-white px-2 py-1 text-[10px] font-semibold text-blue-light-800 transition hover:bg-blue-light-50 disabled:opacity-60 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300"
                              title="Harita linkini kopyala"
                            >
                              {linkCopyLoading === idx ? "…" : "Link"}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                goToMap(item, idx);
                              }}
                              disabled={mapNavLoading === idx || linkCopyLoading === idx}
                              className="inline-flex items-center justify-center rounded-lg border border-blue-light-300 bg-blue-light-50 px-2 py-1 text-[10px] font-semibold text-blue-light-800 transition hover:bg-blue-light-100 disabled:opacity-60 dark:border-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300"
                              title="Haritada göster"
                            >
                              {mapNavLoading === idx ? "…" : "Git"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-blue-light-50/50 dark:bg-blue-light-950/20">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <Detail label="Kaynak" value={item.kaynak} />
                              <Detail label="Ada" value={item.ada} />
                              <Detail label="Parsel" value={item.parsel} />
                              <Detail label="Blok" value={item.blok} />
                              <Detail label="Kapı No" value={item.kapi_no} />
                              <Detail label="Kat" value={item.kat} />
                              <Detail label="Nitelik" value={item.nitelik} />
                              <Detail label="Sayaç Tipi" value={item.sayac_tipi} />
                              <Detail label="Sayaç No" value={item.sayac_no} mono />
                              <Detail label="Abone No" value={item.abone_no} mono />
                              <Detail label="Sicil No" value={item.sicil_no} mono />
                              <Detail label="Dosya" value={item.dosya} className="sm:col-span-2 lg:col-span-3" />
                              <Detail label="Adres" value={item.adres} className="sm:col-span-2 lg:col-span-3" />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-blue-light-200/60 pt-3 dark:border-blue-light-800/40">
                              <button
                                type="button"
                                onClick={() => goToMap(item, idx)}
                                disabled={mapNavLoading === idx || linkCopyLoading === idx}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-light-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-blue-light-700 disabled:opacity-60"
                              >
                                {mapNavLoading === idx ? "Harita aranıyor..." : "Haritada göster"}
                              </button>
                              <button
                                type="button"
                                onClick={() => copyMapLink(item, idx)}
                                disabled={linkCopyLoading === idx || mapNavLoading === idx}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-light-300 bg-white px-4 py-2 text-xs font-semibold text-blue-light-800 transition hover:bg-blue-light-50 disabled:opacity-60 dark:border-blue-light-700 dark:bg-gray-900 dark:text-blue-light-300"
                              >
                                {linkCopyLoading === idx ? "Link hazırlanıyor..." : "Link kopyala"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {searched && !loading && !searchError && (
          <div className="border-t border-blue-light-100 px-4 py-2 text-[11px] text-gray-500 dark:border-blue-light-900/30 dark:text-gray-400">
            <strong className="text-blue-light-800 dark:text-blue-light-300">{results.length}</strong> sonuç gösteriliyor
            {results.length >= 100 ? " (en fazla 100)" : ""}
            {results.length > 0 ? " · Detay için satıra tıklayın" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
