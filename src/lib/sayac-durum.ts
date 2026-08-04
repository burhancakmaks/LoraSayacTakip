export type SayacDurum = "gecerli" | "okunmadi" | "eksik" | "hatali";

export type SayacSorunSeverity = "kritik" | "eksik" | null;

export interface SayacDurumMeta {
  durum: SayacDurum;
  etiket: string;
  color: string;
  icon: string;
}

export const SAYAC_DURUM: Record<SayacDurum, SayacDurumMeta> = {
  gecerli: { durum: "gecerli", etiket: "Geçerli", color: "#0ba5ec", icon: "✓" },
  okunmadi: { durum: "okunmadi", etiket: "Okunmadı", color: "#f04438", icon: "!" },
  eksik: { durum: "eksik", etiket: "Eksik", color: "#f79009", icon: "?" },
  hatali: { durum: "hatali", etiket: "Hatalı", color: "#d92d20", icon: "✕" },
};

export function classifySayacDurum(raw: string | null | undefined): SayacDurum {
  const s = String(raw ?? "").trim();
  if (!s) return "eksik";
  if (/OKUNMADI|OKUNAMADI|TAKILAMADI|TAKILMADI|SAYA[CÇ]\s*YOK|SAYAC\s*TAKIL/i.test(s)) return "okunmadi";
  if (s === "-" || /^YOK$/i.test(s)) return "eksik";
  const digits = s.replace(/^2025-/i, "").replace(/\D/g, "");
  if (digits.length >= 6 && digits.length <= 12) return "gecerli";
  return "hatali";
}

export function buildingSorunSeverity(counts: {
  okunmadi: number;
  eksik: number;
  hatali: number;
}): SayacSorunSeverity {
  if (counts.okunmadi > 0 || counts.hatali > 0) return "kritik";
  if (counts.eksik > 0) return "eksik";
  return null;
}

export function getSorunMarkerColor(severity: SayacSorunSeverity): string {
  if (severity === "kritik") return "#f04438";
  if (severity === "eksik") return "#f79009";
  return "#94a3b8";
}
