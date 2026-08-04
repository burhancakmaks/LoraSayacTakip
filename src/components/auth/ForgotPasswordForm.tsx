"use client";

import React, { FormEvent, useState } from "react";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Parolalar eşleşmiyor");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, recoveryToken }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Parola yenilenemedi");
      setSuccess(data.message);
      setPassword("");
      setConfirm("");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Parola yenilenemedi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex w-full flex-1 items-center justify-center px-4 py-10 lg:w-1/2">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-xl dark:border-blue-light-900/50 dark:bg-gray-900">
        <div className="border-b border-blue-light-100 bg-blue-light-50/60 px-6 py-5 dark:border-blue-light-900/40 dark:bg-blue-light-950/20">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-light-600">MASKİ</p>
          <h1 className="mt-1 text-xl font-bold text-gray-900 dark:text-white">Parola Yenileme</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Hesabınız için yeni bir parola belirleyin.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          <div className="rounded-xl border border-blue-light-200 bg-blue-light-50/60 px-3 py-2.5 text-xs leading-5 text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300">
            Yerel bilgisayarda kurtarma anahtarı gerekmez. Uzak sunucuda sistem yöneticinizin verdiği kurtarma anahtarını girin.
          </div>
          {error && (
            <div className="rounded-xl border border-error-200 bg-error-50 px-3 py-2.5 text-sm text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-300">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-xl border border-blue-light-200 bg-blue-light-50 px-3 py-2.5 text-sm text-blue-light-800 dark:border-blue-light-800 dark:bg-blue-light-950/30 dark:text-blue-light-300">
              {success}{" "}
              <a href="/signin" className="font-semibold underline">Giriş yapın</a>.
            </div>
          )}

          {[
            { label: "E-posta", type: "email", value: email, set: setEmail, min: undefined },
            { label: "Yeni Parola", type: "password", value: password, set: setPassword, min: 10 },
            { label: "Yeni Parola Tekrar", type: "password", value: confirm, set: setConfirm, min: 10 },
          ].map((field) => (
            <label key={field.label} className="block">
              <span className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">{field.label}</span>
              <input
                required
                type={field.type}
                minLength={field.min}
                value={field.value}
                onChange={(event) => field.set(event.target.value)}
                className="w-full rounded-xl border border-blue-light-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-light-500 focus:ring-2 focus:ring-blue-light-500/15 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
              />
            </label>
          ))}

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-gray-700 dark:text-gray-300">
              Kurtarma Anahtarı <span className="font-normal text-gray-400">(uzak sunucuda)</span>
            </span>
            <input
              type="password"
              value={recoveryToken}
              onChange={(event) => setRecoveryToken(event.target.value)}
              className="w-full rounded-xl border border-blue-light-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-light-500 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-light-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-light-700 disabled:opacity-50"
          >
            {loading ? "Parola yenileniyor…" : "Parolayı Yenile"}
          </button>
          <a href="/signin" className="block text-center text-xs font-semibold text-gray-500 hover:text-blue-light-600">
            Giriş ekranına dön
          </a>
        </form>
      </div>
    </div>
  );
}
