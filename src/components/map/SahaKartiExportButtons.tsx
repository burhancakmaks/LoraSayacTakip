"use client";

import { useCallback, useState } from "react";
import { downloadSahaKarti, type SahaKartiFormat } from "@/lib/saha-karti-client";

interface SahaKartiExportButtonsProps {
  binaId: number;
  aboneNo?: string;
  sayacId?: string;
  compact?: boolean;
  className?: string;
}

export default function SahaKartiExportButtons({
  binaId,
  aboneNo,
  sayacId,
  compact = false,
  className = "",
}: SahaKartiExportButtonsProps) {
  const [loading, setLoading] = useState<SahaKartiFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = useCallback(
    async (format: SahaKartiFormat) => {
      setLoading(format);
      setError(null);
      try {
        await downloadSahaKarti({ binaId, format, aboneNo, sayacId });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Dışa aktarım başarısız");
      } finally {
        setLoading(null);
      }
    },
    [binaId, aboneNo, sayacId]
  );

  const btnClass = compact
    ? "rounded-md border px-1.5 py-1 text-[9px] font-bold transition disabled:opacity-50"
    : "rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50";

  return (
    <div className={className}>
      <div className={`flex items-center gap-1.5 ${compact ? "" : "flex-wrap"}`}>
        <button
          type="button"
          onClick={() => handleExport("pdf")}
          disabled={loading !== null}
          className={`${btnClass} border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300`}
          title="PDF saha kartı indir"
        >
          {loading === "pdf" ? "..." : "PDF"}
        </button>
        <button
          type="button"
          onClick={() => handleExport("xlsx")}
          disabled={loading !== null}
          className={`${btnClass} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300`}
          title="Excel saha kartı indir"
        >
          {loading === "xlsx" ? "..." : "Excel"}
        </button>
      </div>
      {error && !compact && (
        <p className="mt-1 text-[10px] text-error-600 dark:text-error-400">{error}</p>
      )}
    </div>
  );
}
