import type { Metadata } from "next";
import Link from "next/link";
import { EcommerceMetrics } from "@/components/ecommerce/EcommerceMetrics";
import React from "react";
import MonthlyTarget from "@/components/ecommerce/MonthlyTarget";
import MonthlySalesChart from "@/components/ecommerce/MonthlySalesChart";
import StatisticsChart from "@/components/ecommerce/StatisticsChart";
import RecentOrders from "@/components/ecommerce/RecentOrders";
import DemographicCard from "@/components/ecommerce/DemographicCard";

export const metadata: Metadata = {
  title: "Lora Sayaç Takip | Yönetici Paneli",
  description: "Malatya sayaç takip yönetim paneli",
};

export default function Ecommerce() {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      <div className="col-span-12">
        <Link
          href="/yonetici-raporu"
          className="group flex flex-col justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-6 py-5 transition hover:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-neutral-600 sm:flex-row sm:items-center sm:px-7"
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
              Executive summary
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-neutral-950 dark:text-white">
              Yönetici Raporu
            </h2>
            <p className="mt-1 max-w-xl text-sm text-neutral-500">
              Sayaç, sözleşme, kapsama ve bölge dağılımı — tek sayfa.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 self-start rounded-full bg-neutral-950 px-4 py-2 text-xs font-medium text-white transition group-hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:group-hover:bg-neutral-200 sm:self-auto">
            Raporu aç
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </Link>
      </div>

      <div className="col-span-12 space-y-6 xl:col-span-7">
        <EcommerceMetrics />

        <MonthlySalesChart />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <MonthlyTarget />
      </div>

      <div className="col-span-12">
        <StatisticsChart />
      </div>

      <div className="col-span-12 xl:col-span-5">
        <DemographicCard />
      </div>

      <div className="col-span-12 xl:col-span-7">
        <RecentOrders />
      </div>
    </div>
  );
}
