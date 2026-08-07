"use client";

import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import React, { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const pathname = usePathname();
  const isMapPage = pathname === "/map";

  useEffect(() => {
    if (isMapPage) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
  }, [isMapPage]);

  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
      ? "lg:ml-[290px]"
      : "lg:ml-[90px]";

  if (isMapPage) {
    return (
      <div className="h-screen max-h-[100dvh] overflow-hidden xl:flex">
        <AppSidebar />
        <Backdrop />
        <div
          className={`flex h-full min-h-0 max-h-[100dvh] flex-1 flex-col overflow-hidden transition-all duration-300 ease-in-out ${mainContentMargin}`}
        >
          <div className="shrink-0">
            <AppHeader />
          </div>
          <div className="relative m-0 min-h-0 w-full max-w-none flex-1 overflow-hidden p-0">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen xl:flex">
      <AppSidebar />
      <Backdrop />
      <div
        className={`flex min-h-screen flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin}`}
      >
        <AppHeader />
        <main className="mx-auto w-full max-w-(--breakpoint-2xl) flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
