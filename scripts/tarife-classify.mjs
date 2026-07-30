export function classifyTarifeTuru(raw) {
  const t = String(raw ?? "").trim().toUpperCase();
  if (!t) return { grup: "diger", sinif: "diger", etiket: "Bilinmiyor" };
  if (t.includes("ATIK SU")) return { grup: "atik_su", sinif: "atik_su", etiket: "Atık Su" };
  if (t.includes("MESKEN")) return { grup: "mesken", sinif: "mesken", etiket: "Mesken" };
  if (t.includes("TİCARETHANE") || t.includes("TICARETHANE") || t.includes("KONTEYNER"))
    return { grup: "ticarethane", sinif: "ticarethane", etiket: "Ticarethane" };
  if (t.includes("ORTAK")) return { grup: "ortak", sinif: "ortak", etiket: "Ortak Kullanım" };
  if (t.includes("RESMİ") || t.includes("RESMI") || t.includes("BELEDİYE") || t.includes("BELEDIYE"))
    return { grup: "resmi", sinif: "resmi", etiket: "Resmi / Belediye" };
  if (t.includes("ENGELLİ") || t.includes("ENGELLI") || t.includes("ŞEHİT") || t.includes("SEHIT") || t.includes("GAZİ") || t.includes("GAZI"))
    return { grup: "ozel", sinif: "ozel", etiket: "Özel Tarife" };
  if (t.includes("İBADETHANE") || t.includes("IBADETHANE") || t.includes("DERNEK") || t.includes("VAKIF") || t.includes("SİYASİ") || t.includes("SIYASI"))
    return { grup: "sivil", sinif: "sivil", etiket: "İbadethane / Dernek" };
  if (t.includes("ŞANTİYE") || t.includes("SANTIYE") || t.includes("GEÇİCİ") || t.includes("GECICI"))
    return { grup: "gecici", sinif: "gecici", etiket: "Geçici / Şantiye" };
  if (t.includes("BAĞ") || t.includes("BAG") || t.includes("BAHÇE") || t.includes("BAHCE") || t.includes("BESİ") || t.includes("BESI"))
    return { grup: "tarimsal", sinif: "tarimsal", etiket: "Tarımsal" };
  return { grup: "diger", sinif: "diger", etiket: "Diğer" };
}

export function aggregateBinaTarife(counts) {
  const entries = Object.entries(counts).filter(([, c]) => c > 0);
  const toplam = entries.reduce((s, [, c]) => s + c, 0);
  if (!toplam) return { sinif: "diger", etiket: "Bilinmiyor", tarife_turu: "", karma: 0, toplam: 0 };

  entries.sort((a, b) => b[1] - a[1]);
  const [dominantRaw] = entries[0];
  const significant = entries.filter(([, c]) => c / toplam >= 0.15);
  const uniqueSinif = new Set(significant.map(([raw]) => classifyTarifeTuru(raw).sinif));

  if (uniqueSinif.size > 1) {
    return {
      sinif: "karma",
      etiket: "Karma Kullanım",
      tarife_turu: entries.map(([k, c]) => `${k} (${c})`).join("; "),
      karma: 1,
      toplam,
    };
  }

  const dominant = classifyTarifeTuru(dominantRaw);
  return {
    sinif: dominant.sinif,
    etiket: dominant.etiket,
    tarife_turu: dominantRaw,
    karma: 0,
    toplam,
  };
}
