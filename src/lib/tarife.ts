export type TarifeSinif =
  | "mesken"
  | "ticarethane"
  | "ortak"
  | "resmi"
  | "ozel"
  | "sivil"
  | "gecici"
  | "tarimsal"
  | "atik_su"
  | "karma"
  | "diger";

export interface TarifeSinifMeta {
  sinif: TarifeSinif;
  etiket: string;
  color: string;
  description: string;
}

export const TARIFE_SINIFLER: Record<TarifeSinif, TarifeSinifMeta> = {
  mesken: {
    sinif: "mesken",
    etiket: "Mesken",
    color: "#3b82f6",
    description: "Konut abonelikleri",
  },
  ticarethane: {
    sinif: "ticarethane",
    etiket: "Ticarethane",
    color: "#f59e0b",
    description: "İşyeri ve konteyner abonelikleri",
  },
  karma: {
    sinif: "karma",
    etiket: "Karma Kullanım",
    color: "#8b5cf6",
    description: "Birden fazla tarife türü içeren binalar",
  },
  ortak: {
    sinif: "ortak",
    etiket: "Ortak Kullanım",
    color: "#64748b",
    description: "Ortak alan ve sıcak su abonelikleri",
  },
  resmi: {
    sinif: "resmi",
    etiket: "Resmi / Belediye",
    color: "#6366f1",
    description: "Kamu ve belediye hizmet tarifeleri",
  },
  ozel: {
    sinif: "ozel",
    etiket: "Özel Tarife",
    color: "#ec4899",
    description: "Engelli, şehit-gazi vb. özel tarifeler",
  },
  sivil: {
    sinif: "sivil",
    etiket: "İbadethane / Dernek",
    color: "#14b8a6",
    description: "İbadethane, dernek ve vakıf abonelikleri",
  },
  gecici: {
    sinif: "gecici",
    etiket: "Geçici / Şantiye",
    color: "#eab308",
    description: "Şantiye ve geçici tesis abonelikleri",
  },
  tarimsal: {
    sinif: "tarimsal",
    etiket: "Tarımsal",
    color: "#22c55e",
    description: "Bağ-bahçe-besi abonelikleri",
  },
  atik_su: {
    sinif: "atik_su",
    etiket: "Atık Su",
    color: "#78716c",
    description: "Atık su tarifeleri",
  },
  diger: {
    sinif: "diger",
    etiket: "Diğer",
    color: "#94a3b8",
    description: "Sınıflandırılmamış tarifeler",
  },
};

export function classifyTarifeTuru(raw: string): { grup: string; sinif: TarifeSinif; etiket: string } {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t) return { grup: "diger", sinif: "diger", etiket: "Bilinmiyor" };

  if (t.includes("ATIK SU")) {
    return { grup: "atik_su", sinif: "atik_su", etiket: TARIFE_SINIFLER.atik_su.etiket };
  }
  if (t.includes("MESKEN")) {
    return { grup: "mesken", sinif: "mesken", etiket: TARIFE_SINIFLER.mesken.etiket };
  }
  if (t.includes("TİCARETHANE") || t.includes("TICARETHANE") || t.includes("KONTEYNER")) {
    return { grup: "ticarethane", sinif: "ticarethane", etiket: TARIFE_SINIFLER.ticarethane.etiket };
  }
  if (t.includes("ORTAK")) {
    return { grup: "ortak", sinif: "ortak", etiket: TARIFE_SINIFLER.ortak.etiket };
  }
  if (t.includes("RESMİ") || t.includes("RESMI") || t.includes("BELEDİYE") || t.includes("BELEDIYE")) {
    return { grup: "resmi", sinif: "resmi", etiket: TARIFE_SINIFLER.resmi.etiket };
  }
  if (t.includes("ENGELLİ") || t.includes("ENGELLI") || t.includes("ŞEHİT") || t.includes("SEHIT") || t.includes("GAZİ") || t.includes("GAZI")) {
    return { grup: "ozel", sinif: "ozel", etiket: TARIFE_SINIFLER.ozel.etiket };
  }
  if (t.includes("İBADETHANE") || t.includes("IBADETHANE") || t.includes("DERNEK") || t.includes("VAKIF") || t.includes("SİYASİ") || t.includes("SIYASI")) {
    return { grup: "sivil", sinif: "sivil", etiket: TARIFE_SINIFLER.sivil.etiket };
  }
  if (t.includes("ŞANTİYE") || t.includes("SANTIYE") || t.includes("GEÇİCİ") || t.includes("GECICI")) {
    return { grup: "gecici", sinif: "gecici", etiket: TARIFE_SINIFLER.gecici.etiket };
  }
  if (t.includes("BAĞ") || t.includes("BAG") || t.includes("BAHÇE") || t.includes("BAHCE") || t.includes("BESİ") || t.includes("BESI")) {
    return { grup: "tarimsal", sinif: "tarimsal", etiket: TARIFE_SINIFLER.tarimsal.etiket };
  }
  if (t.includes("KARTLI")) {
    return { grup: "diger", sinif: "diger", etiket: "Kartlı Sayaç" };
  }

  return { grup: "diger", sinif: "diger", etiket: TARIFE_SINIFLER.diger.etiket };
}

export function getTarifeColor(sinif: string | null | undefined): string {
  const key = (sinif || "diger") as TarifeSinif;
  return TARIFE_SINIFLER[key]?.color ?? TARIFE_SINIFLER.diger.color;
}

export function getTarifeMeta(sinif: string | null | undefined): TarifeSinifMeta {
  const key = (sinif || "diger") as TarifeSinif;
  return TARIFE_SINIFLER[key] ?? TARIFE_SINIFLER.diger;
}
