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
      <div className="mb-6 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Tüm MASKİ Excel dosyalarında sayaç numarası, abone numarası ve adres bilgilerinde hızlı arama yapın.
          Sonuçlardan doğrudan haritaya gidebilir veya paylaşım linki kopyalayabilirsiniz.
        </p>
      </div>
      <MaskiAramaPanel />
    </div>
  );
}
