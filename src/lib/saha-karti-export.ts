import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { SahaKartiPayload } from "./saha-karti-data";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("tr-TR");
  } catch {
    return iso;
  }
}

function addressLine(payload: SahaKartiPayload) {
  const info = payload.building_info;
  if (!info) return "—";
  const parts = [
    info.sokak,
    info.dis_kapi_no ? `No ${info.dis_kapi_no}` : "",
    info.ada_parsel ? `Ada/Parsel ${info.ada_parsel}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "—";
}

function summaryRows(payload: SahaKartiPayload): string[][] {
  const info = payload.building_info;
  const rows: string[][] = [
    ["Bina", payload.building_name],
    ["Bina ID", String(payload.bina_id)],
    ["ODA ID", payload.oda_id != null ? String(payload.oda_id) : "—"],
    ["Katman", payload.layer || "—"],
    ["Adres", addressLine(payload)],
  ];

  if (info) {
    rows.push(
      ["Kat / Daire / Ortak", `${info.kat_sayisi} / ${info.daire_sayisi} / ${info.ortak_alan_sayisi}`],
      ["Toplam bağımsız bölüm", String(info.toplam_bagimsiz_bolum)],
      ["Zemin kat", info.has_zemin ? "Var" : "Yok"]
    );
  }

  if (payload.tariff) {
    rows.push(
      ["Tarife", `${payload.tariff.tarife_etiket} — ${payload.tariff.tarife_turu || "—"}`],
      ["Rezerv abone", String(payload.tariff.abone_sayisi)],
      ["UAVT", payload.tariff.building_uavt || "—"]
    );
  }

  rows.push(["Kayıtlı sayaç", String(payload.meters.filter((m) => m.sayac_id.trim()).length)]);
  rows.push(["Dışa aktarım", formatDate(payload.exported_at)]);

  if (payload.filter.sayac_id) rows.push(["Filtre (sayaç)", payload.filter.sayac_id]);
  if (payload.filter.abone_no) rows.push(["Filtre (abone)", payload.filter.abone_no]);

  return rows;
}

export function buildSahaKartiPdf(payload: SahaKartiPayload): Buffer {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(11, 165, 236);
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Saha Kartı Özeti", 14, 12);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Lora Sayaç Takip Sistemi", 14, 19);
  doc.text(formatDate(payload.exported_at), pageWidth - 14, 19, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(payload.building_name, 14, 38);

  autoTable(doc, {
    startY: 42,
    theme: "grid",
    head: [["Alan", "Değer"]],
    body: summaryRows(payload),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [11, 165, 236], textColor: 255 },
    columnStyles: { 0: { cellWidth: 52 } },
  });

  let cursorY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 42;
  cursorY += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Sayaç Listesi", 14, cursorY);
  cursorY += 2;

  autoTable(doc, {
    startY: cursorY + 2,
    theme: "striped",
    head: [["Kapı", "Kat", "Kullanım", "Sayaç No", "Abone No", "Marka", "Durum"]],
    body: payload.meters.map((m) => [
      m.kapi_no || String(m.birim_no),
      m.kat || "—",
      m.kullanilis_sekli,
      m.sayac_id || "—",
      m.abone_no || "—",
      m.sayac_markasi || "—",
      m.durum_etiket,
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [52, 64, 84] },
  });

  cursorY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY;
  cursorY += 8;

  if (payload.rezerv_abonelikler.length > 0) {
    if (cursorY > 250) {
      doc.addPage();
      cursorY = 20;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Rezerv Abonelik Kayıtları", 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 2,
      theme: "striped",
      head: [["Abone No", "Sayaç No", "Tarife", "Sınıf"]],
      body: payload.rezerv_abonelikler.map((r) => [
        r.abone_no || "—",
        r.sayac_no || "—",
        r.tarife_turu || "—",
        r.tarife_sinif || "—",
      ]),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [52, 64, 84] },
    });
    cursorY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY;
    cursorY += 8;
  }

  if (payload.islem_gecmisi.length > 0) {
    if (cursorY > 250) {
      doc.addPage();
      cursorY = 20;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("İşlem Geçmişi", 14, cursorY);
    autoTable(doc, {
      startY: cursorY + 2,
      theme: "striped",
      head: [["Tarih", "Kullanıcı", "İşlem", "Özet"]],
      body: payload.islem_gecmisi.map((log) => [
        log.created_at || "—",
        log.user_email || "—",
        log.action || "—",
        log.summary || "—",
      ]),
      styles: { fontSize: 6.5, cellPadding: 1.5 },
      headStyles: { fillColor: [52, 64, 84] },
      columnStyles: { 3: { cellWidth: 70 } },
    });
  }

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

export function buildSahaKartiExcel(payload: SahaKartiPayload): Buffer {
  const wb = XLSX.utils.book_new();

  const ozetSheet = XLSX.utils.aoa_to_sheet([["Alan", "Değer"], ...summaryRows(payload)]);
  XLSX.utils.book_append_sheet(wb, ozetSheet, "Bina Özeti");

  const sayacSheet = XLSX.utils.json_to_sheet(
    payload.meters.map((m) => ({
      "Birim No": m.birim_no,
      Blok: m.blok_no,
      Kat: m.kat,
      "Kapı No": m.kapi_no,
      Oda: m.oda_sayisi,
      Kullanım: m.kullanilis_sekli,
      "Sayaç No": m.sayac_id,
      "Abone No": m.abone_no,
      Sicil: m.sicil_no,
      Marka: m.sayac_markasi,
      Durum: m.durum_etiket,
      "Güncelleme": m.updated_at || "",
    }))
  );
  XLSX.utils.book_append_sheet(wb, sayacSheet, "Sayaçlar");

  if (payload.rezerv_abonelikler.length > 0) {
    const rezervSheet = XLSX.utils.json_to_sheet(
      payload.rezerv_abonelikler.map((r) => ({
        "Abone No": r.abone_no,
        "Sayaç No": r.sayac_no,
        "Tarife Türü": r.tarife_turu,
        "Tarife Sınıfı": r.tarife_sinif,
        UAVT: r.building_uavt,
      }))
    );
    XLSX.utils.book_append_sheet(wb, rezervSheet, "Rezerv Abonelik");
  }

  if (payload.islem_gecmisi.length > 0) {
    const logSheet = XLSX.utils.json_to_sheet(
      payload.islem_gecmisi.map((log) => ({
        Tarih: log.created_at,
        Kullanıcı: log.user_email,
        İşlem: log.action,
        Özet: log.summary,
      }))
    );
    XLSX.utils.book_append_sheet(wb, logSheet, "İşlem Geçmişi");
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
