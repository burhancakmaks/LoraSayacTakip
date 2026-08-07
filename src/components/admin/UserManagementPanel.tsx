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
  editor: "Görevli",
  admin: "Yönetici",
};

export default function UserManagementPanel() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "viewer" as Role });

  const showSuccess = (text: string) => {
    setSuccess(text);
    window.setTimeout(() => setSuccess(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, meRes] = await Promise.all([fetch("/api/users"), fetch("/api/auth/me")]);
      const data = await usersRes.json();
      const me = await meRes.json();
      if (!usersRes.ok) throw new Error(data.error || "Kullanıcılar yüklenemedi");
      setUsers(data.users ?? []);
      setCurrentUserId(me.user?.id ?? null);
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
      showSuccess("Kullanıcı oluşturuldu.");
      await load();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Kullanıcı oluşturulamadı");
    } finally {
      setSaving(false);
    }
  };

  const update = async (
    id: number,
    patch: Partial<UserRow> & { password?: string },
    options?: { skipReload?: boolean }
  ) => {
    setError(null);
    const response = await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Kullanıcı güncellenemedi");
      return false;
    }
    if (patch.role === "admin") {
      showSuccess("Kullanıcı yönetici olarak atandı.");
    } else if (patch.role === "editor" && id === currentUserId) {
      showSuccess("Görevli rolüne geçildi. Oturum kapatılıyor…");
    } else if (patch.role) {
      showSuccess("Kullanıcı rolü güncellendi.");
    } else if (patch.active !== undefined) {
      showSuccess(patch.active ? "Kullanıcı etkinleştirildi." : "Kullanıcı devre dışı bırakıldı.");
    }
    if (!options?.skipReload) {
      await load();
    }
    return true;
  };

  const makeAdmin = async (user: UserRow) => {
    if (user.role === "admin") return;
    const ok = window.confirm(
      `${user.name} yönetici olarak atanacak. Yönetici, Sayaç Aktarım ve Kullanıcı Yönetimi sayfalarına erişebilir.\n\nOnaylıyor musunuz?`
    );
    if (!ok) return;
    await update(user.id, { role: "admin" });
  };

  const adminCount = users.filter((u) => u.role === "admin" && u.active).length;
  const currentUser = users.find((u) => u.id === currentUserId);
  const otherAdminCount = users.filter(
    (u) => u.role === "admin" && u.active && u.id !== currentUserId
  ).length;
  const canDemoteSelf = currentUser?.role === "admin" && otherAdminCount > 0;

  const demoteSelfToGorevli = async () => {
    if (!currentUserId || !canDemoteSelf) return;
    const ok = window.confirm(
      "Yönetici yetkiniz kaldırılacak ve Görevli rolüne geçeceksiniz.\n\nKullanıcı Yönetimi, Sayaç Aktarım ve İşlem Geçmişi sayfalarına erişiminiz kapanır. Oturumunuz sonlanır; tekrar giriş yapmanız gerekir.\n\nDevam edilsin mi?"
    );
    if (!ok) return;
    setSaving(true);
    const done = await update(currentUserId, { role: "editor" }, { skipReload: true });
    setSaving(false);
    if (done) {
      window.setTimeout(() => {
        window.location.href = "/signin";
      }, 800);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dashed border-blue-light-300/70 bg-blue-light-50/50 px-4 py-3 dark:border-blue-light-800/50 dark:bg-blue-light-950/20">
        {currentUser?.role === "admin" ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-white">
                Kendinizi görevli yapmak
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {canDemoteSelf
                  ? "Başka bir aktif yönetici var. Aşağıdaki düğmeyle kendi rolünüzü Görevli yapabilirsiniz."
                  : "Şu an tek yöneticisiniz. Önce listeden başka bir kullanıcıyı yönetici yapın; sonra kendinizi görevli yapabilirsiniz."}
              </p>
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Aktif yönetici: {adminCount} · Diğer yönetici: {otherAdminCount}
              </p>
            </div>
            <button
              type="button"
              disabled={!canDemoteSelf || saving}
              onClick={demoteSelfToGorevli}
              className="shrink-0 rounded-xl border border-blue-light-300 bg-white px-4 py-2.5 text-sm font-semibold text-blue-light-800 transition hover:bg-blue-light-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-blue-light-700 dark:bg-gray-900 dark:text-blue-light-300"
            >
              Kendimi Görevli Yap
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>Yönetici atamak için:</strong> listeden kullanıcının rolünü{" "}
              <strong>Yönetici</strong> yapın veya <strong>Yönetici Yap</strong> düğmesine tıklayın.
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Aktif yönetici sayısı: {adminCount}
            </p>
          </>
        )}
      </div>

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
              <option value="editor">Görevli</option>
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

      {success && (
        <div className="rounded-xl border border-blue-light-200 bg-blue-light-50 px-4 py-3 text-sm text-blue-light-900 dark:border-blue-light-800 dark:bg-blue-light-950/40 dark:text-blue-light-200">
          {success}
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
                <th className="px-4 py-3 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-gray-500">Yükleniyor…</td>
                </tr>
              ) : (
                users.map((user) => {
                  const isSelf = user.id === currentUserId;
                  return (
                    <tr key={user.id} className={!user.active ? "opacity-55" : ""}>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-800 dark:text-white">{user.name}</p>
                          {isSelf && (
                            <span className="rounded-full bg-blue-light-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-light-700 dark:bg-blue-light-900/50 dark:text-blue-light-300">
                              Siz
                            </span>
                          )}
                          {user.role === "admin" && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                              Yönetici
                            </span>
                          )}
                        </div>
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
                        {user.last_login_at
                          ? new Date(`${user.last_login_at}Z`).toLocaleString("tr-TR")
                          : "Henüz giriş yok"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          {user.role !== "admin" && user.active && (
                            <button
                              type="button"
                              onClick={() => makeAdmin(user)}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-700/40 dark:bg-amber-500/10 dark:text-amber-300"
                            >
                              Yönetici Yap
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => update(user.id, { active: user.active ? 0 : 1 })}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                              user.active
                                ? "border-error-200 text-error-600 hover:bg-error-50"
                                : "border-blue-light-200 text-blue-light-700 hover:bg-blue-light-50"
                            }`}
                          >
                            {user.active ? "Devre Dışı" : "Etkinleştir"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
