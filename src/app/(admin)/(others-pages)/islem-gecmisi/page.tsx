import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import AuditLogPanel from "@/components/admin/AuditLogPanel";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "İşlem Geçmişi | LoraSayacTakip",
  description: "Kullanıcı işlemlerini ve veri değişikliklerini inceleyin",
};

export default function AuditPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="İşlem Geçmişi" />
      <div className="mb-6 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Kullanıcı girişleri, sayaç ve bina değişiklikleri ile toplu aktarım işlemlerini izleyin.
        </p>
      </div>
      <AuditLogPanel />
    </div>
  );
}
