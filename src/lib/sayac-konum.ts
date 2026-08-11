export interface SayacKonum {
  meter_number: string;
  meter_key: string;
  installation_number: string;
  agreement_number: string;
  meter_type: string;
  lat: number;
  lng: number;
  bina_id: number | null;
  sayac_id_matched: string;
  match_kaynak: string;
}

export const METER_TYPE_COLORS: Record<string, string> = {
  BAYLAN_LORA_W: "#7c3aed",
  POLIMETER_LORA_W: "#ea580c",
  "BRT METER LORA": "#0891b2",
};

export function getMeterTypeColor(type: string) {
  return METER_TYPE_COLORS[type] ?? "#64748b";
}

export function getMeterTypeLabel(type: string) {
  if (type === "BAYLAN_LORA_W") return "Baylan Lora";
  if (type === "POLIMETER_LORA_W") return "Polimeter Lora";
  if (type === "BRT METER LORA") return "BRT Meter Lora";
  return type || "—";
}
