"use client";

import React, { FormEvent, useEffect, useState } from "react";

export default function SetupForm() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((response) => response.json())
      .then((data) => setAvailable(data.available === true))
      .catch(() => setAvailable(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Parolalar eşleşmiyor");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kurulum tamamlanamadı");
      window.location.href = "/map";
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Kurulum tamamlanamadı");
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-1/2">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-xl dark:border-blue-light-900/50 dark:bg-gray-900">
        <div className="border-b border-blue-light-100 bg-blue-light-50/60 px-6 py-5 dark:border-blue-light-900/40 dark:bg-blue-light-950/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-light-600">MASKİ</p>
          <h1 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">İlk Yönetici Kurulumu</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Bu ekran yalnızca ilk kullanıcı oluşturulurken kullanılabilir.
          </p>
        </div>

        {available === false ? (
          <div className="p-6 text-sm text-gray-600 dark:text-gray-300">
            İlk kurulum tamamlanmış.{" "}
            <a href="/signin" className="font-semibold text-blue-light-600 underline">
              Giriş ekranına dönün
            </a>
            .
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && (
              <div className="rounded-xl border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-300">
                {error}
              </div>
            )}
            {[
              { label: "Ad Soyad", value: name, set: setName, type: "text", auto: "name" },
              { label: "E-posta", value: email, set: setEmail, type: "email", auto: "username" },
              { label: "Parola", value: password, set: setPassword, type: "password", auto: "new-password" },
              { label: "Parola Tekrar", value: confirm, set: setConfirm, type: "password", auto: "new-password" },
            ].map((field) => (
              <label key={field.label} className="block">
                <span className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {field.label}
                </span>
                <input
                  type={field.type}
                  autoComplete={field.auto}
                  required
                  minLength={field.type === "password" ? 10 : undefined}
                  value={field.value}
                  onChange={(event) => field.set(event.target.value)}
                  className="w-full rounded-xl border border-blue-light-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-light-500 focus:ring-2 focus:ring-blue-light-500/15 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
                />
              </label>
            ))}
            <p className="text-xs text-gray-500">Parola en az 10 karakter olmalıdır.</p>
            <button
              type="submit"
              disabled={loading || available !== true}
              className="w-full rounded-xl bg-blue-light-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-light-700 disabled:opacity-50"
            >
              {loading ? "Hesap oluşturuluyor…" : "Yönetici Hesabını Oluştur"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
