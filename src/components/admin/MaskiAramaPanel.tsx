"use client";

import React, { useCallback, useEffect, useState } from "react";

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

interface MetaResponse {
  built_at?: string;
  total?: number;
  stats?: Record<string, number>;
  kaynaklar?: string[];
  count?: number;
  results?: MaskiRecord[];
  error?: string;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

export default function MaskiAramaPanel() {
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
      if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
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
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">MASKİ Excel Arama</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Tüm Excel dosyalarındaki sayaç numarası, abone numarası ve adres bilgilerinde arama yapın.
        </p>
        {metaError && (
          <div className="mt-3 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2 text-sm">
            İndeks uyarısı: {metaError}
          </div>
        )}
        {meta && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Toplam Kayıt", meta.total ?? 0],
              ["Kaynak Dosya", Object.keys(meta.stats ?? {}).length],
              ["Son Güncelleme", formatDate(meta.built_at)],
              ["Kaynaklar", kaynaklar.length],
            ].map(([label, val]) => (
              <div key={String(label)} className="rounded-xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 text-center">
                <div className="text-sm font-bold text-gray-800 dark:text-white break-words">{String(val)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03] overflow-hidden">
        <form onSubmit={handleSubmit} className="p-4 border-b border-gray-100 dark:border-gray-800 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Sayaç no, abone no, adres, blok, kapı no..."
              className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white px-6 py-2.5 text-sm font-semibold transition shrink-0"
            >
              {loading ? "Aranıyor..." : "Ara"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">Kaynak filtre:</label>
            <select
              value={kaynak}
              onChange={(e) => setKaynak(e.target.value)}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <option value="">Tüm dosyalar</option>
              {kaynaklar.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {meta?.stats && (
              <div className="flex flex-wrap gap-1.5 ml-auto">
                {Object.entries(meta.stats).map(([key, count]) => (
                  <span
                    key={key}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {key}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
        </form>

        <div className="min-h-[360px] max-h-[65vh] overflow-y-auto">
          {loading && (
            <div className="p-8 text-center text-sm text-gray-500">Sonuçlar yükleniyor...</div>
          )}
          {!loading && searchError && (
            <div className="p-8 text-center text-sm text-red-500">{searchError}</div>
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
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/95 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-2 font-semibold w-8" />
                  <th className="px-3 py-2 font-semibold">Kaynak</th>
                  <th className="px-3 py-2 font-semibold">Blok / Kapı</th>
                  <th className="px-3 py-2 font-semibold">Sayaç No</th>
                  <th className="px-3 py-2 font-semibold">Abone No</th>
                  <th className="px-3 py-2 font-semibold">Adres</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {results.map((item, idx) => {
                  const open = expandedIdx === idx;
                  return (
                    <React.Fragment key={`${item.kaynak}-${item.sayac_no}-${item.abone_no}-${idx}`}>
                      <tr
                        onClick={() => setExpandedIdx(open ? null : idx)}
                        className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 align-top cursor-pointer"
                      >
                        <td className="px-3 py-2 text-gray-400">{open ? "▼" : "▶"}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800 dark:text-gray-200">{item.kaynak}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{item.sayac_tipi || item.nitelik || "—"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.blok || "—"}</div>
                          <div className="text-[10px] text-gray-500">
                            Kapı: {item.kapi_no || "—"}
                            {item.kat ? ` · ${item.kat}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-brand-600 dark:text-brand-400">{item.sayac_no || "—"}</td>
                        <td className="px-3 py-2 font-mono">{item.abone_no || "—"}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-xs">
                          <div className="line-clamp-2">{item.adres || "—"}</div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-brand-50/50 dark:bg-brand-500/5">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
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
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500">
            <strong>{results.length}</strong> sonuç gösteriliyor
            {results.length >= 100 ? " (en fazla 100)" : ""}
            {results.length > 0 ? " · Detay için satıra tıklayın" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
  className = "",
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 text-gray-800 dark:text-gray-200 break-words ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </div>
    </div>
  );
}
