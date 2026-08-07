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
    if (!isMapPage) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
  }, [isMapPage]);

  // Dynamic class for main content margin based on sidebar state
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
    ? "lg:ml-[290px]"
    : "lg:ml-[90px]";

  return (
    <div
      className={`min-h-screen xl:flex ${
        isMapPage ? "h-screen max-h-screen overflow-hidden" : ""
      }`}
    >
      {/* Sidebar and Backdrop */}
      <AppSidebar />
      <Backdrop />
      {/* Main Content Area */}
      <div
        className={`flex min-h-0 flex-1 flex-col transition-all duration-300 ease-in-out ${mainContentMargin} ${
          isMapPage ? "h-screen max-h-screen overflow-hidden" : "min-h-screen"
        }`}
      >
        {/* Header */}
        <AppHeader />
        {/* Page Content */}
        <div
          className={
            isMapPage
              ? "relative m-0 min-h-0 w-full max-w-none flex-1 overflow-hidden p-0"
              : "mx-auto min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 max-w-(--breakpoint-2xl) md:p-6"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
