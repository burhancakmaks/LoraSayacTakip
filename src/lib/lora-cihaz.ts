export type LoraDurum = "active" | "registered" | "error" | string;

export interface LoraCihaz {
  id: number;
  deveui: string;
  bolge: string;
  blok: string;
  blok_canon: string;
  daire: string;
  kapi_no: string;
  kat: string;
  durum: LoraDurum;
  son_uplink: string;
  kaydeden: string;
  kayit_tarihi: string;
  notlar: string;
  bina_id: number | null;
  match_kaynak: string;
}

export const LORA_DURUM_META: Record<
  string,
  { etiket: string; color: string }
> = {
  active: { etiket: "Aktif", color: "#12b76a" },
  registered: { etiket: "Kayıtlı", color: "#717680" },
  error: { etiket: "Hata", color: "#f04438" },
};

export function getLoraDurumMeta(durum: string) {
  const key = String(durum || "").toLowerCase();
  return LORA_DURUM_META[key] ?? { etiket: durum || "—", color: "#98a2b3" };
}

export function summarizeLora(rows: LoraCihaz[]) {
  const by_durum: Record<string, number> = {};
  const by_kapi: Record<string, LoraCihaz[]> = {};
  for (const row of rows) {
    const d = row.durum || "?";
    by_durum[d] = (by_durum[d] || 0) + 1;
    const k = row.kapi_no || row.daire || "?";
    if (!by_kapi[k]) by_kapi[k] = [];
    by_kapi[k].push(row);
  }
  return {
    total: rows.length,
    by_durum,
    active: by_durum.active || 0,
    registered: by_durum.registered || 0,
    error: by_durum.error || 0,
    unit_count: Object.keys(by_kapi).length,
    by_kapi,
  };
}
