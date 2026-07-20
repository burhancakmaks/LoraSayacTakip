"use client";

import { useSidebar } from "@/context/SidebarContext";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import React from "react";
import { usePathname } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isExpanded, isHovered, isMobileOpen } = useSidebar();
  const pathname = usePathname();
  const isMapPage = pathname === "/map";

  // Dynamic class for main content margin based on sidebar state
  const mainContentMargin = isMobileOpen
    ? "ml-0"
    : isExpanded || isHovered
    ? "lg:ml-[290px]"
    : "lg:ml-[90px]";

  return (
    <div className={`min-h-screen xl:flex ${isMapPage ? "h-screen overflow-hidden" : ""}`}>
      {/* Sidebar and Backdrop */}
      <AppSidebar />
      <Backdrop />
      {/* Main Content Area */}
      <div
        className={`flex-1 transition-all duration-300 ease-in-out ${mainContentMargin} ${
          isMapPage ? "h-screen overflow-hidden flex flex-col" : ""
        }`}
      >
        {/* Header */}
        <AppHeader />
        {/* Page Content */}
        <div
          className={
            isMapPage
              ? "flex-1 w-full relative overflow-hidden p-0 m-0 max-w-none"
              : "p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6"
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
