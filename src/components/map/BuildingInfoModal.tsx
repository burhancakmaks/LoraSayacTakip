"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { getTarifeColor } from "@/lib/tarife";

interface SelectedBuilding {
  id: number;
  value: string | null;
  layer: string | null;
  oda_id: number | null;
}

interface BuildingInfoModalProps {
  building: SelectedBuilding | null;
  onClose: () => void;
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

const MASKI_RIBBON = "#026aa2";
const WAVE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='40' viewBox='0 0 120 40'%3E%3Cpath fill='%230086c9' d='M0 20 Q15 8 30 20 T60 20 T90 20 T120 20 V40 H0Z'/%3E%3C/svg%3E")`;

const INPUT_CLASS =
  "w-full rounded-md border border-blue-light-200/80 bg-white px-2 py-1.5 text-xs text-gray-800 placeholder:text-gray-400 focus:border-blue-light-400 focus:outline-none focus:ring-2 focus:ring-blue-light-500/25 dark:border-blue-light-900/50 dark:bg-gray-900 dark:text-white";

function InfoLcd({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-blue-light-800/80 bg-gradient-to-b from-blue-light-950 to-[#041e2e] px-2 py-1.5 shadow-inner">
      <p className="text-[7px] font-bold uppercase tracking-[0.2em] text-blue-light-600/80">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function InfoStrip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-blue-light-300/70 bg-blue-light-50/90 px-2 py-1.5 dark:border-blue-light-700/50 dark:bg-blue-light-950/35">
      <label className="mb-1 block text-[8px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function BuildingInfoModal({ building, onClose }: BuildingInfoModalProps) {
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
      {/* Üst etiket — sayaç kutusu stili */}
      <div className="relative overflow-hidden border-b border-blue-light-200/60 dark:border-blue-light-900/40">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08] dark:opacity-[0.14]"
          style={{ backgroundImage: WAVE_BG, backgroundSize: "120px 40px" }}
        />
        <div className="relative flex overflow-hidden pr-10">
          <div className="relative z-10 flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-blue-light-800 to-blue-light-950 px-1 py-4 text-white shadow-[0_0_14px_rgba(11,165,236,0.3)]">
            <div className="absolute inset-2 rounded-full border border-white/20" style={{ boxShadow: "inset 0 0 0 2px #0ba5ec44" }} />
            <span className="relative text-[7px] font-bold uppercase tracking-[0.15em] text-blue-light-200/70">Oda</span>
            <span className="relative text-sm font-black leading-none tabular-nums">{building?.oda_id ?? "—"}</span>
            <span className="relative mt-1 rounded bg-blue-light-500 px-1 py-px text-[7px] font-bold text-white">BİNA</span>
          </div>
          <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3">
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
          <div
            className="pointer-events-none absolute -right-7 top-4 z-20 w-24 rotate-45 py-0.5 text-center text-[7px] font-bold uppercase tracking-wider text-white shadow-sm"
            style={{ backgroundColor: MASKI_RIBBON }}
          >
            MASKİ
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
                    <InfoLcd label="Rezerv Abone">
                      <p className="font-mono text-[11px] font-bold tabular-nums text-blue-light-300">{tarife.abone_sayisi}</p>
                    </InfoLcd>
                    {tarife.building_uavt ? (
                      <InfoLcd label="UAVT">
                        <p className="truncate font-mono text-[10px] font-bold tabular-nums text-blue-light-300">{tarife.building_uavt}</p>
                      </InfoLcd>
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
            <section className="overflow-hidden rounded-2xl border border-blue-light-200/60 bg-blue-light-25/30 dark:border-blue-light-900/40 dark:bg-blue-light-950/15">
              <div className="border-b border-blue-light-200/50 bg-gradient-to-r from-blue-light-900/90 to-blue-light-950 px-3 py-1.5 dark:border-blue-light-900/50">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-blue-light-100">Adres Bilgisi</h3>
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
            <section className="overflow-hidden rounded-2xl border border-blue-light-200/60 bg-blue-light-25/30 dark:border-blue-light-900/40 dark:bg-blue-light-950/15">
              <div className="border-b border-blue-light-200/50 bg-gradient-to-r from-blue-light-900/90 to-blue-light-950 px-3 py-1.5 dark:border-blue-light-900/50">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-blue-light-100">Yapı Bilgisi</h3>
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

                <div className="relative flex overflow-hidden rounded-2xl border border-blue-light-200/80 bg-gradient-to-br from-blue-light-25 to-white shadow-sm dark:border-blue-light-900/50 dark:from-blue-light-950/25 dark:to-gray-900">
                  <div className="flex w-12 shrink-0 items-center justify-center bg-gradient-to-b from-blue-light-800 to-blue-light-950 text-white">
                    <span className="text-lg font-black tabular-nums">{toplam}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Toplam Bağımsız Bölüm</p>
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
        <div className="flex justify-end gap-2 border-t border-blue-light-200/60 px-4 py-3 dark:border-blue-light-900/40">
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Kapat
          </button>
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
        </div>
      )}
    </Modal>
  );
}
