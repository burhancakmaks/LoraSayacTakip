import { Metadata } from "next";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import ExecutiveReportPanel from "@/components/admin/ExecutiveReportPanel";

export const metadata: Metadata = {
  title: "Yönetici Raporu | LoraSayacTakip",
  description: "Üst yönetim için sayaç, abone, sözleşme ve bölge dağılımı özeti",
};

export default function YoneticiRaporuPage() {
  return (
    <div className="flex h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] flex-col overflow-hidden md:h-[calc(100dvh-6rem)] md:max-h-[calc(100dvh-6rem)] print:h-auto print:max-h-none print:overflow-visible">
      <div className="shrink-0">
        <PageBreadcrumb pageTitle="Yönetici Raporu" />
        <div className="mb-4 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
          <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            Sayaç envanteri, abone kapsaması, sözleşme eşleşmesi, saha veri kalitesi ve bölgesel yoğunluk üst yönetim
            sunumuna uygun tek ekranda özetlenir.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch] print:overflow-visible">
        <ExecutiveReportPanel />
      </div>
    </div>
  );
}
