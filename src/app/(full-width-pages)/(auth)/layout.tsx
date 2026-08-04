import ThemeTogglerTwo from "@/components/common/ThemeTogglerTwo";

import { ThemeProvider } from "@/context/ThemeContext";
import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative z-1 bg-white p-6 dark:bg-gray-900 sm:p-0">
      <ThemeProvider>
        <div className="relative flex min-h-screen w-full flex-col justify-center dark:bg-gray-900 sm:p-0 lg:flex-row">
          {children}
          <div className="hidden w-full items-center bg-gradient-to-br from-blue-light-950 via-[#063853] to-blue-light-800 lg:grid lg:min-h-screen lg:w-1/2">
            <div className="relative flex items-center justify-center px-10">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-blue-light-400/40 bg-white/10 text-2xl font-black text-white shadow-[0_0_40px_rgba(11,165,236,0.28)]">
                  MS
                </div>
                <h2 className="mt-6 text-2xl font-bold text-white">MASKİ Sayaç Takip</h2>
                <p className="mt-3 text-sm leading-6 text-blue-light-200/80">
                  Bina, sayaç ve abonelik verilerini yetkili kullanıcılarla güvenli biçimde yönetin.
                </p>
              </div>
            </div>
          </div>
          <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
            <ThemeTogglerTwo />
          </div>
        </div>
      </ThemeProvider>
    </div>
  );
}
