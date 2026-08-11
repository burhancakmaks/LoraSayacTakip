import type { Metadata } from "next";
import YoneticiRaporu from "@/components/rapor/YoneticiRaporu";

export const metadata: Metadata = {
  title: "Yönetici Raporu | Lora Sayaç Takip",
  description: "Toplam sayaç, sözleşme ve bölge dağılımı yönetici özeti",
};

export default function YoneticiRaporuPage() {
  return <YoneticiRaporu />;
}
