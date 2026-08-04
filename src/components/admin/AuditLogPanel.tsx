"use client";

import React, { useCallback, useEffect, useState } from "react";

type AuditRow = {
  id: number;
  user_email: string;
  user_role: string;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  metadata_json: string | null;
  ip: string | null;
  success: number;
  created_at: string;
};

const ACTION_LABEL: Record<string, string> = {
  login: "Giriş",
  logout: "Çıkış",
  create: "Oluşturma",
  update: "Güncelleme",
  import: "Aktarım",
  rollback: "Geri alma",
  sync: "Senkron",
  read: "Okuma",
};

export default function AuditLogPanel() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (query.trim()) params.set("q", query.trim());
      if (action) params.set("action", action);
      const response = await fetch(`/api/audit-logs?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "İşlem geçmişi yüklenemedi");
      setLogs(data.logs ?? []);
      setError(null);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "İşlem geçmişi yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [action, query]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="overflow-hidden rounded-2xl border border-blue-light-200/70 bg-white shadow-theme-lg dark:border-blue-light-900/40 dark:bg-gray-900">
      <div className="flex flex-col gap-3 border-b border-blue-light-100 p-4 dark:border-blue-light-900/40 sm:flex-row">
        <div className="relative flex-1">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Kullanıcı, işlem veya kayıt ara…"
            className="w-full rounded-xl border border-blue-light-200 bg-blue-light-50/30 px-3.5 py-2.5 text-sm outline-none focus:border-blue-light-500 dark:border-blue-light-900 dark:bg-blue-light-950/20 dark:text-white"
          />
        </div>
        <select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          className="rounded-xl border border-blue-light-200 bg-white px-3 py-2.5 text-sm outline-none dark:border-blue-light-900 dark:bg-gray-950 dark:text-white"
        >
          <option value="">Tüm işlemler</option>
          {Object.entries(ACTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {error && <div className="m-4 rounded-xl bg-error-50 px-4 py-3 text-sm text-error-700">{error}</div>}

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-blue-light-50/95 text-left text-xs uppercase tracking-wide text-gray-500 backdrop-blur dark:bg-blue-light-950/90">
            <tr>
              <th className="px-4 py-3">Tarih</th>
              <th className="px-4 py-3">Kullanıcı</th>
              <th className="px-4 py-3">İşlem</th>
              <th className="px-4 py-3">Açıklama</th>
              <th className="w-12 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-light-100 dark:divide-blue-light-900/30">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Yükleniyor…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">İşlem kaydı bulunamadı.</td></tr>
            ) : (
              logs.map((log) => (
                <React.Fragment key={log.id}>
                  <tr className="hover:bg-blue-light-50/40 dark:hover:bg-blue-light-950/20">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {new Date(`${log.created_at}Z`).toLocaleString("tr-TR")}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{log.user_email}</p>
                      <p className="text-[10px] text-gray-500">{log.user_role}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-light-50 px-2 py-1 text-[10px] font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                        {ACTION_LABEL[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-200">{log.summary}</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        {log.entity}{log.entity_id ? ` #${log.entity_id}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {(log.before_json || log.after_json || log.metadata_json) && (
                        <button
                          type="button"
                          onClick={() => setExpanded((value) => (value === log.id ? null : log.id))}
                          className="rounded-lg border border-blue-light-200 px-2 py-1 text-xs text-blue-light-700 dark:border-blue-light-800 dark:text-blue-light-300"
                        >
                          {expanded === log.id ? "−" : "+"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr>
                      <td colSpan={5} className="bg-blue-light-25 px-4 py-3 dark:bg-blue-light-950/15">
                        <div className="grid gap-3 md:grid-cols-3">
                          {[
                            ["Önceki", log.before_json],
                            ["Sonraki", log.after_json],
                            ["Detay", log.metadata_json],
                          ].map(([label, value]) => value && (
                            <div key={label} className="rounded-lg border border-dashed border-blue-light-200 bg-white p-3 dark:border-blue-light-900 dark:bg-gray-950">
                              <p className="mb-1 text-[10px] font-bold uppercase text-blue-light-600">{label}</p>
                              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] text-gray-600 dark:text-gray-300">
                                {JSON.stringify(JSON.parse(value), null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
