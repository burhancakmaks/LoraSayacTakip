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
      <div className="mb-6 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
          Yapılandırılmış binalarda beklenen bağımsız bölüm sayısı ile kayıtlı sayaç ve abone sayılarını karşılaştırın.
          Uyumsuz kayıtları filtreleyerek haritada ilgili binaya gidebilirsiniz.
        </p>
      </div>
      <BinaAboneKiyasPanel />
    </div>
  );
}
