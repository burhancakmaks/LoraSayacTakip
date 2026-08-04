"use client";

import React, { FormEvent, useCallback, useEffect, useState } from "react";

type Role = "viewer" | "editor" | "admin";
type UserRow = {
  id: number;
  email: string;
  name: string;
  role: Role;
  active: number;
  created_at: string;
  last_login_at: string | null;
};

const ROLE_LABEL: Record<Role, string> = {
  viewer: "Görüntüleyici",
  editor: "Veri Giriş",
  admin: "Yönetici",
};

export default function UserManagementPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "viewer" as Role });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/users");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kullanıcılar yüklenemedi");
      setUsers(data.users ?? []);
      setError(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Kullanıcılar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kullanıcı oluşturulamadı");
      setForm({ name: "", email: "", password: "", role: "viewer" });
      await load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Kullanıcı oluşturulamadı");
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: number, patch: Partial<UserRow>) => {
    setError(null);
    const response = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Kullanıcı güncellenemedi");
      return;
    }
    await load();
  };

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900">
        <div className="border-b border-blue-light-100 bg-blue-light-50/50 px-5 py-4 dark:border-blue-light-900/40 dark:bg-blue-light-950/20">
          <h2 className="font-bold text-gray-900 dark:text-white">Yeni Kullanıcı</h2>
          <p className="mt-1 text-sm text-gray-500">Kullanıcı hesabını ve başlangıç rolünü tanımlayın.</p>
        </div>
        <form onSubmit={create} className="grid gap-3 p-5 md:grid-cols-4">
          <input
            required
            placeholder="Ad soyad"
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            className="rounded-xl border border-blue-light-200 px-3 py-2.5 text-sm outline-none focus:border-blue-light-500 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
          />
          <input
            required
            type="email"
            placeholder="E-posta"
            value={form.email}
            onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))}
            className="rounded-xl border border-blue-light-200 px-3 py-2.5 text-sm outline-none focus:border-blue-light-500 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
          />
          <input
            required
            minLength={10}
            type="password"
            placeholder="Parola (en az 10 karakter)"
            value={form.password}
            onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))}
            className="rounded-xl border border-blue-light-200 px-3 py-2.5 text-sm outline-none focus:border-blue-light-500 dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
          />
          <div className="flex gap-2">
            <select
              value={form.role}
              onChange={(event) => setForm((value) => ({ ...value, role: event.target.value as Role }))}
              className="min-w-0 flex-1 rounded-xl border border-blue-light-200 px-3 py-2.5 text-sm outline-none dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
            >
              <option value="viewer">Görüntüleyici</option>
              <option value="editor">Veri Giriş</option>
              <option value="admin">Yönetici</option>
            </select>
            <button
              disabled={saving}
              className="rounded-xl bg-blue-light-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-light-700 disabled:opacity-50"
            >
              Ekle
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="rounded-xl border border-error-200 bg-error-50 px-4 py-3 text-sm text-error-700 dark:border-error-800 dark:bg-error-500/10 dark:text-error-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900">
        <div className="border-b border-blue-light-100 px-5 py-4 dark:border-blue-light-900/40">
          <h2 className="font-bold text-gray-900 dark:text-white">Kullanıcılar</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-blue-light-50/70 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-blue-light-950/30">
              <tr>
                <th className="px-5 py-3">Kullanıcı</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Son giriş</th>
                <th className="px-4 py-3 text-right">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
              {loading ? (
                <tr><td colSpan={4} className="px-5 py-8 text-center text-gray-500">Yükleniyor…</td></tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className={!user.active ? "opacity-55" : ""}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-gray-800 dark:text-white">{user.name}</p>
                      <p className="text-xs text-gray-500">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(event) => update(user.id, { role: event.target.value as Role })}
                        className="rounded-lg border border-blue-light-200 bg-white px-2 py-1.5 text-xs dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
                      >
                        {(Object.keys(ROLE_LABEL) as Role[]).map((role) => (
                          <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {user.last_login_at ? new Date(`${user.last_login_at}Z`).toLocaleString("tr-TR") : "Henüz giriş yok"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => update(user.id, { active: user.active ? 0 : 1 })}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                          user.active
                            ? "border-error-200 text-error-600 hover:bg-error-50"
                            : "border-blue-light-200 text-blue-light-700 hover:bg-blue-light-50"
                        }`}
                      >
                        {user.active ? "Pasifleştir" : "Etkinleştir"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
