import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import BinaAboneKiyasPanel from "@/components/admin/BinaAboneKiyasPanel";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bina-Abone Kıyası | LoraSayacTakip",
  description: "Bina bağımsız bölüm sayısı ile sayaç/abone kayıtlarını karşılaştırın",
};

export default function BinaAboneKiyasPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Bina-Abone Kıyası" />
      <BinaAboneKiyasPanel />
    </div>
  );
}
