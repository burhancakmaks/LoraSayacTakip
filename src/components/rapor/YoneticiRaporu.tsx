"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Kpis = {
  toplam_sayac: number;
  sozlesme: number;
  excel_konum: number;
  abone_nolu: number;
  abonesiz: number;
  benzersiz_abone: number;
  koordinatli: number;
  koordinatsiz: number;
  toplam_bina: number;
  sayacli_bina: number;
  konum_eslesen: number;
  konum_yeni: number;
  lora_toplam: number;
  lora_eslesen: number;
  lora_aktif: number;
  bugun_guncellenen: number;
  baylan: number;
  polimeter: number;
  sayac_per_bina: number;
  kapsama_sayacli_bina: number;
  kapsama_koordinat: number;
  kapsama_abone: number;
  kapsama_konum: number;
  kapsama_sozlesme: number;
  hazirlik_skoru: number;
};

type Bolge = {
  bolge: string;
  sayac: number;
  bina: number;
  abone: number;
  koordinatli: number;
  oran: number;
  abone_oran: number;
  koordinat_oran: number;
  sayac_per_bina: number;
};

type Rapor = {
  generated_at: string;
  title: string;
  ozet_cumle: string;
  kpis: Kpis;
  tip_dagilimi: Array<{ tip: string; adet: number; oran: number }>;
  marka_dagilimi: Array<{ marka: string; adet: number; oran: number }>;
  bolgeler: Bolge[];
  top_bolgeler: Bolge[];
  insights: string[];
  uzaktan: {
    matched_sayac: number;
    matched_bina: number;
    excel_unique: number;
    unmatched: number;
  } | null;
};

type SortKey = "sayac" | "bina" | "abone" | "koordinatli" | "oran";

function fmt(n: number) {
  return n.toLocaleString("tr-TR");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-200/80 dark:bg-neutral-800">
      <div className="h-full rounded-full bg-neutral-900 dark:bg-neutral-100" style={{ width: `${w}%` }} />
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1.5 text-[1.65rem] font-semibold tabular-nums tracking-tight text-neutral-950 dark:text-white">
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-neutral-500">{sub}</div> : null}
    </div>
  );
}

