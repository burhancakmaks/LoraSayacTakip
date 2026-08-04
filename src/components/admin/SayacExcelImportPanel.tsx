"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { notifySayacGuncellendi } from "@/lib/sayac-events";
import { formatImportDisplayName } from "@/lib/sayac-import-filename";

interface ImportError {
  row: number;
  column?: string;
  message: string;
}

interface PreviewRow {
  row: number;
  adaParsel: string;
  blok: string;
  kapiNo: string;
  sayac: string;
  durum: string;
  binaId: number | null;
}

interface ImportStatus {
  templateUrl: string;
  templateAvailable: boolean;
  canRollback: boolean;
  lastImport: {
    id: string;
    timestamp: string;
    filename: string;
    rowCount: number;
    stats: Record<string, number>;
  } | null;
}

type Step = "idle" | "validating" | "validated" | "applying" | "done" | "error";

const STEPS = [
  { key: "upload", label: "Dosya Yükle" },
  { key: "validate", label: "Doğrulama" },
  { key: "confirm", label: "Onay" },
  { key: "complete", label: "Tamamlandı" },
] as const;

const DURUM_LABEL: Record<string, string> = {
  gecerli: "Geçerli",
  okunmadi: "Okunmadı",
  eksik: "Eksik",
  hatali: "Hatalı",
};

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;
const MASKI_CARD =
  "overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900/95";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stepIndex(step: Step): number {
  if (step === "idle" || step === "error") return 0;
  if (step === "validating") return 1;
  if (step === "validated") return 2;
  if (step === "applying") return 3;
  return 3;
}

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-blue-light-500 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function StatLcd({ label, value, tone = "text-blue-light-300" }: { label: string; value?: number; tone?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-blue-light-800/70 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-3 py-2.5 text-center shadow-inner">
      <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-blue-light-600/80">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${tone}`}>{value ?? 0}</p>
    </div>
  );
}

