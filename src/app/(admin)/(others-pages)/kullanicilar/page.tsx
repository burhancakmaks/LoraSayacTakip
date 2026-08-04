import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import UserManagementPanel from "@/components/admin/UserManagementPanel";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kullanıcı Yönetimi | LoraSayacTakip",
  description: "Kullanıcı hesaplarını ve yetkilerini yönetin",
};

export default function UsersPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Kullanıcı Yönetimi" />
      <div className="mb-6 rounded-xl border border-dashed border-blue-light-300/60 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Kullanıcı hesaplarını oluşturun; görüntüleme, veri girişi veya yönetici yetkisi atayın.
        </p>
      </div>
      <UserManagementPanel />
    </div>
  );
}
