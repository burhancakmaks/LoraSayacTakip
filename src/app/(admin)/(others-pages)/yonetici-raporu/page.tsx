import { Metadata } from "next";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import ExecutiveReportPanel from "@/components/admin/ExecutiveReportPanel";

export const metadata: Metadata = {
  title: "Yönetici Raporu | LoraSayacTakip",
  description: "Üst yönetim için sayaç, abone, sözleşme ve bölge dağılımı özeti",
};

export default function YoneticiRaporuPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Yönetici Raporu" />
      <div className="mb-6 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Sayaç envanteri, abone kapsaması, sözleşme eşleşmesi, saha veri kalitesi ve bölgesel yoğunluk üst yönetim
          sunumuna uygun tek ekranda özetlenir.
        </p>
      </div>
      <ExecutiveReportPanel />
    </div>
  );
}