function MaskiBtn({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "warning" }) {
  const styles = {
    primary:
      "bg-blue-light-600 text-white shadow-sm hover:bg-blue-light-700 border border-blue-light-600",
    outline:
      "border border-blue-light-200 bg-blue-light-50/60 text-blue-light-800 hover:bg-blue-light-50 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300",
    warning:
      "border border-warning-300 bg-warning-50 text-warning-800 hover:bg-warning-100 dark:border-warning-700/40 dark:bg-warning-500/10 dark:text-warning-300",
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function SayacExcelImportPanel() {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [skipped, setSkipped] = useState<ImportError[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);
  const [detectedFormat, setDetectedFormat] = useState<string | null>(null);
  const busyRef = useRef(false);

  const loadStatus = useCallback(() => {
    fetch("/api/sayac/import")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const resetSelection = () => {
    setFile(null);
    setPendingId(null);
    setErrors([]);
    setSkipped([]);
    setPreview([]);
    setStats(null);
    setStep("idle");
    setDetectedFormat(null);
    setMessage(null);
  };

  const validateFile = async (selected: File) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setFile(selected);
    setStep("validating");
    setMessage(null);
    setErrors([]);
    setSkipped([]);
    setPreview([]);
    setStats(null);
    setPendingId(null);
    setDetectedFormat(null);

    try {
      const form = new FormData();
      form.append("file", selected);

      const res = await fetch("/api/sayac/import/validate", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        setStep("error");
        setErrors(data.errors ?? [{ row: 0, message: data.error || "Doğrulama başarısız" }]);
        setSkipped(data.skipped ?? []);
        setMessage({ type: "err", text: data.error || "Dosya işlenemedi." });
        return;
      }

      if (!data.valid) {
        setErrors(data.errors ?? []);
        setSkipped(data.skipped ?? []);
        setDetectedFormat(data.format ?? null);
        setStep("error");
        const parsed = data.parsedTotal ?? data.stats?.total ?? 0;
        setMessage({
          type: "err",
          text:
            data.hint ??
            (parsed > 0
              ? `${parsed} satır okundu, ${data.stats?.importable ?? 0} satır aktarılabilir. BLOK/ADA eşleşmesi gerekli.`
              : "Aktarılacak geçerli satır bulunamadı. MASKİ abonelik Excel'i kullanın."),
        });
        return;
      }

      setPendingId(data.pendingId);
      setPreview(data.preview ?? []);
      setStats(data.stats ?? null);
      setSkipped(data.skipped ?? []);
      setDetectedFormat(data.format ?? null);
      setStep("validated");
      const importable = data.stats?.importable ?? 0;
      const skippedCount = data.stats?.skipped ?? 0;
      setMessage({
        type: "info",
        text:
          skippedCount > 0
            ? `${importable} satır aktarılacak, ${skippedCount} satır atlanacak.`
            : `${importable} satır aktarıma hazır.`,
      });
    } catch (e: unknown) {
      setStep("error");
      setMessage({ type: "err", text: e instanceof Error ? e.message : "Beklenmeyen hata" });
    } finally {
      busyRef.current = false;
    }
  };

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (f) validateFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
    maxSize: 15 * 1024 * 1024,
    disabled: step === "validating" || step === "applying",
  });

  const applyImport = async () => {
    if ((!pendingId && !file) || busyRef.current) return;
    busyRef.current = true;
    setStep("applying");
    setMessage(null);

    try {
      const form = new FormData();
      if (pendingId) form.append("pendingId", pendingId);
      if (file) {
        form.append("file", file);
        form.append("filename", file.name);
      }

      const res = await fetch("/api/sayac/import/apply", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        setStep("error");
        setErrors(data.errors ?? []);
        setMessage({ type: "err", text: data.error || "Aktarım başarısız" });
        return;
      }

      setStep("done");
      setMessage({ type: "ok", text: data.message });
      notifySayacGuncellendi();
      loadStatus();
    } catch (e: unknown) {
      setStep("error");
      setMessage({ type: "err", text: e instanceof Error ? e.message : "Beklenmeyen hata" });
    } finally {
      busyRef.current = false;
    }
  };

  const rollback = async () => {
    if (rollingBack || !status?.canRollback) return;
    setRollingBack(true);
    setShowRollbackConfirm(false);
    setMessage(null);
    try {
      const res = await fetch("/api/sayac/import/rollback", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Geri alma başarısız");
      setMessage({ type: "ok", text: data.message });
      resetSelection();
      notifySayacGuncellendi();
      loadStatus();
    } catch (e: unknown) {
      setMessage({ type: "err", text: e instanceof Error ? e.message : "Beklenmeyen hata" });
    } finally {
      setRollingBack(false);
    }
  };

  const rejectMsg =
    fileRejections[0]?.errors[0]?.code === "file-too-large"
      ? "Dosya boyutu 15 MB sınırını aşıyor."
      : fileRejections[0]?.errors[0]?.message;

  const currentStep = stepIndex(step);
  const lastImportName = status?.lastImport ? formatImportDisplayName(status.lastImport.filename) : "";

  return (
    <div className="space-y-5">
      {/* Üst başlık — MASKİ etiket stili */}
      <div className={MASKI_CARD}>
        <div className="relative overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
            style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
          />
          <div className="relative flex flex-col gap-4 overflow-hidden pr-10 lg:flex-row lg:items-center lg:justify-between lg:pr-14">
            <div className="flex items-start gap-3 px-4 py-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-light-700 to-blue-light-950 text-white shadow-[0_6px_16px_rgba(11,165,236,0.25)] ring-1 ring-blue-light-400/30">
                <svg
                  aria-hidden="true"
                  className="h-9 w-9"
                  viewBox="0 0 40 40"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M9 4.5H23L31 12.5V34.5H9V4.5Z" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
                  <path d="M23 4.5V12.5H31" stroke="#7DD3FC" strokeWidth="2.2" strokeLinejoin="round" />
                  <path d="M14 17.5L19 24.5M19 17.5L14 24.5" stroke="#7DD3FC" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M25 30V19M25 19L21.5 22.5M25 19L28.5 22.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Excel Sayaç Aktarımı</h3>
                <p className="mt-1 max-w-xl text-sm text-gray-500 dark:text-gray-400">
                  MASKİ abonelik Excel&apos;i veya resmi şablonu yükleyin. Geçerli satırlar aktarılır, sorunlular atlanır.
                </p>
                <span className="mt-2 inline-flex rounded-full border border-blue-light-300/60 bg-blue-light-50 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-light-700 dark:border-blue-light-700/50 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                  Güvenli Aktarım
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 px-4 pb-4 lg:pb-0 lg:pr-4">
              <a
                href={status?.templateUrl ?? "/templates/sayac-aktarim-sablonu.xlsx"}
                download="sayac-aktarim-sablonu.xlsx"
                className="inline-flex items-center gap-2 rounded-xl border border-blue-light-200 bg-blue-light-50/80 px-4 py-2.5 text-sm font-semibold text-blue-light-800 transition hover:border-blue-light-400 hover:bg-blue-light-50 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                Şablonu İndir
              </a>
              {status?.canRollback && (
                <MaskiBtn variant="warning" disabled={rollingBack || step === "applying"} onClick={() => setShowRollbackConfirm(true)}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  {rollingBack ? "Geri Alınıyor..." : "Son Aktarımı Geri Al"}
                </MaskiBtn>
              )}
            </div>
            <div
              className="pointer-events-none absolute -right-6 top-4 w-20 rotate-45 py-0.5 text-center text-[7px] font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: MASKI_RIBBON }}
            >
              MASKİ
            </div>
          </div>
        </div>

        {/* Adım göstergesi */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between gap-2">
            {STEPS.map((s, i) => {
              const done = i < currentStep || step === "done";
              const active = i === currentStep && step !== "done";
              const failed = step === "error" && i === 1;
              return (
                <React.Fragment key={s.key}>
                  <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                        failed
                          ? "bg-error-500 text-white"
                          : done
                            ? "bg-blue-light-500 text-white"
                            : active
                              ? "bg-blue-light-600 text-white ring-4 ring-blue-light-500/20"
                              : "bg-blue-light-50 text-blue-light-400 dark:bg-blue-light-950/40"
                      }`}
                    >
                      {done && !failed ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : failed ? (
                        "!"
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span
                      className={`hidden text-center text-[11px] font-medium sm:block ${
                        active ? "text-blue-light-700 dark:text-blue-light-400" : done ? "text-blue-light-600" : "text-gray-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`mb-5 h-0.5 flex-1 rounded-full transition-colors ${
                        i < currentStep ? "bg-blue-light-400" : "bg-blue-light-100 dark:bg-blue-light-900/40"
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Son aktarım */}
      {status?.lastImport && (
        <div className="rounded-xl border border-dashed border-blue-light-300/70 bg-blue-light-50/60 px-4 py-3.5 dark:border-blue-light-800/50 dark:bg-blue-light-950/25">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-blue-light-200 bg-white dark:border-blue-light-800 dark:bg-blue-light-950/40">
              <svg className="h-4 w-4 text-blue-light-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-blue-light-700 dark:text-blue-light-400">Son aktarım</p>
              <p className="mt-1 line-clamp-2 break-words text-sm font-semibold text-gray-800 dark:text-white" title={lastImportName}>
                {lastImportName}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <time className="text-xs text-gray-500 dark:text-gray-400" dateTime={status.lastImport.timestamp}>
                  {new Date(status.lastImport.timestamp).toLocaleString("tr-TR")}
                </time>
                <span className="inline-flex rounded-full border border-blue-light-200 bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                  {status.lastImport.rowCount} satır
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Yükleme alanı */}
      <div className={`${MASKI_CARD} p-5`}>
        <div
          {...getRootProps()}
          className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200 ${
            isDragActive
              ? "scale-[1.005] border-blue-light-500 bg-blue-light-50/60 dark:bg-blue-light-500/10"
              : isDragReject
                ? "border-error-400 bg-error-50/60 dark:bg-error-500/10"
                : step === "done"
                  ? "border-blue-light-400 bg-blue-light-50/30 dark:border-blue-light-700/40 dark:bg-blue-light-500/5"
                  : "border-blue-light-200 bg-blue-light-25/50 hover:border-blue-light-400 hover:bg-blue-light-50/40 dark:border-blue-light-800 dark:bg-blue-light-950/20 dark:hover:border-blue-light-600"
          } ${step === "validating" || step === "applying" ? "pointer-events-none" : ""}`}
        >
          <input {...getInputProps()} />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-9 opacity-[0.1] dark:opacity-[0.14]"
            style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 36px", backgroundPosition: "bottom center" }}
          />

          <div className="relative px-6 py-12 text-center sm:py-14">
            {(step === "validating" || step === "applying") && (
              <div className="mb-4 flex justify-center">
                <Spinner className="h-8 w-8" />
              </div>
            )}

            {step !== "validating" && step !== "applying" && (
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-light-200 bg-white shadow-md transition group-hover:shadow-lg dark:border-blue-light-800 dark:bg-blue-light-950/40">
                {step === "done" ? (
                  <svg className="h-8 w-8 text-blue-light-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="h-8 w-8 text-blue-light-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0h3.375c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9H5.625c-.621 0-1.125.504-1.125 1.125v9.75c0 .621.504 1.125 1.125 1.125h.75m9-3H9.75" />
                  </svg>
                )}
              </div>
            )}

            {step === "validating" ? (
              <>
                <p className="text-base font-semibold text-gray-800 dark:text-white">Dosya doğrulanıyor</p>
                <p className="mt-1 text-sm text-gray-500">Sütun yapısı ve veri bütünlüğü kontrol ediliyor...</p>
              </>
            ) : step === "applying" ? (
              <>
                <p className="text-base font-semibold text-gray-800 dark:text-white">Veritabanına aktarılıyor</p>
                <p className="mt-1 text-sm text-gray-500">Yedek alındı, kayıtlar güncelleniyor...</p>
              </>
            ) : step === "done" ? (
              <>
                <p className="text-base font-semibold text-blue-light-700 dark:text-blue-light-400">Aktarım tamamlandı</p>
                <p className="mt-1 text-sm text-gray-500">Harita ve raporlar güncellendi.</p>
              </>
            ) : file ? (
              <>
                <p className="text-base font-semibold text-gray-900 dark:text-white">{file.name}</p>
                <p className="mt-1 text-sm text-gray-500">{formatBytes(file.size)} · Değiştirmek için yeni dosya bırakın</p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-900 dark:text-white">
                  {isDragActive ? "Dosyayı buraya bırakın" : "Excel dosyasını sürükleyin veya seçin"}
                </p>
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">.xlsx</span>,{" "}
                  <span className="font-medium text-gray-700 dark:text-gray-300">.xls</span> · Maks. 15 MB
                </p>
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-blue-light-200 bg-white px-4 py-2 text-sm font-semibold text-blue-light-700 shadow-sm transition group-hover:border-blue-light-400 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Dosya Seç
                </p>
              </>
            )}
            {rejectMsg && <p className="mt-3 text-sm font-medium text-error-600">{rejectMsg}</p>}
          </div>
        </div>

        {message && (
          <div
            className={`mt-5 flex items-start gap-3 rounded-xl px-4 py-3.5 text-sm ${
              message.type === "ok"
                ? "border border-blue-light-200 bg-blue-light-50 text-blue-light-900 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-200"
                : message.type === "err"
                  ? "border border-error-200 bg-error-50 text-error-800 dark:border-error-800 dark:bg-error-500/10 dark:text-error-300"
                  : "border border-blue-light-200 bg-blue-light-50/80 text-blue-light-900 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-200"
            }`}
          >
            <span className="mt-0.5 shrink-0">{message.type === "ok" ? "✓" : message.type === "err" ? "✕" : "ℹ"}</span>
            <div>
              <span className="font-medium">{message.text}</span>
              {detectedFormat && <p className="mt-1 text-xs opacity-80">Algılanan format: {detectedFormat}</p>}
            </div>
          </div>
        )}

        {step === "error" && skipped.length > 0 && (
          <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50/80 px-4 py-3 text-sm text-warning-900 dark:border-warning-800 dark:bg-warning-500/10 dark:text-warning-200">
            <strong>İpucu:</strong> Aşağıdaki MASKİ Otomatik Senkron bölümünü kullanarak aynı dosyaları doğrudan
            senkronize edebilirsiniz. Veya dosya adında bölge bilgisi olsun (ör. &quot;49 ADA&quot;, &quot;4. ETAP&quot;).
          </div>
        )}

        {step === "validated" && stats && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatLcd label="Aktarılacak" value={stats.importable} tone="text-blue-light-300" />
              <StatLcd label="Atlanacak" value={stats.skipped} tone="text-warning-300" />
              <StatLcd label="Geçerli" value={stats.gecerli} />
              <StatLcd label="Okunmadı" value={stats.okunmadi} tone="text-warning-300" />
              <StatLcd label="Eksik" value={stats.eksik} tone="text-gray-400" />
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-blue-light-100 pt-4 dark:border-blue-light-900/30">
              <MaskiBtn variant="outline" onClick={resetSelection}>
                İptal
              </MaskiBtn>
              <MaskiBtn variant="primary" onClick={applyImport}>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Aktarımı Onayla
              </MaskiBtn>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="mt-5 flex justify-end border-t border-blue-light-100 pt-4 dark:border-blue-light-900/30">
            <MaskiBtn variant="primary" onClick={resetSelection}>
              Yeni Dosya Yükle
            </MaskiBtn>
          </div>
        )}
      </div>

      {/* Kritik hata tablosu */}
      {errors.length > 0 && step === "error" && (
        <div className={`${MASKI_CARD} border-error-200 dark:border-error-900/40`}>
          <div className="flex items-center gap-3 border-b border-error-100 bg-error-50/80 px-6 py-4 dark:border-error-900/30 dark:bg-error-500/5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-error-100 text-error-600 dark:bg-error-500/20 dark:text-error-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-error-900 dark:text-error-200">Dosya Hatası</h4>
              <p className="text-sm text-error-600/80 dark:text-error-400/80">Dosya okunamadı veya aktarılacak satır yok</p>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-blue-light-50/95 dark:bg-blue-light-950/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="w-20 px-6 py-3">Satır</th>
                  <th className="w-36 px-4 py-3">Sütun</th>
                  <th className="px-4 py-3">Açıklama</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
                {errors.map((e, i) => (
                  <tr key={i} className="hover:bg-error-50/30 dark:hover:bg-error-500/5">
                    <td className="px-6 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{e.row || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.column || "—"}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Atlanan satırlar */}
      {skipped.length > 0 && (
        <div className={`${MASKI_CARD} border-warning-200 dark:border-warning-900/40`}>
          <div className="flex items-center gap-3 border-b border-warning-100 bg-warning-50/80 px-6 py-4 dark:border-warning-900/30 dark:bg-warning-500/5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-warning-900 dark:text-warning-200">Atlanan Satırlar</h4>
              <p className="text-sm text-warning-700/80 dark:text-warning-400/80">
                {skipped.length} satır atlandı — geçerli satırlar yine de aktarılacak
              </p>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-blue-light-50/95 dark:bg-blue-light-950/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="w-20 px-6 py-3">Satır</th>
                  <th className="w-36 px-4 py-3">Sütun</th>
                  <th className="px-4 py-3">Neden</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warning-100 dark:divide-warning-900/20">
                {skipped.map((e, i) => (
                  <tr key={i} className="hover:bg-warning-50/30 dark:hover:bg-warning-500/5">
                    <td className="px-6 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{e.row || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.column || "—"}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Önizleme */}
      {preview.length > 0 && step !== "error" && (
        <div className={MASKI_CARD}>
          <div className="border-b border-blue-light-100 px-6 py-4 dark:border-blue-light-900/30">
            <h4 className="font-semibold text-gray-900 dark:text-white">Veri Önizlemesi</h4>
            <p className="mt-0.5 text-sm text-gray-500">İlk {preview.length} satır gösteriliyor</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-blue-light-100 bg-blue-light-50/80 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-blue-light-900/30 dark:bg-blue-light-950/40">
                  <th className="px-6 py-3">Satır</th>
                  <th className="px-4 py-3">ADA/PARSEL</th>
                  <th className="px-4 py-3">Blok</th>
                  <th className="px-4 py-3">Kapı No</th>
                  <th className="px-4 py-3">Sayaç No</th>
                  <th className="px-4 py-3">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
                {preview.map((r) => (
                  <tr key={r.row} className="hover:bg-blue-light-50/50 dark:hover:bg-blue-light-950/20">
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{r.row}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.adaParsel}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{r.blok}</td>
                    <td className="px-4 py-3">{r.kapiNo}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.sayac}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          r.durum === "gecerli"
                            ? "bg-blue-light-100 text-blue-light-800 dark:bg-blue-light-500/20 dark:text-blue-light-300"
                            : r.durum === "okunmadi"
                              ? "bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        }`}
                      >
                        {DURUM_LABEL[r.durum] ?? r.durum}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Şablon rehberi */}
      <div className={`${MASKI_CARD} p-6`}>
        <h4 className="font-semibold text-gray-900 dark:text-white">Şablon Kuralları</h4>
        <p className="mt-1 text-sm text-gray-500">Aktarımın sorunsuz çalışması için aşağıdaki kurallara uyun.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Zorunlu Alanlar", items: ["BLOK", "BAĞIMSIZ BÖLÜM KAPI NO", "UZAKTAN OKUMA SAYAÇ NO"], accent: "border-error-300/60" },
            { title: "Önerilen Alanlar", items: ["ADA/PARSEL", "KAT", "NİTELİK", "ABONE NO"], accent: "border-blue-light-300/60" },
            { title: "Sayaç Formatı", items: ["6–10 haneli numara", "OKUNMADI (okunamayan)", "- veya YOK (eksik)"], accent: "border-blue-light-400/60" },
            { title: "Aktarım Modu", items: ["Geçerli satırlar aktarılır", "Hatalı satırlar atlanır", "Atlanan satırlar raporlanır"], accent: "border-blue-light-500/60" },
          ].map((block) => (
            <div
              key={block.title}
              className={`rounded-xl border border-dashed bg-blue-light-50/50 p-4 dark:bg-blue-light-950/20 ${block.accent}`}
            >
              <h5 className="text-sm font-semibold text-gray-800 dark:text-white">{block.title}</h5>
              <ul className="mt-3 space-y-1.5">
                {block.items.map((item) => (
                  <li key={item} className="text-xs text-gray-600 dark:text-gray-400">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Geri alma onay modalı */}
      {showRollbackConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-light-200 bg-white shadow-2xl dark:border-blue-light-900 dark:bg-gray-900">
            <div className="relative overflow-hidden border-b border-blue-light-100 px-6 py-4 dark:border-blue-light-900/30">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.06]"
                style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
              />
              <div className="relative flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-100 text-warning-600 dark:bg-warning-500/20">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Son Aktarımı Geri Al</h3>
              </div>
            </div>
            <p className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
              Veritabanı son aktarım öncesi yedeğe döndürülecek. Bu işlem geri alınamaz; yalnızca son aktarım etkilenir.
            </p>
            <div className="flex justify-end gap-2 border-t border-blue-light-100 px-6 py-4 dark:border-blue-light-900/30">
              <MaskiBtn variant="outline" onClick={() => setShowRollbackConfirm(false)}>
                Vazgeç
              </MaskiBtn>
              <MaskiBtn variant="warning" onClick={rollback}>
                Evet, Geri Al
              </MaskiBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
