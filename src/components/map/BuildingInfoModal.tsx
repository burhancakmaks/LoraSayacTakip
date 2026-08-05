"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { getTarifeColor } from "@/lib/tarife";
import { useAuthUser } from "@/hooks/useAuthUser";
import SahaKartiExportButtons from "@/components/map/SahaKartiExportButtons";

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
}

interface BuildingInfoModalProps {
  building: SelectedBuilding | null;
  onClose: () => void;
  onOpenSayac?: () => void;
}

interface FormData {
  kat_sayisi: string;
  daire_sayisi: string;
  ortak_alan_sayisi: string;
  has_zemin: boolean;
  ada_parsel: string;
  sokak: string;
  dis_kapi_no: string;
}

interface TarifeOzet {
  tarife_sinif: string;
  tarife_etiket: string;
  tarife_turu: string;
  karma: number;
  abone_sayisi: number;
  building_uavt?: string;
  detay?: { tarife_turu: string; tarife_sinif: string; adet: number }[];
}

const INPUT_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/60">
      <p className="text-[9px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function InfoStrip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/50">
      <label className="mb-1 block text-[9px] font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function BuildingInfoModal({ building, onClose, onOpenSayac }: BuildingInfoModalProps) {
  const { canEdit } = useAuthUser();
  const [form, setForm] = useState<FormData>({
    kat_sayisi: "",
    daire_sayisi: "",
    ortak_alan_sayisi: "",
    has_zemin: false,
    ada_parsel: "",
    sokak: "",
    dis_kapi_no: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tarife, setTarife] = useState<TarifeOzet | null>(null);

  const kat = parseInt(form.kat_sayisi) || 0;
  const daire = parseInt(form.daire_sayisi) || 0;
  const ortak = parseInt(form.ortak_alan_sayisi) || 0;
  const toplam = daire + ortak;

  const patch = (partial: Partial<FormData>) => {
    setForm((f) => ({ ...f, ...partial }));
    setSaved(false);
  };

  useEffect(() => {
    if (!building) return;
    setSaved(false);
    setError(null);
    setLoading(true);
    setTarife(null);

    Promise.all([
      fetch(`/api/bina-bilgi?bina_id=${building.id}`).then((r) => r.json()),
      fetch(`/api/bina-tarife?bina_id=${building.id}`).then((r) => r.json()),
    ])
      .then(([data, tarifeData]) => {
        if (tarifeData && tarifeData.bina_id) setTarife(tarifeData);
        if (data) {
          setForm({
            kat_sayisi: String(data.kat_sayisi || ""),
            daire_sayisi: String(data.daire_sayisi || ""),
            ortak_alan_sayisi: String(data.ortak_alan_sayisi || ""),
            has_zemin: data.has_zemin === 1,
            ada_parsel: data.ada_parsel || "",
            sokak: data.sokak || "",
            dis_kapi_no: data.dis_kapi_no || "",
          });
        } else {
          setForm({
            kat_sayisi: "",
            daire_sayisi: "",
            ortak_alan_sayisi: "",
            has_zemin: false,
            ada_parsel: "",
            sokak: "",
            dis_kapi_no: "",
          });
        }
      })
      .catch(() =>
        setForm({
          kat_sayisi: "",
          daire_sayisi: "",
          ortak_alan_sayisi: "",
          has_zemin: false,
          ada_parsel: "",
          sokak: "",
          dis_kapi_no: "",
        })
      )
      .finally(() => setLoading(false));
  }, [building]);

  const handleSave = async () => {
    if (!building) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/bina-bilgi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bina_id: building.id,
          kat_sayisi: kat,
          daire_sayisi: daire,
          ortak_alan_sayisi: ortak,
          has_zemin: form.has_zemin,
          ada_parsel: form.ada_parsel,
          sokak: form.sokak,
          dis_kapi_no: form.dis_kapi_no,
        }),
      });
      if (!res.ok) throw new Error("Kayıt sırasında hata oluştu.");
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Kayıt hatası");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={building !== null}
      onClose={onClose}
      className="m-4 flex max-w-lg flex-col overflow-hidden rounded-3xl bg-white dark:bg-gray-900"
    >
      {onOpenSayac && (
        <div className="border-b border-blue-light-200/80 bg-gradient-to-r from-blue-light-50 to-white px-4 py-3 dark:border-blue-light-900/50 dark:from-blue-light-950/50 dark:to-gray-900">
          <button
            type="button"
            onClick={onOpenSayac}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-light-600 to-blue-light-700 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-blue-light-500/25 transition hover:from-blue-light-700 hover:to-blue-light-800 hover:shadow-lg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            Sayaç Bilgileri
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-light-50 text-sm font-semibold text-blue-light-700 dark:bg-blue-light-950/40 dark:text-blue-light-300">
            {building?.oda_id ?? "—"}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <h2 className="truncate text-sm font-bold text-gray-900 dark:text-white">
              {building?.value || "Bilinmeyen Bina"}
            </h2>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">
              Bina kimlik ve yapı bilgileri
            </p>
            {building?.layer && (
              <span className="inline-flex w-fit rounded-full border border-blue-light-300/60 bg-blue-light-50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-blue-light-700 dark:border-blue-light-700/50 dark:bg-blue-light-950/40 dark:text-blue-light-300">
                {building.layer}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ maxHeight: "70vh" }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-light-500 border-t-transparent" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tarife && (
              <div
                className="overflow-hidden rounded-2xl border shadow-sm"
                style={{
                  borderColor: `${getTarifeColor(tarife.tarife_sinif)}55`,
                  background: `linear-gradient(135deg, ${getTarifeColor(tarife.tarife_sinif)}10, transparent)`,
                }}
              >
                <div
                  className="flex items-center justify-between gap-2 px-3 py-2"
                  style={{ backgroundColor: `${getTarifeColor(tarife.tarife_sinif)}18` }}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                    Rezerv Alan Tarifesi
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold text-white"
                    style={{ backgroundColor: getTarifeColor(tarife.tarife_sinif) }}
                  >
                    {tarife.tarife_etiket}
                    {tarife.karma ? " · Karma" : ""}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  {tarife.tarife_turu && (
                    <p className="text-[10px] leading-relaxed text-gray-600 dark:text-gray-300">{tarife.tarife_turu}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <InfoCard label="Rezerv Abone">
                      <p className="font-mono text-[11px] font-semibold tabular-nums text-gray-900 dark:text-white">{tarife.abone_sayisi}</p>
                    </InfoCard>
                    {tarife.building_uavt ? (
                      <InfoCard label="UAVT">
                        <p className="truncate font-mono text-[10px] font-semibold tabular-nums text-gray-900 dark:text-white">{tarife.building_uavt}</p>
                      </InfoCard>
                    ) : null}
                  </div>
                  {tarife.detay && tarife.detay.length > 1 && (
                    <div className="space-y-1 rounded-lg border border-dashed border-blue-light-300/50 px-2 py-1.5 dark:border-blue-light-800/50">
                      {tarife.detay.slice(0, 4).map((d) => (
                        <div key={d.tarife_turu} className="flex justify-between text-[10px] text-gray-600 dark:text-gray-300">
                          <span className="truncate pr-2">{d.tarife_turu}</span>
                          <span className="shrink-0 font-bold tabular-nums">{d.adet}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Adres bölümü */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/50">
                <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-100">Adres Bilgisi</h3>
              </div>
              <div className="grid grid-cols-2 gap-2 p-2.5">
                <InfoStrip label="Ada / Parsel">
                  <input
                    type="text"
                    placeholder="41-134"
                    value={form.ada_parsel}
                    onChange={(e) => patch({ ada_parsel: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </InfoStrip>
                <InfoStrip label="Dış Kapı No">
                  <input
                    type="text"
                    placeholder="2"
                    value={form.dis_kapi_no}
                    onChange={(e) => patch({ dis_kapi_no: e.target.value })}
                    className={INPUT_CLASS}
                  />
                </InfoStrip>
                <div className="col-span-2">
                  <InfoStrip label="Sokak / Cadde">
                    <input
                      type="text"
                      placeholder="Kelam Sokak"
                      value={form.sokak}
                      onChange={(e) => patch({ sokak: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </InfoStrip>
                </div>
              </div>
            </section>

            {/* Yapı bölümü */}
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800/50">
                <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-100">Yapı Bilgisi</h3>
              </div>
              <div className="space-y-2 p-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <InfoStrip label="Kat Sayısı">
                    <input
                      type="number"
                      min={0}
                      placeholder="5"
                      value={form.kat_sayisi}
                      onChange={(e) => patch({ kat_sayisi: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </InfoStrip>
                  <InfoStrip label="Daire">
                    <input
                      type="number"
                      min={0}
                      placeholder="20"
                      value={form.daire_sayisi}
                      onChange={(e) => patch({ daire_sayisi: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </InfoStrip>
                  <InfoStrip label="Ortak Alan">
                    <input
                      type="number"
                      min={0}
                      placeholder="2"
                      value={form.ortak_alan_sayisi}
                      onChange={(e) => patch({ ortak_alan_sayisi: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </InfoStrip>
                </div>

                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-blue-light-300/60 bg-white/80 px-2.5 py-2 dark:border-blue-light-800/50 dark:bg-gray-900/50">
                  <input
                    type="checkbox"
                    checked={form.has_zemin}
                    onChange={(e) => patch({ has_zemin: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-blue-light-600 focus:ring-blue-light-500"
                  />
                  <span className="text-[10px] font-medium text-gray-700 dark:text-gray-200">Zemin kat var</span>
                </label>

                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/50">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div>
                    <p className="text-[9px] font-medium text-gray-500">Toplam Bağımsız Bölüm</p>
                    <p className="text-[10px] text-gray-600 dark:text-gray-300">
                      {daire} daire + {ortak} ortak
                      {kat > 0 && (
                        <span className="text-gray-400">
                          {" "}
                          · {form.has_zemin ? "Zemin +" : ""} {kat} kat
                        </span>
                      )}
                    </p>
                    </div>
                    <span className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{toplam}</span>
                  </div>
                </div>
              </div>
            </section>

            {error && (
              <div className="rounded-lg border border-error-200 bg-error-50 px-3 py-2 text-xs text-error-600 dark:border-error-800 dark:bg-error-950/30 dark:text-error-400">
                {error}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 rounded-lg border border-blue-light-300/60 bg-blue-light-50 px-3 py-2 text-xs font-medium text-blue-light-800 dark:border-blue-light-700/50 dark:bg-blue-light-950/30 dark:text-blue-light-300">
                <span className="text-blue-light-500">✓</span>
                Bina bilgileri kaydedildi.
              </div>
            )}
          </div>
        )}
      </div>

      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-light-200/60 px-4 py-3 dark:border-blue-light-900/40">
          <div className="flex flex-col gap-1">
            {!canEdit && <span className="text-[11px] text-gray-400">Salt görüntüleme yetkisi</span>}
            {building && <SahaKartiExportButtons binaId={building.id} />}
          </div>
          <div className="ml-auto flex gap-2">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Kapat
          </button>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || (kat === 0 && daire === 0 && ortak === 0)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-light-600 to-blue-light-700 px-5 py-2 text-xs font-semibold text-white shadow-sm transition hover:from-blue-light-700 hover:to-blue-light-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving && (
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              Kaydet
            </button>
          )}
          </div>
        </div>
      )}
    </Modal>
  );
}
