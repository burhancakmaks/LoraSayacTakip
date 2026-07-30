import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import MaskiAramaPanel from "@/components/admin/MaskiAramaPanel";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "MASKİ Arama | LoraSayacTakip",
  description: "Excel dosyalarındaki sayaç, abone ve adres bilgilerinde arama yapın",
};

export default function MaskiAramaPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="MASKİ Arama" />
      <MaskiAramaPanel />
    </div>
  );
}
