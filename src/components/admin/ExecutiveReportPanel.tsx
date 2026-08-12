"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type ReportSummary = {
  toplam_bina: number;
  toplam_sayac: number;
  toplam_abone: number;
  toplam_birim_kaydi: number;
  yapilandirilmis_bina: number;
  sayacli_bina: number;
  beklenen_birim: number;
  toplam_sozlesme: number;
  eslesen_sozlesme: number;
  uzaktan_eslesen_sayac: number;
  uzaktan_eslesen_bina: number;
  uzaktan_excel_sayac: number;
  abone_kapsama_orani: number;
  bina_yapilandirma_orani: number;
  sayac_saglik_orani: number;
  sozlesme_eslesme_orani: number;
  birim_doluluk_orani: number;
};

type RegionItem = {
  bolge: string;
  bina_sayisi: number;
  sayac_sayisi: number;
  abone_sayisi: number;
  abone_orani: number;
  sayac_payi: number;
};

type ReportPayload = {
  generated_at: string;
  summary: ReportSummary;
  sayac_durum: { gecerli: number; eksik: number; okunmadi: number; hatali: number };
  sorunlar: { sorunlu_bina: number; kritik_bina: number; eksik_bina: number; toplam_sorun: number };
  aktivite: { bugun_guncellenen_sayac: number; bugun_guncellenen_bina: number };
  uzaktan: {
    built_at: string | null;
    tipler: Array<{ type: string; label: string; count: number }>;
  };
  highlights: {
    lider_bolge: {
      bolge: string;
      sayac_sayisi: number;
      abone_sayisi: number;
      sayac_payi: number;
    } | null;
  };
  insights: string[];
  regions: RegionItem[];
  error?: string;
};

const PANEL_CARD =
  "overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900";

