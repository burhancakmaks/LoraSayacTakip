export const UZAKTAN_TYPE_COLORS: Record<string, string> = {
  BAYLAN_LORA_W: "#7c3aed",
  POLIMETER_LORA_W: "#ea580c",
  "BRT METER LORA": "#0891b2",
  KARMA: "#ca8a04",
};

export const UZAKTAN_TYPE_LABELS: Record<string, string> = {
  BAYLAN_LORA_W: "Baylan Lora",
  POLIMETER_LORA_W: "Polimeter Lora",
  "BRT METER LORA": "BRT Meter Lora",
  KARMA: "Karma (çoklu tip)",
  all: "Tüm eşleşenler",
};

export const UZAKTAN_DIM_STYLE = {
  color: "#cbd5e1",
  fillColor: "#e2e8f0",
  fillOpacity: 0.06,
  weight: 1,
};

export type UzaktanTypeFilter = "all" | "BAYLAN_LORA_W" | "POLIMETER_LORA_W" | "BRT METER LORA";

export interface UzaktanBinaEntry {
  bina_id: number;
  types: string[];
  primary_type: string;
  by_type: Record<string, number>;
  sayac_count: number;
  sayaclar: Array<{ excel_meter: string; sayac_id: string; type: string }>;
}

export interface UzaktanSozlesmeIndex {
  built_at: string;
  excel_path: string;
  type_colors: Record<string, string>;
  stats: {
    excel_rows: number;
    excel_unique_meters: number;
    excel_by_type: Record<string, number>;
    matched_sayac: number;
    matched_bina: number;
    unmatched_excel_meters: number;
    matched_by_type: Record<string, number>;
  };
  binalar: Record<string, UzaktanBinaEntry>;
}

export function getUzaktanTypeColor(type: string): string {
  return UZAKTAN_TYPE_COLORS[type] ?? "#64748b";
}

export function getUzaktanTypeLabel(type: string): string {
  return UZAKTAN_TYPE_LABELS[type] ?? type;
}

export function binaMatchesUzaktanFilter(
  entry: UzaktanBinaEntry | undefined,
  filter: UzaktanTypeFilter
): boolean {
  if (!entry) return false;
  if (filter === "all") return true;
  return (entry.by_type[filter] ?? 0) > 0;
}

export function resolveUzaktanBuildingStyle(
  entry: UzaktanBinaEntry | undefined,
  filter: UzaktanTypeFilter,
  layerEnabled: boolean
): { color: string; fillColor: string; fillOpacity: number; weight: number; visible: boolean } {
  if (!layerEnabled) {
    return { color: "", fillColor: "", fillOpacity: 0, weight: 0, visible: false };
  }

  if (!entry || !binaMatchesUzaktanFilter(entry, filter)) {
    return { ...UZAKTAN_DIM_STYLE, visible: false };
  }

  const color = getUzaktanTypeColor(entry.primary_type);
  const intensity = entry.sayac_count >= 5 ? 0.48 : entry.sayac_count >= 2 ? 0.42 : 0.36;

  return {
    color,
    fillColor: color,
    fillOpacity: intensity,
    weight: entry.primary_type === "KARMA" ? 3 : 2.5,
    visible: true,
  };
}

export interface UzaktanSayacMatch {
  type: string;
  excel_meter: string;
  sayac_id: string;
  agreement_number?: string;
  installation_number?: string;
}

export type UzaktanListFilter = "all" | "matched" | "missing";

export function normUzaktanSayacDigits(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^2025-/i, "")
    .replace(/\D/g, "");
}

export function buildUzaktanLookup(
  sayaclar: UzaktanSayacMatch[]
): Map<string, UzaktanSayacMatch> {
  const map = new Map<string, UzaktanSayacMatch>();
  for (const item of sayaclar) {
    const exactIds = [item.sayac_id.trim(), item.excel_meter.trim()];
    const digits = normUzaktanSayacDigits(item.sayac_id);
    for (const key of exactIds) {
      if (key && !map.has(key)) map.set(key, item);
    }
    if (digits && !map.has(digits)) map.set(digits, item);
  }
  return map;
}

export function lookupUzaktanMatch(
  lookup: Map<string, UzaktanSayacMatch>,
  sayacId: string
): UzaktanSayacMatch | null {
  const trimmed = sayacId.trim();
  if (!trimmed) return null;
  return lookup.get(trimmed) ?? lookup.get(normUzaktanSayacDigits(trimmed)) ?? null;
}

