import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import SayacSyncPanel from "@/components/admin/SayacSyncPanel";
import { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Sayaç Aktarım | LoraSayacTakip",
  description: "Excel dosyalarından sayaç verilerini veritabanına aktarın",
};

export default function SayacAktarimPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Sayaç Aktarım" />
      <SayacSyncPanel />
    </div>
  );
}