function formatNumber(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: number | string;
  detail?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-3 text-3xl font-semibold tracking-tight ${accent ?? "text-gray-900 dark:text-white"}`}>
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      {detail ? <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{detail}</p> : null}
    </div>
  );
}

function RatioBar({ label, value, tone = "bg-blue-light-600" }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900 dark:text-white">%{value.toLocaleString("tr-TR")}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function StatusPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900/60">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">{formatNumber(value)}</p>
    </div>
  );
}

export default function ExecutiveReportPanel() {
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    return fetch("/api/yonetici-raporu", { signal })
      .then((response) => response.json())
      .then((payload: ReportPayload) => {
        if (payload.error) throw new Error(payload.error);
        setData(payload);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setError(err.message || "Rapor yüklenemedi");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadReport(controller.signal);
    return () => controller.abort();
  }, [loadReport]);

  const topRegions = useMemo(() => data?.regions.slice(0, 6) ?? [], [data]);
  const maxRegionSayac = useMemo(
    () => Math.max(...(data?.regions.map((r) => r.sayac_sayisi) ?? [1]), 1),
    [data]
  );

  if (loading) {
    return (
      <div className={`${PANEL_CARD} flex min-h-[320px] items-center justify-center`}>
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-light-500 border-t-transparent" />
          Yönetici raporu hazırlanıyor...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`${PANEL_CARD} p-6 text-sm text-red-600 dark:text-red-400`}>
        {error || "Rapor yüklenemedi."}
      </div>
    );
  }

  const { summary, sayac_durum, sorunlar, aktivite, uzaktan, highlights, insights } = data;
  const toplamDurum =
    sayac_durum.gecerli + sayac_durum.eksik + sayac_durum.okunmadi + sayac_durum.hatali;

  return (
    <div className="space-y-6 pb-6 print:space-y-4">
      <section className={`${PANEL_CARD} print:shadow-none`}>
        <div className="border-b border-gray-200 px-6 py-5 dark:border-gray-800">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-light-600 dark:text-blue-light-400">
                Executive Summary
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
                Operasyonel görünürlük ve bölgesel yoğunluk
              </h3>
              <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                Sayaç envanteri, abone kapsaması, sözleşme eşleşmesi ve saha veri kalitesi tek raporda birleştirilir.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={() => loadReport()}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Yenile
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl border border-blue-light-600 bg-blue-light-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-light-700"
              >
                Yazdır / PDF
              </button>
              <div className="rounded-xl border border-blue-light-200 bg-blue-light-50 px-4 py-2 text-sm text-blue-light-800 dark:border-blue-light-900/50 dark:bg-blue-light-950/30 dark:text-blue-light-300">
                <span className="font-medium">{formatDate(data.generated_at)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Toplam Sayaç" value={summary.toplam_sayac} detail={`${formatNumber(summary.sayacli_bina)} sayaçlı bina`} />
          <MetricCard label="Toplam Abone" value={summary.toplam_abone} detail={`Kapsama %${summary.abone_kapsama_orani.toLocaleString("tr-TR")}`} />
          <MetricCard
            label="Uzaktan Sözleşme"
            value={summary.uzaktan_excel_sayac}
            detail={`${formatNumber(summary.uzaktan_eslesen_sayac)} haritada eşleşti`}
          />
          <MetricCard
            label="Toplam Bina"
            value={summary.toplam_bina}
            detail={`${formatNumber(summary.yapilandirilmis_bina)} yapılandırılmış`}
          />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className={`${PANEL_CARD} xl:col-span-2`}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Performans Göstergeleri</h4>
          </div>
          <div className="space-y-5 p-6">
            <RatioBar label="Abone kapsama oranı" value={summary.abone_kapsama_orani} />
            <RatioBar label="Sayaç veri sağlığı" value={summary.sayac_saglik_orani} tone="bg-emerald-600" />
            <RatioBar label="Bina yapılandırma oranı" value={summary.bina_yapilandirma_orani} tone="bg-violet-600" />
            <RatioBar label="Uzaktan okuma eşleşme oranı" value={summary.sozlesme_eslesme_orani} tone="bg-amber-600" />
            {summary.beklenen_birim > 0 ? (
              <RatioBar label="Beklenen birim doluluk oranı" value={summary.birim_doluluk_orani} tone="bg-cyan-600" />
            ) : null}
          </div>
        </div>

        <div className={PANEL_CARD}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Stratejik Öngörüler</h4>
          </div>
          <ul className="space-y-3 px-6 py-5">
            {insights.map((item, index) => (
              <li
                key={index}
                className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-300"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-light-100 text-[10px] font-bold text-blue-light-700 dark:bg-blue-light-950/50 dark:text-blue-light-300">
                  {index + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={PANEL_CARD}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Sayaç Durum Dağılımı</h4>
          </div>
          <div className="grid grid-cols-2 gap-3 p-6">
            <StatusPill label="Geçerli" value={sayac_durum.gecerli} color="#0ba5ec" />
            <StatusPill label="Eksik" value={sayac_durum.eksik} color="#f79009" />
            <StatusPill label="Okunmadı" value={sayac_durum.okunmadi} color="#f04438" />
            <StatusPill label="Hatalı" value={sayac_durum.hatali} color="#d92d20" />
          </div>
          {toplamDurum > 0 ? (
            <div className="mx-6 mb-6 flex h-3 overflow-hidden rounded-full">
              <div className="bg-blue-light-500" style={{ width: `${(sayac_durum.gecerli / toplamDurum) * 100}%` }} />
              <div className="bg-amber-500" style={{ width: `${(sayac_durum.eksik / toplamDurum) * 100}%` }} />
              <div className="bg-red-500" style={{ width: `${(sayac_durum.okunmadi / toplamDurum) * 100}%` }} />
              <div className="bg-red-700" style={{ width: `${(sayac_durum.hatali / toplamDurum) * 100}%` }} />
            </div>
          ) : null}
        </div>

        <div className={PANEL_CARD}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Risk & Kalite</h4>
          </div>
          <div className="space-y-4 p-6">
            <MetricCard
              label="Sorunlu Bina"
              value={sorunlar.sorunlu_bina}
              detail={`${formatNumber(sorunlar.toplam_sorun)} toplam sorunlu kayıt`}
              accent="text-amber-600 dark:text-amber-400"
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center dark:border-red-900/40 dark:bg-red-950/20">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Kritik</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-red-700 dark:text-red-300">{formatNumber(sorunlar.kritik_bina)}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-center dark:border-amber-900/40 dark:bg-amber-950/20">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Eksik</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">{formatNumber(sorunlar.eksik_bina)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className={PANEL_CARD}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Günlük Aktivite</h4>
          </div>
          <div className="space-y-4 p-6">
            <MetricCard
              label="Bugün Güncellenen Sayaç"
              value={aktivite.bugun_guncellenen_sayac}
              detail={`${formatNumber(aktivite.bugun_guncellenen_bina)} bina etkilendi`}
              accent="text-emerald-600 dark:text-emerald-400"
            />
            {highlights.lider_bolge ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 dark:border-gray-800 dark:bg-gray-800/40">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Lider Bölge</p>
                <p className="mt-2 text-base font-semibold text-gray-900 dark:text-white">{highlights.lider_bolge.bolge}</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {formatNumber(highlights.lider_bolge.sayac_sayisi)} sayaç · %{highlights.lider_bolge.sayac_payi.toLocaleString("tr-TR")} pay
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {uzaktan.tipler.length > 0 ? (
        <section className={PANEL_CARD}>
          <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Uzaktan Okuma Envanteri</h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {formatNumber(summary.uzaktan_eslesen_bina)} bina · {formatNumber(summary.eslesen_sozlesme)} eşleşen sözleşme
              {uzaktan.built_at ? ` · indeks: ${formatDate(uzaktan.built_at)}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-4">
            {uzaktan.tipler.map((tip) => (
              <div
                key={tip.type}
                className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-4 dark:border-violet-900/40 dark:bg-violet-950/20"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">{tip.label}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">{formatNumber(tip.count)}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.8fr)]">
        <div className={`${PANEL_CARD} flex max-h-[min(72vh,720px)] flex-col print:max-h-none`}>
          <div className="shrink-0 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Bölgesel Dağılım</h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Bölge bazında sayaç, abone ve toplam envanter içindeki pay.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] print:overflow-visible">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 shadow-[0_1px_0_0_rgba(0,0,0,0.06)] dark:bg-gray-800/95 dark:shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
                <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
                  <th className="px-6 py-3">Bölge</th>
                  <th className="px-6 py-3 text-right">Bina</th>
                  <th className="px-6 py-3 text-right">Sayaç</th>
                  <th className="px-6 py-3 text-right">Abone</th>
                  <th className="px-6 py-3 text-right">Pay</th>
                  <th className="px-6 py-3">Yoğunluk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.regions.map((region) => (
                  <tr key={region.bolge} className="transition hover:bg-gray-50/80 dark:hover:bg-white/[0.02]">
                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{region.bolge}</td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {formatNumber(region.bina_sayisi)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-900 dark:text-white">
                      {formatNumber(region.sayac_sayisi)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-600 dark:text-gray-300">
                      {formatNumber(region.abone_sayisi)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-blue-light-700 dark:text-blue-light-300">
                      %{region.sayac_payi.toLocaleString("tr-TR")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className="h-full rounded-full bg-blue-light-600"
                          style={{ width: `${(region.sayac_sayisi / maxRegionSayac) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${PANEL_CARD} flex max-h-[min(72vh,720px)] flex-col print:max-h-none`}>
          <div className="shrink-0 border-b border-gray-200 px-6 py-4 dark:border-gray-800">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Öne Çıkan Bölgeler</h4>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-6 py-5 [-webkit-overflow-scrolling:touch] print:overflow-visible">
            {topRegions.map((region, index) => (
              <div
                key={`${region.bolge}-${index}`}
                className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{region.bolge}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {formatNumber(region.bina_sayisi)} bina · %{region.abone_orani.toLocaleString("tr-TR")} abone kapsaması
                    </p>
                  </div>
                  <span className="rounded-full bg-blue-light-100 px-2 py-0.5 text-[10px] font-bold text-blue-light-700 dark:bg-blue-light-950/50 dark:text-blue-light-300">
                    %{region.sayac_payi.toLocaleString("tr-TR")}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                  {formatNumber(region.sayac_sayisi)} sayaç · {formatNumber(region.abone_sayisi)} abone
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