export default function YoneticiRaporu() {
  const [rapor, setRapor] = useState<Rapor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sayac");
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/rapor/yonetici")
      .then((r) => r.json())
      .then((data: Rapor & { error?: string }) => {
        if (data.error) throw new Error(data.error);
        setRapor(data);
        setError(null);
      })
      .catch((e: Error) => setError(e.message || "Rapor yüklenemedi"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const maxBolge = useMemo(
    () => (rapor ? Math.max(...rapor.bolgeler.map((b) => b.sayac), 1) : 1),
    [rapor]
  );

  const filteredBolgeler = useMemo(() => {
    if (!rapor) return [];
    const needle = q.trim().toLocaleLowerCase("tr-TR");
    const rows = needle
      ? rapor.bolgeler.filter((b) => b.bolge.toLocaleLowerCase("tr-TR").includes(needle))
      : rapor.bolgeler;
    return [...rows].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [rapor, q, sortKey]);

  const copyBrief = async () => {
    if (!rapor) return;
    const k = rapor.kpis;
    const text = [
      "LORA SAYAÇ — YÖNETİCİ ÖZETİ",
      fmtDate(rapor.generated_at),
      "",
      rapor.ozet_cumle,
      `Hazırlık skoru: ${k.hazirlik_skoru}/100`,
      `Koordinat kapsama: %${k.kapsama_koordinat}`,
      `Abone kapsama: %${k.kapsama_abone}`,
      "",
      ...rapor.insights.map((i) => `• ${i}`),
      "",
      "Top bölgeler:",
      ...rapor.top_bolgeler.map(
        (b, i) => `${i + 1}. ${b.bolge} — ${fmt(b.sayac)} sayaç (%${b.oran})`
      ),
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const exportCsv = () => {
    if (!rapor) return;
    const lines = [
      ["Bölge", "Sayaç", "Bina", "Abone", "Koordinatlı", "Oran %", "Abone %", "Koordinat %"].join(";"),
      ...filteredBolgeler.map((b) =>
        [b.bolge, b.sayac, b.bina, b.abone, b.koordinatli, b.oran, b.abone_oran, b.koordinat_oran].join(";")
      ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yonetici-raporu-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex min-h-[48vh] items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900 dark:border-neutral-700 dark:border-t-white" />
      </div>
    );
  }

  if (error || !rapor) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-sm text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
        {error || "Rapor yok"}
        <button type="button" onClick={load} className="ml-3 font-medium underline">
          Yeniden dene
        </button>
      </div>
    );
  }

  const k = rapor.kpis;

  return (
    <div className="yonetici-rapor mx-auto max-w-5xl space-y-8 pb-12">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6 dark:border-neutral-800">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-400">
            Executive summary
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-white">
            Yönetici Raporu
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500">
            {rapor.ozet_cumle}
          </p>
          <p className="mt-2 text-[11px] text-neutral-400">{fmtDate(rapor.generated_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            onClick={copyBrief}
            className="rounded-full border border-neutral-300 px-3.5 py-2 text-xs font-medium text-neutral-800 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
          >
            {copied ? "Kopyalandı" : "Özeti kopyala"}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="rounded-full border border-neutral-300 px-3.5 py-2 text-xs font-medium text-neutral-800 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full bg-neutral-950 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950"
          >
            Yazdır / PDF
          </button>
          <Link
            href="/map"
            className="rounded-full border border-neutral-300 px-3.5 py-2 text-xs font-medium text-neutral-800 transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-900"
          >
            Harita
          </Link>
        </div>
      </header>

      {/* Score + primary KPIs */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-[11rem_1fr]">
        <div className="flex flex-col justify-between rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Hazırlık
          </div>
          <div>
            <div className="text-5xl font-semibold tabular-nums tracking-tight text-neutral-950 dark:text-white">
              {k.hazirlik_skoru}
            </div>
            <div className="mt-1 text-xs text-neutral-500">/ 100 olgunluk</div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
            Bina, koordinat, abone ve Excel eşleşme oranlarından hesaplanır.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-6 rounded-2xl border border-neutral-200 p-5 sm:grid-cols-4 dark:border-neutral-800">
          <Metric label="Toplam sayaç" value={fmt(k.toplam_sayac)} sub={`${fmt(k.sayacli_bina)} yeşil bina`} />
          <Metric label="Sözleşme" value={fmt(k.sozlesme)} sub={`Excel ${fmt(k.excel_konum)} konum`} />
          <Metric label="Koordinatlı" value={fmt(k.koordinatli)} sub={`%${k.kapsama_koordinat} kapsama`} />
          <Metric label="Abone nolu" value={fmt(k.abone_nolu)} sub={`${fmt(k.benzersiz_abone)} benzersiz`} />
        </div>
      </section>

      {/* Coverage */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Bina kapsama", value: k.kapsama_sayacli_bina, detail: `${fmt(k.sayacli_bina)} / ${fmt(k.toplam_bina)}` },
          { label: "Koordinat", value: k.kapsama_koordinat, detail: `${fmt(k.koordinatsiz)} eksik` },
          { label: "Abone", value: k.kapsama_abone, detail: `${fmt(k.abonesiz)} abonesiz` },
          { label: "Excel konum", value: k.kapsama_konum, detail: `${fmt(k.konum_yeni)} bekleyen` },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-neutral-500">{item.label}</span>
              <span className="text-lg font-semibold tabular-nums">{item.value}%</span>
            </div>
            <div className="mt-3">
              <Bar value={item.value} max={100} />
            </div>
            <div className="mt-2 text-[11px] text-neutral-400">{item.detail}</div>
          </div>
        ))}
      </section>

      {/* Insights */}
      {rapor.insights.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-950 dark:text-white">Öne çıkanlar</h2>
          <ul className="mt-3 space-y-2">
            {rapor.insights.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Qualities / secondary */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Baylan", value: fmt(k.baylan) },
          { label: "Polimeter", value: fmt(k.polimeter) },
          { label: "Ort. sayaç/bina", value: String(k.sayac_per_bina) },
          { label: "Bugün güncellenen", value: fmt(k.bugun_guncellenen) },
          { label: "LoRa toplam", value: fmt(k.lora_toplam) },
          { label: "LoRa eşleşen", value: fmt(k.lora_eslesen) },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-neutral-200 px-3 py-3 dark:border-neutral-800">
            <div className="text-[10px] uppercase tracking-wide text-neutral-500">{item.label}</div>
            <div className="mt-1 text-base font-semibold tabular-nums text-neutral-950 dark:text-white">
              {item.value}
            </div>
          </div>
        ))}
      </section>

      {rapor.uzaktan && (
        <section className="grid grid-cols-2 gap-3 rounded-2xl border border-neutral-200 p-5 md:grid-cols-4 dark:border-neutral-800">
          <Metric label="Uzaktan eşleşen" value={fmt(rapor.uzaktan.matched_sayac)} />
          <Metric label="Uzaktan bina" value={fmt(rapor.uzaktan.matched_bina)} />
          <Metric label="Excel unique" value={fmt(rapor.uzaktan.excel_unique)} />
          <Metric label="Eşleşmeyen" value={fmt(rapor.uzaktan.unmatched)} />
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Sayaç tipi</h2>
          <div className="mt-4 space-y-3">
            {rapor.tip_dagilimi.map((t) => (
              <div key={t.tip}>
                <div className="mb-1 flex justify-between text-[12px]">
                  <span className="text-neutral-700 dark:text-neutral-200">{t.tip}</span>
                  <span className="tabular-nums text-neutral-500">
                    {fmt(t.adet)} · %{t.oran}
                  </span>
                </div>
                <Bar value={t.adet} max={k.excel_konum} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-sm font-semibold">Kayıt markası</h2>
          <div className="mt-4 space-y-3">
            {rapor.marka_dagilimi.slice(0, 5).map((t) => (
              <div key={t.marka}>
                <div className="mb-1 flex justify-between text-[12px]">
                  <span className="text-neutral-700 dark:text-neutral-200">{t.marka}</span>
                  <span className="tabular-nums text-neutral-500">
                    {fmt(t.adet)} · %{t.oran}
                  </span>
                </div>
                <Bar value={t.adet} max={k.toplam_sayac} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Top regions mini */}
      <section className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold">Önde gelen bölgeler</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-5">
          {rapor.top_bolgeler.map((b, i) => (
            <div key={b.bolge} className="min-w-0">
              <div className="text-[10px] tabular-nums text-neutral-400">#{i + 1}</div>
              <div className="truncate text-[12px] font-medium text-neutral-800 dark:text-neutral-100">
                {b.bolge}
              </div>
              <div className="mt-1 text-base font-semibold tabular-nums">{fmt(b.sayac)}</div>
              <div className="mt-2">
                <Bar value={b.sayac} max={maxBolge} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Full region table */}
      <section className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div>
            <h2 className="text-sm font-semibold">Bölge dağılımı</h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">Ada / etap bazında</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Bölge ara…"
              className="w-40 rounded-full border border-neutral-300 bg-transparent px-3 py-1.5 text-xs outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="rounded-full border border-neutral-300 bg-transparent px-3 py-1.5 text-xs dark:border-neutral-700"
            >
              <option value="sayac">Sıra: Sayaç</option>
              <option value="bina">Sıra: Bina</option>
              <option value="abone">Sıra: Abone</option>
              <option value="koordinatli">Sıra: Koordinat</option>
              <option value="oran">Sıra: Oran</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-[12px]">
            <thead className="bg-neutral-50 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/40">
              <tr>
                <th className="px-5 py-3 font-medium">Bölge</th>
                <th className="px-3 py-3 font-medium">Sayaç</th>
                <th className="px-3 py-3 font-medium">Bina</th>
                <th className="px-3 py-3 font-medium">Abone</th>
                <th className="px-3 py-3 font-medium">Koordinat</th>
                <th className="px-3 py-3 font-medium">Ort.</th>
                <th className="px-5 py-3 font-medium">Pay</th>
              </tr>
            </thead>
            <tbody>
              {filteredBolgeler.map((b) => (
                <tr key={b.bolge} className="border-t border-neutral-100 dark:border-neutral-800/80">
                  <td className="px-5 py-3">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">{b.bolge}</div>
                    <div className="mt-1.5 max-w-[13rem]">
                      <Bar value={b.sayac} max={maxBolge} />
                    </div>
                  </td>
                  <td className="px-3 py-3 tabular-nums font-semibold">{fmt(b.sayac)}</td>
                  <td className="px-3 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">{fmt(b.bina)}</td>
                  <td className="px-3 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {fmt(b.abone)}
                    <span className="ml-1 text-[10px] text-neutral-400">%{b.abone_oran}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-600 dark:text-neutral-300">
                    {fmt(b.koordinatli)}
                    <span className="ml-1 text-[10px] text-neutral-400">%{b.koordinat_oran}</span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-500">{b.sayac_per_bina}</td>
                  <td className="px-5 py-3 tabular-nums text-neutral-500">%{b.oran}</td>
                </tr>
              ))}
              {filteredBolgeler.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-neutral-400">
                    Eşleşen bölge yok
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="text-center text-[11px] text-neutral-400">
        Lora Sayaç Takip · yönetici özeti · {filteredBolgeler.length}/{rapor.bolgeler.length} bölge
      </footer>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .yonetici-rapor, .yonetici-rapor * { visibility: visible !important; }
          .yonetici-rapor {
            position: absolute !important;
            left: 0; top: 0; width: 100%; max-width: none !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
