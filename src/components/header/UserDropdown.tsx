"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Dropdown } from "../ui/dropdown/Dropdown";

type User = { id: number; email: string; name: string; role: "viewer" | "editor" | "admin" };

const ROLE_LABEL = {
  viewer: "Görüntüleyici",
  editor: "Veri Giriş",
  admin: "Yönetici",
};

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => {});
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/signin";
  };

  const initials =
    user?.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toLocaleUpperCase("tr-TR") || "MS";

  return (
    <div className="relative">
      <button
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((value) => !value);
        }}
        className="flex items-center gap-2 text-gray-700 dark:text-gray-300"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-light-600 text-xs font-black text-white">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-32 truncate text-xs font-semibold">{user?.name || "Kullanıcı"}</span>
          <span className="block text-[10px] text-gray-500">{user ? ROLE_LABEL[user.role] : "—"}</span>
        </span>
        <span className={`text-xs transition ${isOpen ? "rotate-180" : ""}`}>⌄</span>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="absolute right-0 mt-3 flex w-[260px] flex-col rounded-2xl border border-blue-light-100 bg-white p-3 shadow-theme-lg dark:border-blue-light-900 dark:bg-gray-900"
      >
        <div className="border-b border-blue-light-100 px-2 pb-3 dark:border-blue-light-900/50">
          <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">{user?.name}</span>
          <span className="mt-0.5 block truncate text-xs text-gray-500">{user?.email}</span>
          {user && (
            <span className="mt-2 inline-flex rounded-full bg-blue-light-50 px-2 py-0.5 text-[10px] font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300">
              {ROLE_LABEL[user.role]}
            </span>
          )}
        </div>

        {user?.role === "admin" && (
          <div className="space-y-1 border-b border-blue-light-100 py-2 dark:border-blue-light-900/50">
            <Link
              href="/kullanicilar"
              onClick={() => setIsOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-blue-light-50 dark:text-gray-300 dark:hover:bg-blue-light-950/30"
            >
              Kullanıcı Yönetimi
            </Link>
            <Link
              href="/islem-gecmisi"
              onClick={() => setIsOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-blue-light-50 dark:text-gray-300 dark:hover:bg-blue-light-950/30"
            >
              İşlem Geçmişi
            </Link>
          </div>
        )}

        <button
          type="button"
          onClick={logout}
          className="mt-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-error-600 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-500/10"
        >
          Çıkış Yap
        </button>
      </Dropdown>
    </div>
  );
}
