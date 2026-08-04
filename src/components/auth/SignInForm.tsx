"use client";

import React, { FormEvent, useEffect, useState } from "react";

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setConfigured(data.configured !== false))
      .catch(() => {});
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Giriş yapılamadı");
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") ? next : "/map";
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Giriş yapılamadı");
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-1/2">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-xl dark:border-blue-light-900/50 dark:bg-gray-900">
        <div className="border-b border-blue-light-100 bg-blue-light-50/60 px-6 py-5 dark:border-blue-light-900/40 dark:bg-blue-light-950/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-light-600">MASKİ</p>
          <h1 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Sisteme Giriş</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Yetkili kullanıcı hesabınızla devam edin.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-5 p-6">
          {!configured && (
            <div className="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-800 dark:border-warning-800 dark:bg-warning-500/10 dark:text-warning-300">
              İlk yönetici hesabı henüz oluşturulmadı.{" "}
              <a href="/setup" className="font-semibold underline">
                İlk kurulumu başlatın
              </a>
              .
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-error-200 bg-error-50 px-3 py-2.5 text-sm text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">E-posta</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-blue-light-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-light-500 focus:ring-2 focus:ring-blue-light-500/15 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">Parola</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-blue-light-200 bg-white px-3.5 py-2.5 pr-16 text-sm text-gray-900 outline-none transition focus:border-blue-light-500 focus:ring-2 focus:ring-blue-light-500/15 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-light-600"
              >
                {showPassword ? "Gizle" : "Göster"}
              </button>
            </div>
          </label>

          <div className="flex justify-end">
            <a
              href="/forgot-password"
              className="text-xs font-semibold text-blue-light-600 transition hover:text-blue-light-700 hover:underline dark:text-blue-light-400"
            >
              Şifremi unuttum
            </a>
          </div>

          <button
            type="submit"
            disabled={loading || !configured}
            className="w-full rounded-xl bg-blue-light-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-light-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
          </button>
        </form>
      </div>
    </div>
  );
}
